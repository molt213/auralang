import { SILENCE_RMS_THRESHOLD, isSilentRms, rmsOf } from '../utils/audioLevel'
import type { ChunkingProfile } from './chunking'

// A stream rarely offers clean silence: background music, game audio or room
// tone sit above the fixed silence threshold, and then no pause is ever
// detected — every chunk becomes a cap cut, and cap cuts land mid-word (see
// the measured losses in src/asr/chunking.ts). So the quiet test also considers
// the noise bed, but only when the recent past actually contains one that
// stands clearly below the loud level.
const NOISE_FLOOR_RATIO = 2.5
const NOISE_FLOOR_CONTRAST = 4
const FLOOR_WINDOW_SECONDS = 5

// A cap cut should land in a real dip; a sliver of low level between two
// syllables is not one.
const MIN_SPLIT_RUN_MS = 120

export type ChunkCutReason = 'pause' | 'softPause' | 'cap'

interface BufferedFrame {
  samples: number
  rms: number
}

interface LevelBucket {
  min: number
  max: number
}

/**
 * Decides when the captured stream is cut into a chunk, and where. It works on
 * frame levels only — the audio itself stays in the caller, which slices its
 * buffer at the returned frame counts.
 *
 * `pushFrame` returns how many buffered frames to emit now (0 = keep
 * buffering); `commitEmit` then drops that prefix and keeps the remainder as
 * the start of the next chunk, so a cap cut never discards audio.
 */
export class ChunkCutter {
  private readonly pauseSamples: number
  private readonly minChunkSamples: number
  private readonly maxChunkSamples: number
  private readonly minSpeechSamples: number
  private readonly softMaxSamples: number
  private readonly softPauseSamples: number
  private readonly lookbackSamples: number
  private readonly minSplitRunSamples: number
  private readonly samplesPerBucket: number

  private frames: BufferedFrame[] = []
  private pendingSamples = 0
  private speechSamples = 0
  private quietRunSamples = 0
  private buckets: LevelBucket[] = []
  private bucketMin = Infinity
  private bucketMax = 0
  private bucketSamples = 0
  private cutReason: ChunkCutReason | null = null

  constructor(profile: ChunkingProfile, sampleRate: number) {
    const toSamples = (ms: number) => (sampleRate * ms) / 1000
    this.pauseSamples = toSamples(profile.pauseMs)
    this.minChunkSamples = toSamples(profile.minChunkMs)
    this.maxChunkSamples = toSamples(profile.maxChunkMs)
    this.minSpeechSamples = toSamples(profile.minSpeechMs)
    this.softMaxSamples = toSamples(profile.softMaxMs)
    this.softPauseSamples = toSamples(profile.softPauseMs)
    this.lookbackSamples = toSamples(profile.lookbackMs)
    this.minSplitRunSamples = toSamples(MIN_SPLIT_RUN_MS)
    this.samplesPerBucket = sampleRate
  }

  get bufferedSamples(): number {
    return this.pendingSamples
  }

  /** True when the pending buffer holds enough real speech to be worth decoding. */
  get hasSpeech(): boolean {
    return this.speechSamples >= this.minSpeechSamples
  }

  /**
   * Why the last pushFrame cut, or null when it buffered. A full pause is the
   * only cut that can end a sentence; a short pause or the cap lands inside
   * one, so the text pipeline keeps the caption line open across those.
   */
  get lastCutReason(): ChunkCutReason | null {
    return this.cutReason
  }

  pushFrame(frame: Float32Array): number {
    this.cutReason = null
    const rms = rmsOf(frame)
    this.frames.push({ samples: frame.length, rms })
    this.pendingSamples += frame.length
    this.updateBuckets(rms, frame.length)

    // Speech accounting stays absolute — it decides whether a chunk is worth
    // sending at all, and the adaptive threshold is only a cut-placement aid.
    if (!isSilentRms(rms)) this.speechSamples += frame.length

    if (rms < this.quietThreshold()) this.quietRunSamples += frame.length
    else this.quietRunSamples = 0

    if (this.quietRunSamples >= this.pauseSamples && this.pendingSamples >= this.minChunkSamples) {
      this.cutReason = 'pause'
      return this.frames.length
    }
    if (
      this.pendingSamples >= this.softMaxSamples
      && this.quietRunSamples >= this.softPauseSamples
    ) {
      this.cutReason = 'softPause'
      return this.frames.length
    }
    if (this.pendingSamples >= this.maxChunkSamples) {
      this.cutReason = 'cap'
      return this.splitIndexNearCap()
    }
    return 0
  }

  commitEmit(frameCount: number): void {
    this.frames = this.frames.slice(frameCount)
    this.pendingSamples = 0
    this.speechSamples = 0
    this.quietRunSamples = 0
    for (const frame of this.frames) {
      this.pendingSamples += frame.samples
      if (!isSilentRms(frame.rms)) this.speechSamples += frame.samples
      if (frame.rms < this.quietThreshold()) this.quietRunSamples += frame.samples
      else this.quietRunSamples = 0
    }
  }

  private updateBuckets(rms: number, samples: number): void {
    this.bucketMin = Math.min(this.bucketMin, rms)
    this.bucketMax = Math.max(this.bucketMax, rms)
    this.bucketSamples += samples
    if (this.bucketSamples < this.samplesPerBucket) return

    this.buckets.push({ min: this.bucketMin, max: this.bucketMax })
    if (this.buckets.length > FLOOR_WINDOW_SECONDS) this.buckets.shift()
    this.bucketMin = Infinity
    this.bucketMax = 0
    this.bucketSamples = 0
  }

  private quietThreshold(): number {
    if (this.buckets.length === 0) return SILENCE_RMS_THRESHOLD

    let floor = Infinity
    let level = 0
    for (const bucket of this.buckets) {
      floor = Math.min(floor, bucket.min)
      level = Math.max(level, bucket.max)
    }
    if (level <= floor * NOISE_FLOOR_CONTRAST) return SILENCE_RMS_THRESHOLD
    return Math.max(SILENCE_RMS_THRESHOLD, floor * NOISE_FLOOR_RATIO)
  }

  // Interrupted speech must be cut somewhere: take the cheapest boundary in the
  // lookback window — the middle of its longest quiet run, or failing that the
  // boundary between the two quietest neighbouring frames.
  private splitIndexNearCap(): number {
    const windowStart = this.pendingSamples - this.lookbackSamples
    const threshold = this.quietThreshold()

    const candidates: number[] = []
    let position = 0
    for (let index = 0; index < this.frames.length; index++) {
      if (position >= windowStart) candidates.push(index)
      position += this.frames[index].samples
    }
    if (candidates.length === 0) return this.frames.length

    let bestRunStart = -1
    let bestRunFrames = 0
    let runStart = -1
    for (const index of candidates) {
      if (this.frames[index].rms >= threshold) {
        runStart = -1
        continue
      }
      if (runStart < 0) runStart = index
      const runFrames = index - runStart + 1
      if (runFrames > bestRunFrames) {
        bestRunFrames = runFrames
        bestRunStart = runStart
      }
    }

    if (bestRunStart >= 0) {
      let runSamples = 0
      for (let index = bestRunStart; index < bestRunStart + bestRunFrames; index++) {
        runSamples += this.frames[index].samples
      }
      if (runSamples >= this.minSplitRunSamples) {
        return bestRunStart + Math.floor(bestRunFrames / 2)
      }
    }

    let bestIndex = 1
    let bestCost = Infinity
    for (const index of candidates) {
      if (index === 0) continue
      const cost = this.frames[index - 1].rms + this.frames[index].rms
      // On a tie the later boundary wins: with nothing to gain from cutting
      // early, keep the chunk as large as the cap allows.
      if (cost <= bestCost) {
        bestCost = cost
        bestIndex = index
      }
    }
    return bestIndex
  }
}

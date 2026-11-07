import { describe, expect, it } from '@jest/globals'

import { DOLPHIN_CHUNKING } from './chunking'
import { ChunkCutter } from './chunkCutter'

const SAMPLE_RATE = 16000
// 50 ms frames keep the arithmetic in the tests legible: Dolphin's 600 ms
// minimum is 12 frames, its 7000 ms cap is 140.
const FRAME_SAMPLES = 800
const SPEECH_RMS = 0.09
const NEAR_SILENCE_RMS = 0.001
// A background bed: audible to the recognizer, but well above the fixed
// silence threshold.
const BED_RMS = 0.02

const frame = (rms: number) => new Float32Array(FRAME_SAMPLES).fill(rms)

describe('Given a chunk cutter for the Dolphin profile', () => {
  it('When speech is followed by a pause of pauseMs, Then the chunk ends on that pause', () => {
    const cutter = new ChunkCutter(DOLPHIN_CHUNKING, SAMPLE_RATE)

    let cut = 0
    for (let i = 0; i < 40; i++) cut = cutter.pushFrame(frame(SPEECH_RMS))
    expect(cut).toBe(0)

    for (let i = 0; i < 27; i++) cut = cutter.pushFrame(frame(NEAR_SILENCE_RMS))
    expect(cut).toBe(0)

    cut = cutter.pushFrame(frame(NEAR_SILENCE_RMS))

    expect(cut).toBe(68)
    expect(cutter.lastCutReason).toBe('pause')
    expect(cutter.hasSpeech).toBe(true)

    cutter.commitEmit(cut)

    expect(cutter.bufferedSamples).toBe(0)
  })

  it('When a chunk runs past softMaxMs and then pauses briefly, Then it ends on the short pause', () => {
    const cutter = new ChunkCutter(DOLPHIN_CHUNKING, SAMPLE_RATE)

    let cut = 0
    // 76 frames = 3800 ms = softMaxMs
    for (let i = 0; i < 76; i++) cut = cutter.pushFrame(frame(SPEECH_RMS))
    expect(cut).toBe(0)

    // 4 frames = 200 ms: below the 250 ms soft pause
    for (let i = 0; i < 4; i++) cut = cutter.pushFrame(frame(NEAR_SILENCE_RMS))
    expect(cut).toBe(0)

    cut = cutter.pushFrame(frame(NEAR_SILENCE_RMS))

    expect(cut).toBe(81)
    expect(cutter.lastCutReason).toBe('softPause')
  })

  it('When the cap is reached, Then the cut lands in the quiet stretch before it', () => {
    const cutter = new ChunkCutter(DOLPHIN_CHUNKING, SAMPLE_RATE)

    let cut = 0
    for (let i = 0; i < 120; i++) cut = cutter.pushFrame(frame(SPEECH_RMS))

    // 200 ms of quiet 1 s before the cap: too short for the soft pause, but
    // long enough to be a split candidate.
    for (let i = 0; i < 4; i++) cut = cutter.pushFrame(frame(NEAR_SILENCE_RMS))
    expect(cut).toBe(0)

    for (let i = 0; i < 15; i++) cut = cutter.pushFrame(frame(SPEECH_RMS))
    expect(cut).toBe(0)

    // 140th frame reaches the 7000 ms cap
    cut = cutter.pushFrame(frame(SPEECH_RMS))

    // Cut at the middle of the quiet stretch (frames 120-123), not on the clock.
    expect(cut).toBe(122)
    expect(cutter.lastCutReason).toBe('cap')

    cutter.commitEmit(cut)

    expect(cutter.bufferedSamples).toBe(18 * FRAME_SAMPLES)
  })

  it('When the cap is reached with no quiet stretch, Then the cut takes the cheapest boundary', () => {
    const cutter = new ChunkCutter(DOLPHIN_CHUNKING, SAMPLE_RATE)

    let cut = 0
    for (let i = 0; i < 134; i++) cut = cutter.pushFrame(frame(SPEECH_RMS))

    // Two adjacent frames just above the silence threshold: the only dip, and
    // not quiet enough for the run rule.
    for (let i = 0; i < 2; i++) cut = cutter.pushFrame(frame(BED_RMS))
    expect(cut).toBe(0)

    // The 140th frame reaches the cap
    for (let i = 0; i < 4; i++) cut = cutter.pushFrame(frame(SPEECH_RMS))

    expect(cut).toBe(135)
    expect(cutter.lastCutReason).toBe('cap')
  })

  it('When the stream runs on a background bed, Then its pauses still end chunks', () => {
    const cutter = new ChunkCutter(DOLPHIN_CHUNKING, SAMPLE_RATE)

    let cut = 0
    // 2 s speech | 1 s bed | 1 s speech | 1 s bed: the first three seconds teach
    // the cutter that a quiet bed exists below the speech level.
    for (let i = 0; i < 40; i++) cut = cutter.pushFrame(frame(SPEECH_RMS))
    for (let i = 0; i < 20; i++) cut = cutter.pushFrame(frame(BED_RMS))
    expect(cut).toBe(0)
    for (let i = 0; i < 20; i++) cut = cutter.pushFrame(frame(SPEECH_RMS))
    expect(cut).toBe(0)

    // The bed is not silent by the fixed threshold, but it is the bed the
    // cutter learned — a 250 ms stretch of it ends the chunk (85 frames =
    // 3800 ms past softMaxMs + the 250 ms pause).
    for (let i = 0; i < 5; i++) cut = cutter.pushFrame(frame(BED_RMS))

    expect(cut).toBe(85)
    expect(cutter.lastCutReason).toBe('softPause')
  })

  it('When a chunk holds only near-silence, Then it is not sent for decoding', () => {
    const cutter = new ChunkCutter(DOLPHIN_CHUNKING, SAMPLE_RATE)

    let cut = 0
    for (let i = 0; i < 28; i++) cut = cutter.pushFrame(frame(NEAR_SILENCE_RMS))

    expect(cut).toBe(28)
    expect(cutter.hasSpeech).toBe(false)
  })

  it('When the stream is only a background bed, Then the chunk is still decoded at the cap', () => {
    const cutter = new ChunkCutter(DOLPHIN_CHUNKING, SAMPLE_RATE)

    let cut = 0
    for (let i = 0; i < 139; i++) cut = cutter.pushFrame(frame(BED_RMS))
    expect(cut).toBe(0)

    cut = cutter.pushFrame(frame(BED_RMS))

    // Bed counts as audio worth decoding (unchanged from the fixed threshold),
    // and with no dip to prefer the cut stays as late as the cap allows.
    expect(cut).toBe(139)
    expect(cutter.lastCutReason).toBe('cap')
    expect(cutter.hasSpeech).toBe(true)
  })

  it('When cuts happen, Then every pushed sample is emitted or still buffered', () => {
    const cutter = new ChunkCutter(DOLPHIN_CHUNKING, SAMPLE_RATE)

    let pushed = 0
    let emitted = 0
    let buffered: Float32Array[] = []
    // 5 frames of speech followed by 2 of quiet: long enough to intermittently
    // hit the cap, short enough that the pause rules never fire.
    for (let i = 0; i < 600; i++) {
      const next = frame(i % 7 < 5 ? SPEECH_RMS : NEAR_SILENCE_RMS)
      buffered.push(next)
      pushed += next.length

      const cut = cutter.pushFrame(next)
      if (cut === 0) continue
      emitted += buffered.slice(0, cut).reduce((sum, f) => sum + f.length, 0)
      buffered = buffered.slice(cut)
      cutter.commitEmit(cut)
    }

    expect(buffered.length).toBeLessThan(140)
    expect(emitted + cutter.bufferedSamples).toBe(pushed)
    expect(cutter.bufferedSamples).toBe(buffered.reduce((sum, f) => sum + f.length, 0))
  })
})

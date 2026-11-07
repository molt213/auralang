// Manages the AudioContext lifecycle and tab stream capture inside the offscreen document.
// The offscreen doc stays alive as long as Chrome keeps it — this is intentional (MV3 pattern).

import type { ChunkingProfile } from '../asr/chunking'
import { ChunkCutter } from '../asr/chunkCutter'
import type { ChunkCutReason } from '../asr/chunkCutter'

export interface CapturedChunk {
  samples: Float32Array
  // True when `samples` starts with a run-in copied from the previous chunk.
  // The text pipeline uses it to strip the duplicated run at the seam.
  carriedSeam: boolean
  // True when the chunk ended because speech went quiet for the profile's full
  // pause. Only such a cut can end a sentence; short pauses and the safety cap
  // land inside one.
  endedOnPause: boolean
  // Audio dropped as silence since the previous chunk. A long gap means the
  // speaker finished the thought even if the text still looks unfinished, so
  // the next chunk must start a new caption line.
  silenceBeforeMs: number
}

export type PendingAudio = CapturedChunk

export interface AudioCaptureHandlers {
  onChunk: (chunk: CapturedChunk) => void
  onError: (message: string) => void
  onEnded: () => void
  // Fired after every captured frame so the preview scheduler can decide
  // whether to decode the in-progress buffer. Driven by the audio itself
  // rather than a timer, which a backgrounded offscreen document would throttle.
  onAudioTick: () => void
}

export interface AudioCaptureOptions {
  // Original tab audio volume, 0 (muted) to 1 (full).
  originalVolume: number
  // Cut thresholds; see src/asr/chunking.ts for the per-engine profiles.
  chunking: ChunkingProfile
}

const RECOGNIZER_SAMPLE_RATE = 16000

// Cutting on a fixed clock slices sentences mid-word and feeds the recognizer
// fragments that decode to junk; instead, buffer continuously and cut on the
// pause rules in ChunkCutter, so each chunk is a whole phrase. The per-engine
// profiles (esp. Dolphin's independent CTC decoding) live in src/asr/chunking.ts.

const WORKLET_URL = chrome.runtime.getURL('capture-worklet.js')

// The single AudioContext runs at the device's NATIVE rate. A second 16 kHz
// context fed from the same MediaStream receives only silence in Chrome (streams
// don't fan out across contexts with mismatched rates), so we capture and play
// back at native rate and resample to 16 kHz for the recognizer in flush().
// The cutter resolves its thresholds from that actual capture rate.
let captureRate = RECOGNIZER_SAMPLE_RATE
let cutter: ChunkCutter | null = null

let captureNode: AudioWorkletNode | null = null
let audioContext: AudioContext | null = null
let mediaStream: MediaStream | null = null
// Kept so the panel can adjust the original-audio level mid-session without
// restarting capture.
let playbackGain: GainNode | null = null
let pendingFrames: Float32Array[] = []
// Tail of the last chunk when the cap forced a split. It is not part of the
// cut accounting (so it never delays the next cut); it is prepended to the
// next chunk's audio for the recognizer only.
let seamRunIn: Float32Array[] = []
let seamRunInMs = 0
// Silence flushed and dropped since the last emitted chunk. It tells the text
// pipeline when a long quiet gap ended the speaker's thought.
let silenceSinceChunkMs = 0

// Linear-interpolation resample from the native capture rate down to the
// recognizer's 16 kHz. No anti-alias filter: speech energy sits well below
// 8 kHz and both engines are robust to the residual aliasing — not worth an
// offline rendering pass.
function resampleToRecognizerRate(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === RECOGNIZER_SAMPLE_RATE) return input
  const ratio = fromRate / RECOGNIZER_SAMPLE_RATE
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

// The last `durationMs` of a chunk, frame-aligned. Used to carry context into
// the chunk that continues a cap split.
function tailFrames(frames: Float32Array[], durationMs: number): Float32Array[] {
  if (durationMs <= 0 || frames.length === 0) return []
  const target = (captureRate * durationMs) / 1000
  const tail: Float32Array[] = []
  let kept = 0
  for (let index = frames.length - 1; index >= 0 && kept < target; index--) {
    tail.unshift(frames[index])
    kept += frames[index].length
  }
  return tail
}

function concatFrames(frames: Float32Array[]): Float32Array {
  let total = 0
  for (const frame of frames) total += frame.length
  const joined = new Float32Array(total)
  let offset = 0
  for (const frame of frames) {
    joined.set(frame, offset)
    offset += frame.length
  }
  return joined
}

// Emit the first `frameCount` buffered frames as one chunk and keep the rest as
// the start of the next one — a cap cut slices the buffer at the quietest spot
// available instead of discarding audio.
function flush(
  handlers: AudioCaptureHandlers,
  frameCount: number,
  reason: ChunkCutReason | null,
): void {
  const emitted = pendingFrames.splice(0, frameCount)
  // A cap split leaves a remainder; that continuation begins mid-clause and
  // must be decoded with a run-in of the audio it was cut from.
  const continues = pendingFrames.length > 0
  const nextRunIn = continues ? tailFrames(emitted, seamRunInMs) : []
  const runIn = seamRunIn
  seamRunIn = nextRunIn

  // Don't send near-silent buffers to the recognizer — nothing to transcribe,
  // and near-empty audio is exactly what triggers hallucinated output ("you").
  const worthDecoding = cutter?.hasSpeech ?? false
  cutter?.commitEmit(frameCount)
  if (!worthDecoding) {
    for (const frame of emitted) silenceSinceChunkMs += (frame.length / captureRate) * 1000
    return
  }

  const carriedSeam = runIn.length > 0
  const chunk = concatFrames(carriedSeam ? [...runIn, ...emitted] : emitted)
  handlers.onChunk({
    samples: resampleToRecognizerRate(chunk, captureRate),
    carriedSeam,
    endedOnPause: reason === 'pause',
    silenceBeforeMs: silenceSinceChunkMs,
  })
  silenceSinceChunkMs = 0
}

function pushSamples(samples: Float32Array, handlers: AudioCaptureHandlers): void {
  pendingFrames.push(samples)
  const cutFrames = cutter ? cutter.pushFrame(samples) : 0
  if (cutFrames > 0) flush(handlers, cutFrames, cutter?.lastCutReason ?? null)
  handlers.onAudioTick()
}

// Minimum speech buffered before a preview is worth decoding. Short utterances
// are cut at the first pause, so the first preview has to land well inside one:
// 0.7 s decodes in ~170 ms, which still leaves room for the translation.
const MIN_PREVIEW_SAMPLES = 11200

// The audio buffered since the last cut, resampled for the recognizer, or null
// when there is too little of it to preview. The run-in is included: the
// preview starts from the same audio the settled chunk will decode, so it sees
// the mid-clause continuation with its context and does not shrink when the
// settled line lands.
export function getPendingAudio(): PendingAudio | null {
  const frames = seamRunIn.length > 0 ? [...seamRunIn, ...pendingFrames] : pendingFrames
  let buffered = 0
  for (const frame of frames) buffered += frame.length
  if (buffered * (RECOGNIZER_SAMPLE_RATE / captureRate) < MIN_PREVIEW_SAMPLES) return null

  return {
    samples: resampleToRecognizerRate(concatFrames(frames), captureRate),
    carriedSeam: seamRunIn.length > 0,
    // The buffer has not been cut yet, so nothing can be final about its end.
    endedOnPause: false,
    silenceBeforeMs: 0,
  }
}

// Whether a live capture graph is actually processing audio. A node left over
// from a dead stream (or a suspended context) must not count as capturing.
export function isAudioCaptureActive(): boolean {
  return captureNode !== null && audioContext !== null && audioContext.state === 'running'
}

export async function startAudioCapture(
  streamId: string,
  handlers: AudioCaptureHandlers,
  options: AudioCaptureOptions,
): Promise<void> {
  // A previous session can leave its worklet node behind when the stream dies
  // without an 'ended' event. Reusing it would silently keep the old, dead
  // stream and leave the panel on "waiting for speech" forever.
  if (captureNode) stopAudioCapture()

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // @ts-expect-error — Chrome-specific constraint for tab capture
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  })
  mediaStream = stream

  // Chrome ends this track when the captured tab closes or navigates away —
  // without this, captureNode stays alive and blocks any new capture attempt
  // with "Cannot capture a tab with an active stream".
  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    if (!captureNode) return // already stopped via STOP_CAPTURE
    stopAudioCapture()
    handlers.onEnded()
  })

  // Single context at the device's native rate: it demonstrably receives the tab
  // audio (a 16 kHz context on the same stream gets silence). It both replays the
  // original for the user and feeds the worklet; flush() resamples for Whisper.
  audioContext = new AudioContext()
  captureRate = audioContext.sampleRate
  cutter = new ChunkCutter(options.chunking, captureRate)
  seamRunIn = []
  seamRunInMs = options.chunking.seamRunInMs
  silenceSinceChunkMs = 0

  const source = audioContext.createMediaStreamSource(stream)

  // Playback path: a tab under capture is muted by Chrome, so replay the original
  // for the user at the configured level (0 = muted). The panel can change this
  // live via setOriginalVolume.
  playbackGain = audioContext.createGain()
  playbackGain.gain.value = options.originalVolume
  source.connect(playbackGain)
  playbackGain.connect(audioContext.destination)

  // Analysis path: the worklet mixes to mono and posts raw samples back — it
  // produces no audible output, so connecting it to destination adds no echo.
  await audioContext.audioWorklet.addModule(WORKLET_URL)

  captureNode = new AudioWorkletNode(audioContext, 'capture-processor')
  captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
    pushSamples(event.data, handlers)
  }

  source.connect(captureNode)
  captureNode.connect(audioContext.destination)

  // The offscreen document never gets a user gesture, so the autoplay policy can
  // leave the context "suspended" — which silently stops both the worklet (no
  // transcription) and the playback (no sound). Resume explicitly; ignore a
  // rejection so a blocked resume never aborts the capture.
  await audioContext.resume().catch(() => {})
}

// Live original-audio level, 0 (muted) to 1 (full). No-op when no capture is
// running (the gain node only exists while a stream is active).
export function setOriginalVolume(volume: number): void {
  if (!playbackGain) return
  playbackGain.gain.value = Math.min(1, Math.max(0, volume))
}

export function stopAudioCapture(): void {
  if (captureNode) {
    captureNode.port.onmessage = null
    captureNode.disconnect()
  }
  captureNode = null
  playbackGain = null
  cutter = null
  pendingFrames = []
  seamRunIn = []
  seamRunInMs = 0
  silenceSinceChunkMs = 0

  // Release the capture stream. While a tab-capture track is live, Chrome
  // keeps the tab captured — and a captured tab stays muted. Disconnecting
  // the audio graph alone left the track running, so the original tab audio
  // never came back after Stop (and restarting hit "Cannot capture a tab
  // with an active stream").
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop()
    mediaStream = null
  }

  if (audioContext) {
    void audioContext.close()
    audioContext = null
  }
}

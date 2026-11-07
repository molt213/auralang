import { describe, expect, it } from '@jest/globals'

import { createPreviewScheduler } from './previewPipeline'
import type { PreviewScheduler } from './previewPipeline'
import type { TranscriptUpdatePayload } from '../types'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createClock(start = 0) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

// One macrotask turn is enough for the scheduler's await chain to finish.
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface HarnessOptions {
  segmentId?: () => number
  isAsrBusy?: () => boolean
  translatePreview?: (text: string, onPartial: (partial: string) => void) => Promise<string | null>
}

function createHarness(options: HarnessOptions = {}) {
  const clock = createClock()
  const emitted: TranscriptUpdatePayload[] = []
  const deferred = createDeferred<string>()
  const transcribeCalls: Float32Array[] = []
  const transcribeSeams: boolean[] = []

  const scheduler: PreviewScheduler = createPreviewScheduler({
    transcribePreview: (audio) => {
      transcribeCalls.push(audio.samples)
      transcribeSeams.push(audio.carriedSeam)
      return deferred.promise
    },
    translatePreview: options.translatePreview ?? (async (text) => `[${text}]`),
    emit: (update) => emitted.push(update),
    segmentId: options.segmentId ?? (() => 1),
    isAsrBusy: options.isAsrBusy ?? (() => false),
    now: clock.now,
  })

  return { scheduler, emitted, clock, deferred, transcribeCalls, transcribeSeams }
}

const buffered = new Float32Array(19200)
const pendingAudio = { samples: buffered, carriedSeam: false, endedOnPause: false, silenceBeforeMs: 0 }

describe('Given buffered speech that has not been cut yet', () => {
  it('When the preview decodes, Then it is emitted with its fast translation', async () => {
    const harness = createHarness()

    harness.scheduler.tick(() => pendingAudio)
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()

    expect(harness.emitted).toEqual([{
      segmentId: 1,
      original: 'こんにちは世界',
      translated: '[こんにちは世界]',
      translationStatus: 'preview',
    }])
  })

  it('When nothing is buffered yet, Then no preview is decoded', () => {
    const harness = createHarness()

    harness.scheduler.tick(() => null)

    expect(harness.transcribeCalls).toHaveLength(0)
  })

  it('When the buffered audio carries a run-in, Then the preview decoder is told about the seam', () => {
    const harness = createHarness()

    harness.scheduler.tick(() => ({ samples: buffered, carriedSeam: true, endedOnPause: false, silenceBeforeMs: 0 }))

    expect(harness.transcribeSeams).toEqual([true])
  })

  it('When the recognizer is busy with a real chunk, Then the buffered audio is not even collected', () => {
    const harness = createHarness({ isAsrBusy: () => true })
    let provided = 0

    harness.scheduler.tick(() => {
      provided += 1
      return pendingAudio
    })

    expect(provided).toBe(0)
    expect(harness.transcribeCalls).toHaveLength(0)
  })

  it('When the utterance is cut while the preview decodes, Then the translation is still delivered', async () => {
    let segmentId = 1
    const harness = createHarness({ segmentId: () => segmentId })

    harness.scheduler.tick(() => pendingAudio)
    segmentId = 2 // the chunk was finalized; its settled caption is on screen
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()

    // The caption merges this in and keeps it until the real translation lands,
    // so the line never blanks out.
    expect(harness.emitted).toEqual([{
      segmentId: 1,
      original: 'こんにちは世界',
      translated: '[こんにちは世界]',
      translationStatus: 'preview',
    }])
  })

  it('When the preview repeats the previous text, Then it is not emitted twice', async () => {
    const harness = createHarness()

    harness.scheduler.tick(() => pendingAudio)
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()
    harness.clock.advance(10_000)
    harness.scheduler.tick(() => pendingAudio)
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()

    expect(harness.emitted).toHaveLength(1)
  })

  it('When the preview decodes to punctuation or noise, Then nothing is shown', async () => {
    const harness = createHarness()

    harness.scheduler.tick(() => pendingAudio)
    harness.deferred.resolve('。')
    await nextTurn()

    expect(harness.emitted).toEqual([])
  })

  it('When the fast translation fails, Then the preview still shows the transcript', async () => {
    const harness = createHarness({ translatePreview: async () => null })

    harness.scheduler.tick(() => pendingAudio)
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()

    expect(harness.emitted).toEqual([{
      segmentId: 1,
      original: 'こんにちは世界',
      translated: null,
      translationStatus: 'preview',
    }])
  })

  it('When the translation streams, Then the preview grows before the translation finishes', async () => {
    const stream: { onPartial: ((partial: string) => void) | null } = { onPartial: null }
    const translation = createDeferred<string | null>()
    const harness = createHarness({
      translatePreview: (_text, onPartial) => {
        stream.onPartial = onPartial
        return translation.promise
      },
    })

    harness.scheduler.tick(() => pendingAudio)
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()

    stream.onPartial?.('你好')
    expect(harness.emitted).toEqual([{
      segmentId: 1,
      original: 'こんにちは世界',
      translated: '你好',
      translationStatus: 'preview',
    }])

    translation.resolve('你好，世界')
    await nextTurn()

    expect(harness.emitted[harness.emitted.length - 1]).toEqual({
      segmentId: 1,
      original: 'こんにちは世界',
      translated: '你好，世界',
      translationStatus: 'preview',
    })
  })

  it('When a preview decode fails, Then it stays silent instead of surfacing an error', async () => {
    const harness = createHarness()

    harness.scheduler.tick(() => pendingAudio)
    harness.deferred.reject(new Error('recognizer crashed'))
    await nextTurn()

    expect(harness.emitted).toEqual([])
  })

  it('When a preview takes long to decode, Then the next one waits proportionally longer', async () => {
    const harness = createHarness()

    harness.scheduler.tick(() => pendingAudio)
    harness.clock.advance(600)
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()

    // 600 ms of decoding leaves the recognizer alone for 400 + 600 × 2.2 ms.
    harness.scheduler.tick(() => pendingAudio)
    harness.clock.advance(1000)
    harness.scheduler.tick(() => pendingAudio)
    expect(harness.transcribeCalls).toHaveLength(1)

    harness.clock.advance(1000)
    harness.scheduler.tick(() => pendingAudio)
    expect(harness.transcribeCalls).toHaveLength(2)
  })

  it('When the session is reset, Then the next preview starts from a clean slate', async () => {
    const harness = createHarness()

    harness.scheduler.tick(() => pendingAudio)
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()
    harness.scheduler.reset()
    harness.scheduler.tick(() => pendingAudio)
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()

    expect(harness.emitted).toHaveLength(2)
  })

  it('When the session ends while a preview is in flight, Then it is not emitted', async () => {
    const harness = createHarness()

    harness.scheduler.tick(() => pendingAudio)
    harness.scheduler.reset()
    harness.deferred.resolve('こんにちは世界')
    await nextTurn()

    expect(harness.emitted).toEqual([])
  })
})

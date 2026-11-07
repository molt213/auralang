// Offscreen-side client for the ASR worker. Owns the worker lifecycle and
// exposes the same surface the pipeline used before (transcribe + tier +
// model status), so callers don't know inference moved off-thread. The
// transformers.js worker handles the whisper tiers; the Dolphin tier has its
// own classic worker (the sherpa-onnx runtime) and is routed here.
import type { AsrMode, ModelStatus } from '../asr/types'
import { tierForMode } from '../asr/registry'
import type { ModelTier } from '../asr/types'
import type { AsrWorkerRequest, AsrWorkerResponse } from './asrWorker'
import {
  ensureDolphinModel,
  isDolphinBusy,
  onDolphinStatus,
  transcribeWithDolphin,
} from '../asr/dolphin/dolphinClient'

type StatusListener = (status: ModelStatus) => void

interface PendingRequest {
  resolve: (text: string) => void
  reject: (err: Error) => void
}

let worker: Worker | null = null
let activeTier: ModelTier | null = null
let statusListener: StatusListener = () => {}
const pending = new Map<number, PendingRequest>()
let nextRequestId = 0

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL('./asrWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<AsrWorkerResponse>) => {
    const msg = event.data
    if (msg.type === 'MODEL_STATUS' && msg.status) {
      statusListener(msg.status)
      return
    }
    if (msg.type === 'RESULT' && msg.id !== undefined) {
      const request = pending.get(msg.id)
      if (!request) return
      pending.delete(msg.id)
      if (msg.error !== undefined) {
        request.reject(new Error(msg.error))
      } else {
        request.resolve(msg.text ?? '')
      }
    }
  }
  worker.onerror = (event) => {
    // Fail all in-flight requests; the inference queue surfaces the error.
    const error = new Error(event.message || 'ASR worker crashed')
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  return worker
}

export function onAsrModelStatus(fn: StatusListener): void {
  statusListener = fn
  onDolphinStatus(fn)
}

export function setAsrMode(mode: AsrMode): void {
  activeTier = tierForMode(mode)
  if (activeTier.engine === 'sherpa-dolphin') {
    // Preload starts the (one-time) model download.
    ensureDolphinModel()
    return
  }
  getWorker().postMessage({ type: 'SET_TIER', mode } satisfies AsrWorkerRequest)
}

export function transcribe(samples: Float32Array, sourceLanguage: string): Promise<string> {
  // Dolphin is a multilingual CTC model: it detects the language itself, so the
  // source language is not forwarded.
  if (activeTier?.engine === 'sherpa-dolphin') return transcribeWithDolphin(samples)

  const id = nextRequestId++
  const promise = new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
  // Transfer the buffer instead of copying — the capture pipeline never
  // touches a chunk again after handing it off.
  getWorker().postMessage(
    { type: 'TRANSCRIBE', id, samples, sourceLanguage } satisfies AsrWorkerRequest,
    [samples.buffer],
  )
  return promise
}

// True while the recognizer is working on a request. A preview decode shares
// that single worker, so it must not be started behind (or ahead of) a real chunk.
export function isAsrBusy(): boolean {
  if (activeTier?.engine === 'sherpa-dolphin') return isDolphinBusy()
  return pending.size > 0
}

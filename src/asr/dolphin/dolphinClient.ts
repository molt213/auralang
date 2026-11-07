// Offscreen-side client for the Dolphin ASR worker (sherpa-onnx wasm runtime).
// Owns the worker lifecycle and the in-flight request map, mirroring the
// surface asrWorker/asrClient provide for the transformers.js tiers, so the
// routing in asrClient stays a one-liner.
import type { ModelStatus } from '../types'
import type { DolphinWorkerRequest, DolphinWorkerResponse } from './types'

type StatusListener = (status: ModelStatus) => void

interface PendingTranscription {
  resolve: (text: string) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let statusListener: StatusListener = () => {}
const pending = new Map<number, PendingTranscription>()
let nextRequestId = 0

function describeError(error: ErrorEvent | Error | unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Unknown Dolphin worker error'
}

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(chrome.runtime.getURL('workers/sherpa-dolphin.worker.js'))
  worker.onmessage = (event: MessageEvent<DolphinWorkerResponse>) => {
    const message = event.data
    if (message.type === 'MODEL_PROGRESS') {
      statusListener({ phase: 'downloading', progress: message.progress })
      return
    }
    if (message.type === 'MODEL_READY') {
      statusListener({ phase: 'ready', tier: 'dolphin' })
      return
    }
    if (message.type === 'MODEL_ERROR') {
      statusListener({ phase: 'error', message: message.message })
      return
    }
    if (message.type === 'TRANSCRIBE_RESULT' || message.type === 'TRANSCRIBE_ERROR') {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.type === 'TRANSCRIBE_RESULT') {
        request.resolve(message.text)
      } else {
        request.reject(new Error(message.message))
      }
    }
  }
  worker.onerror = (event: ErrorEvent) => {
    const error = new Error(`Dolphin worker crashed: ${describeError(event)}`)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    statusListener({ phase: 'error', message: error.message })
  }

  return worker
}

export function onDolphinStatus(fn: StatusListener): void {
  statusListener = fn
}

// Preloads the model (starts the download on first use). Safe to call more
// than once — the worker deduplicates.
export function ensureDolphinModel(): void {
  getWorker().postMessage({ type: 'ENSURE_MODEL' } satisfies DolphinWorkerRequest)
}

export function transcribeWithDolphin(samples: Float32Array): Promise<string> {
  const id = nextRequestId++
  const promise = new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
  // Transfer the buffer instead of copying — the capture pipeline never
  // touches a chunk again after handing it off.
  getWorker().postMessage(
    { type: 'TRANSCRIBE', id, samples } satisfies DolphinWorkerRequest,
    [samples.buffer],
  )
  return promise
}

// True while a transcription is in flight. The worker decodes one stream at a
// time, so a preview decode must never be queued ahead of a real chunk.
export function isDolphinBusy(): boolean {
  return pending.size > 0
}

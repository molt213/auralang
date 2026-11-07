// Wire protocol between the offscreen document and the Dolphin classic worker
// (public/workers/sherpa-dolphin.worker.js). The worker message types are
// plain-JS and must stay in sync with this file.
export type DolphinWorkerRequest =
  | { type: 'ENSURE_MODEL' }
  | { type: 'TRANSCRIBE'; id: number; samples: Float32Array }

export type DolphinWorkerResponse =
  | { type: 'MODEL_PROGRESS'; progress: number }
  | { type: 'MODEL_READY' }
  | { type: 'MODEL_ERROR'; message: string }
  | { type: 'TRANSCRIBE_RESULT'; id: number; text: string }
  | { type: 'TRANSCRIBE_ERROR'; id: number; message: string }

// Prefixes the worker prepends to its errors, mapped to user-facing copy by
// useErrorToasts.
export const DOLPHIN_DOWNLOAD_FAILED_PREFIX = 'Dolphin model download failed'
export const DOLPHIN_MODEL_FAILED_PREFIX = 'Dolphin model load failed'

export type AsrTierId = 'light' | 'balanced' | 'accuracy' | 'dolphin'

// User-selectable model modes. 'auto' picks Light or Balanced from the device's
// capability. 'accuracy' (whisper-small) is planned but not shipped yet.
// 'dolphin' is the Japanese-optimized CTC model running on the sherpa-onnx
// wasm runtime instead of transformers.js.
export type AsrMode = 'auto' | 'light' | 'balanced' | 'dolphin'

// Which runtime loads a tier: transformers.js (WASM/ONNX) or the sherpa-onnx
// wasm runtime used by Dolphin.
export type AsrEngine = 'transformers' | 'sherpa-dolphin'

// Subset of transformers.js dtypes we actually ship rungs for.
export type AsrDtype = 'int8' | 'fp16' | 'fp32' | 'q4'

export interface DtypeRung {
  encoderDtype: AsrDtype
  decoderDtype: AsrDtype
  device: 'wasm' | 'webgpu'
}

interface ModelTierBase {
  id: AsrTierId
  modelId: string
  approxDownloadMB: number
}

export interface TransformersTier extends ModelTierBase {
  engine: 'transformers'
  // Ordered probe list: best option first, safest last. Individual quantized
  // ONNX exports can be broken per repo/per file (seen with whisper-tiny q8),
  // so no rung is ever assumed to work — it's tried, and on load failure the
  // manager falls through to the next one.
  ladder: DtypeRung[]
}

export interface DolphinTier extends ModelTierBase {
  engine: 'sherpa-dolphin'
}

export type ModelTier = TransformersTier | DolphinTier

export type ModelStatus =
  | { phase: 'idle' }
  | { phase: 'downloading'; progress: number } // 0..100
  | { phase: 'probing' }
  | { phase: 'ready'; tier: AsrTierId }
  | { phase: 'error'; message: string }

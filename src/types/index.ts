import type { AsrMode, ModelStatus } from '../asr/types'

export type UiLanguage = 'en' | 'es' | 'zh-CN'
export type UiTheme = 'dark' | 'light'
export type TranslationProvider =
  | 'google'
  | 'mymemory'
  | 'baidu'
  | 'openai-compatible'
  | 'index-translate'

export type FinalTranslationProvider = 'openai-compatible' | 'index-translate'

export interface TranslationConfig {
  provider: TranslationProvider
  baseUrl: string
  model: string
  apiKey: string
  // Baidu's app ID; its secret key travels in apiKey.
  appId: string
}

// The optional second stage: a free service can translate the provisional
// captions while an OpenAI-compatible model produces the final translation.
export interface FinalTranslationConfig {
  enabled: boolean
  provider: FinalTranslationProvider
  baseUrl: string
  model: string
  apiKey: string
}

export interface UserConfig {
  targetLanguage: string
  sourceLanguage: string
  uiLanguage: UiLanguage
  uiTheme: UiTheme
  asrMode: AsrMode
  // Original tab audio volume, 0 (muted) to 1 (full).
  originalVolume: number
  translation: TranslationConfig
  finalTranslation: FinalTranslationConfig
}

export interface TranslationState {
  isActive: boolean
  isLoading: boolean
  isModelReady: boolean
  error: string | null
  transcripts: TranscriptUpdatePayload[]
  modelStatus: ModelStatus | null
}

export interface StartCapturePayload {
  streamId: string
  targetLanguage: string
  sourceLanguage: string
  asrMode: AsrMode
  originalVolume: number
  translation: TranslationConfig
  finalTranslation: FinalTranslationConfig
}

export type StartCaptureRequest = Omit<StartCapturePayload, 'streamId'>

// 'preview' is a provisional line for speech that is still being spoken,
// 'partial' a translation that is still streaming in, and 'cleared' retracts a
// preview whose audio turned out to be silence or a hallucination.
export type TranscriptTranslationStatus =
  | 'preview'
  | 'pending'
  | 'partial'
  | 'translated'
  | 'failed'
  | 'skipped'
  | 'cleared'

export interface TranscriptUpdatePayload {
  segmentId: number
  original: string
  translated: string | null
  // Optional for compatibility with messages from an older offscreen document.
  translationStatus?: TranscriptTranslationStatus
}

export interface CaptureStateResponse {
  active: boolean
  latestSegmentId: number
}

export interface StreamStateResponse {
  capturing: boolean
}

export interface ErrorPayload {
  message: string
}

export interface OriginalVolumePayload {
  // Original tab audio volume, 0 (muted) to 1 (full).
  volume: number
}

export type VideoSubtitleUpdateMessage = {
  type: 'VIDEO_SUBTITLE_UPDATE'
  payload: TranscriptUpdatePayload
}

export type DisposeVideoSubtitleOverlayMessage = {
  type: 'DISPOSE_VIDEO_SUBTITLE_OVERLAY'
}

export type VideoSubtitleMessage = VideoSubtitleUpdateMessage | DisposeVideoSubtitleOverlayMessage

export type ExtensionMessage =
  | { type: 'START_CAPTURE'; payload: StartCaptureRequest }
  | { type: 'STOP_CAPTURE' }
  | { type: 'BEGIN_STREAM'; payload: StartCapturePayload }
  | { type: 'END_STREAM' }
  | { type: 'SET_ORIGINAL_VOLUME'; payload: OriginalVolumePayload }
  | { type: 'MODEL_READY' }
  | { type: 'MODEL_STATUS'; payload: ModelStatus }
  | { type: 'GET_CAPTURE_STATE' }
  | { type: 'GET_STREAM_STATE' }
  | { type: 'CAPTURE_ENDED' }
  | { type: 'TRANSCRIPT_UPDATE'; payload: TranscriptUpdatePayload }
  | VideoSubtitleMessage
  | { type: 'ERROR'; payload: ErrorPayload }

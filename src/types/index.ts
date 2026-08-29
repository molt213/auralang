import type { AsrMode, ModelStatus } from '../asr/types'

export type UiLanguage = 'en' | 'es' | 'zh-CN'
export type UiTheme = 'dark' | 'light'
export type TranslationProvider = 'google' | 'openai-compatible'

export interface TranslationConfig {
  provider: TranslationProvider
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
  // Translation voice volume, 0 (muted) to 1 (full).
  voiceVolume: number
  // Original tab audio volume, 0 (muted) to 1 (full).
  originalVolume: number
  translation: TranslationConfig
}

export interface TranslationState {
  isActive: boolean
  isLoading: boolean
  isModelReady: boolean
  error: string | null
  transcripts: TranscriptUpdatePayload[]
  modelStatus: ModelStatus | null
  // Original transcription of the line currently being read aloud (karaoke), or null.
  speakingOriginal: string | null
}

export interface StartCapturePayload {
  streamId: string
  targetLanguage: string
  sourceLanguage: string
  asrMode: AsrMode
  originalVolume: number
  translation: TranslationConfig
}

export type StartCaptureRequest = Omit<StartCapturePayload, 'streamId'>

export interface TranscriptUpdatePayload {
  original: string
  translated: string | null
}

export interface ErrorPayload {
  message: string
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
  | { type: 'MODEL_READY' }
  | { type: 'MODEL_STATUS'; payload: ModelStatus }
  | { type: 'GET_CAPTURE_STATE' }
  | { type: 'CAPTURE_ENDED' }
  | { type: 'TRANSCRIPT_UPDATE'; payload: TranscriptUpdatePayload }
  | VideoSubtitleMessage
  | { type: 'ERROR'; payload: ErrorPayload }

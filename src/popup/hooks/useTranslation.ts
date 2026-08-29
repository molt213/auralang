import { useState, useCallback, useEffect, useRef } from 'react'
import type {
  CaptureStateResponse,
  ExtensionMessage,
  TranslationState,
  UserConfig,
} from '../../types'
import { speak, stopSpeech, onSpeakingChange } from '../../services/ttsService'
import { externalApiPermissionOrigin } from '../../services/translationService'
import { shouldSpeakTranslation, upsertTranscriptUpdate } from './transcriptUpdates'

export interface UseTranslationReturn {
  state: TranslationState
  toggle: () => void
}

export function useTranslation(
  config: Pick<UserConfig, 'targetLanguage' | 'sourceLanguage' | 'asrMode' | 'voiceVolume' | 'originalVolume' | 'translation'>,
): UseTranslationReturn {
  const [state, setState] = useState<TranslationState>({
    isActive: false,
    isLoading: false,
    isModelReady: false,
    error: null,
    transcripts: [],
    modelStatus: null,
    speakingOriginal: null,
  })

  // The translation voice runs HERE in the side panel, not in the offscreen
  // document: Chrome throttles speechSynthesis in offscreen docs, so the voice
  // was unreliable/silent. The panel is a focused document with real audio.
  const targetLangRef = useRef(config.targetLanguage)
  const voiceVolumeRef = useRef(config.voiceVolume)
  const latestSegmentIdRef = useRef(0)
  const currentCaptureKnownRef = useRef(false)
  const captureStateVersionRef = useRef(0)

  useEffect(() => {
    targetLangRef.current = config.targetLanguage
  }, [config.targetLanguage])

  useEffect(() => {
    voiceVolumeRef.current = config.voiceVolume
  }, [config.voiceVolume])

  // Silence the current utterance immediately when the voice is muted.
  useEffect(() => {
    if (config.voiceVolume === 0) stopSpeech()
  }, [config.voiceVolume])

  useEffect(() => {
    const requestedCaptureStateVersion = captureStateVersionRef.current
    chrome.runtime.sendMessage<ExtensionMessage>(
      { type: 'GET_CAPTURE_STATE' },
      (response: CaptureStateResponse | undefined) => {
        if (
          chrome.runtime.lastError
          || captureStateVersionRef.current !== requestedCaptureStateVersion
        ) {
          return
        }
        latestSegmentIdRef.current = Math.max(latestSegmentIdRef.current, response?.latestSegmentId ?? 0)
        currentCaptureKnownRef.current = response?.active === true
        if (response?.active) {
          setState((prev) => ({ ...prev, isActive: true }))
        }
      },
    )

    // Check if model is already ready (popup opened after model loaded)
    chrome.runtime.sendMessage<ExtensionMessage>(
      { type: 'MODEL_READY' },
      (response: { ready: boolean } | undefined) => {
        if (chrome.runtime.lastError) return // offscreen not up yet
        if (response?.ready) {
          setState((prev) => ({ ...prev, isModelReady: true }))
        }
      },
    )

    // Also listen for the event in case model loads after popup opens
    const handler = (message: ExtensionMessage) => {
      if (message.type === 'MODEL_READY') {
        setState((prev) => ({ ...prev, isModelReady: true }))
      }
      if (message.type === 'MODEL_STATUS') {
        const payload = message.payload
        setState((prev) => ({
          ...prev,
          modelStatus: payload,
          isModelReady: payload.phase === 'ready' ? true : prev.isModelReady,
        }))
      }
      if (message.type === 'ERROR') {
        const payload = message.payload
        setState((prev) => ({ ...prev, error: payload.message }))
      }
      if (message.type === 'CAPTURE_ENDED') {
        stopSpeech()
        captureStateVersionRef.current += 1
        currentCaptureKnownRef.current = false
        setState((prev) => ({
          ...prev,
          isActive: false,
          isLoading: false,
          error: 'captureEnded',
        }))
      }
      if (message.type === 'TRANSCRIPT_UPDATE') {
        const payload = message.payload
        latestSegmentIdRef.current = Math.max(latestSegmentIdRef.current, payload.segmentId)
        // Speak the translation here in the panel (reliable audio). The chunk
        // arrives twice; the first emit has translated === null, so this only
        // fires once the translation is in. Backfilled older lines stay silent
        // so concurrent requests cannot make speech play out of order.
        if (
          shouldSpeakTranslation(
            payload,
            latestSegmentIdRef.current,
            currentCaptureKnownRef.current,
          )
          && voiceVolumeRef.current > 0
        ) {
          speak(payload.translated, targetLangRef.current, payload.original, voiceVolumeRef.current)
        }
        setState((prev) => {
          return { ...prev, transcripts: upsertTranscriptUpdate(prev.transcripts, payload) }
        })
      }
    }
    chrome.runtime.onMessage.addListener(handler)

    // Karaoke highlight is driven locally now that speaking happens in the panel.
    onSpeakingChange((original) => {
      setState((prev) => ({ ...prev, speakingOriginal: original }))
    })

    return () => {
      chrome.runtime.onMessage.removeListener(handler)
      stopSpeech()
    }
  }, [])

  const toggle = useCallback(async () => {
    const starting = !state.isActive
    if (starting && config.translation.provider === 'openai-compatible') {
      try {
        const origin = externalApiPermissionOrigin(config.translation)
        const granted = await chrome.permissions.request({ origins: [origin] })
        if (!granted) {
          throw new Error('externalApiPermissionDenied')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'externalApiSetupFailed'
        setState((prev) => ({ ...prev, error: message }))
        return
      }
    }

    captureStateVersionRef.current += 1
    if (starting) {
      latestSegmentIdRef.current = 0
      currentCaptureKnownRef.current = false
    } else {
      currentCaptureKnownRef.current = false
    }
    stopSpeech() // cut any queued/current utterance on both start and stop
    // Clear the transcript only when starting a new session — keep it visible
    // after Stop so the user can still read what was said.
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      ...(starting ? { transcripts: [], speakingOriginal: null } : {}),
    }))

    const message: ExtensionMessage = state.isActive
      ? { type: 'STOP_CAPTURE' }
      : {
          type: 'START_CAPTURE',
          payload: {
            targetLanguage: config.targetLanguage,
            sourceLanguage: config.sourceLanguage,
            asrMode: config.asrMode,
            originalVolume: config.originalVolume,
            translation: config.translation,
          },
        }

    chrome.runtime.sendMessage<ExtensionMessage>(
      message,
      (response: { success: boolean; error?: string }) => {
        if (chrome.runtime.lastError || !response?.success) {
          if (starting) currentCaptureKnownRef.current = false
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: chrome.runtime.lastError?.message ?? response?.error ?? 'unknownError',
          }))
          return
        }
        if (starting) currentCaptureKnownRef.current = true
        setState((prev) => ({
          ...prev,
          isActive: !prev.isActive,
          isLoading: false,
        }))
      },
    )
  }, [state.isActive, config.targetLanguage, config.sourceLanguage, config.asrMode, config.originalVolume, config.translation])

  return { state, toggle }
}

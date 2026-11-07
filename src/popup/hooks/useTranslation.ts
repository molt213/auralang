import { useState, useCallback, useEffect, useRef } from 'react'
import type {
  CaptureStateResponse,
  ExtensionMessage,
  TranslationState,
  UserConfig,
} from '../../types'
import { externalApiPermissionOrigin } from '../../services/translationService'
import { upsertTranscriptUpdate } from './transcriptUpdates'

export interface UseTranslationReturn {
  state: TranslationState
  toggle: () => void
}

export function useTranslation(
  config: Pick<
    UserConfig,
    'targetLanguage' | 'sourceLanguage' | 'asrMode' | 'originalVolume' | 'translation' | 'finalTranslation'
  >,
): UseTranslationReturn {
  const [state, setState] = useState<TranslationState>({
    isActive: false,
    isLoading: false,
    isModelReady: false,
    error: null,
    transcripts: [],
    modelStatus: null,
  })

  const captureStateVersionRef = useRef(0)

  // The original audio is replayed by the offscreen document (Chrome mutes a
  // captured tab), so a slider change must be forwarded while capture runs.
  useEffect(() => {
    if (!state.isActive) return
    void Promise.resolve(chrome.runtime.sendMessage<ExtensionMessage>({
      type: 'SET_ORIGINAL_VOLUME',
      payload: { volume: config.originalVolume },
    })).catch(() => undefined)
  }, [config.originalVolume, state.isActive])

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
        captureStateVersionRef.current += 1
        setState((prev) => ({
          ...prev,
          isActive: false,
          isLoading: false,
          error: 'captureEnded',
        }))
      }
      if (message.type === 'TRANSCRIPT_UPDATE') {
        const payload = message.payload
        setState((prev) => {
          return { ...prev, transcripts: upsertTranscriptUpdate(prev.transcripts, payload) }
        })
      }
    }
    chrome.runtime.onMessage.addListener(handler)

    return () => {
      chrome.runtime.onMessage.removeListener(handler)
    }
  }, [])

  const toggle = useCallback(async () => {
    const starting = !state.isActive
    if (starting) {
      const provider = config.translation.provider
      const mainHandlesFinal =
        provider === 'openai-compatible' || provider === 'index-translate'
      const finalExternalEnabled =
        config.finalTranslation.enabled && !mainHandlesFinal
      const origins: string[] = []

      if (mainHandlesFinal) {
        try {
          origins.push(externalApiPermissionOrigin(config.translation))
        } catch (error) {
          const message = error instanceof Error ? error.message : 'externalApiSetupFailed'
          setState((prev) => ({ ...prev, error: message }))
          return
        }
      } else if (!finalExternalEnabled) {
        // The main service only fills provisional captions when a final API is
        // configured. Its host is in host_permissions; never let a missing
        // preview grant block the LLM path.
        if (provider === 'baidu') {
          origins.push('https://fanyi-api.baidu.com/*')
        } else if (provider === 'mymemory') {
          origins.push('https://api.mymemory.translated.net/*')
        }
      }

      if (finalExternalEnabled) {
        try {
          origins.push(externalApiPermissionOrigin({
            provider: config.finalTranslation.provider,
            baseUrl: config.finalTranslation.baseUrl,
            model: config.finalTranslation.model,
            apiKey: config.finalTranslation.apiKey,
            appId: '',
          }))
        } catch (error) {
          const message = error instanceof Error ? error.message : 'externalApiSetupFailed'
          setState((prev) => ({ ...prev, error: message }))
          return
        }
      }

      // Ask for the service hosts explicitly: a rebuilt extension can still be
      // running an older manifest whose host_permissions do not include them,
      // and a cross-origin request without that grant fails as a CORS error.
      if (origins.length > 0) {
        try {
          const granted = await chrome.permissions.request({ origins })
          if (!granted) {
            setState((prev) => ({
              ...prev,
              error: mainHandlesFinal || finalExternalEnabled
                ? 'externalApiPermissionDenied'
                : 'translationPermissionDenied',
            }))
            return
          }
        } catch (error) {
          // A host already granted through host_permissions may not be
          // requestable. Embedded extension pages can also refuse the prompt;
          // in both cases an existing grant is enough to continue.
          const alreadyGranted = await chrome.permissions
            .contains({ origins })
            .catch(() => false)
          if (!alreadyGranted) {
            const message = error instanceof Error ? error.message : 'externalApiSetupFailed'
            setState((prev) => ({ ...prev, error: message }))
            return
          }
        }
      }
    }

    captureStateVersionRef.current += 1
    // Clear the transcript only when starting a new session — keep it visible
    // after Stop so the user can still read what was said.
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      ...(starting ? { transcripts: [] } : {}),
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
            finalTranslation: config.finalTranslation,
          },
        }

    chrome.runtime.sendMessage<ExtensionMessage>(
      message,
      (response: { success: boolean; error?: string }) => {
        if (chrome.runtime.lastError || !response?.success) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: chrome.runtime.lastError?.message ?? response?.error ?? 'unknownError',
          }))
          return
        }
        setState((prev) => ({
          ...prev,
          isActive: !prev.isActive,
          isLoading: false,
        }))
      },
    )
  }, [state.isActive, config.targetLanguage, config.sourceLanguage, config.asrMode, config.originalVolume, config.translation, config.finalTranslation])

  return { state, toggle }
}
import {
  getPendingAudio,
  isAudioCaptureActive,
  startAudioCapture,
  setOriginalVolume,
  stopAudioCapture,
} from './audioCapture'
import {
  lastTranscriptionText,
  pendingSegmentId,
  processAudioChunk,
  resetPipelineState,
} from './pipeline'
import {
  forgetPreviewTranslation,
  rememberPreviewTranslation,
} from './previewTranslations'
import { isAsrBusy, onAsrModelStatus, setAsrMode, transcribe } from './asrClient'
import { resolveFinalTranslationConfig } from './translationConfigs'
import {
  createPreviewScheduler,
  PREVIEW_TRANSLATE_TIMEOUT_MS,
} from './previewPipeline'
import type { PreviewScheduler } from './previewPipeline'
import { translateText } from '../services/translationService'
import { isWrongLanguageOutput, stripSeamRepeat } from '../utils/text'
import { enqueueChunk, clearQueue } from '../asr/inferenceQueue'
import { chunkingForEngine } from '../asr/chunking'
import { tierForMode } from '../asr/registry'
import type { ExtensionMessage, TranscriptUpdatePayload } from '../types'

let modelReady = false
let previewScheduler: PreviewScheduler | null = null

function emitTranscript(update: TranscriptUpdatePayload): void {
  // Keep the provisional translation available for the settled row. The store
  // is cleared once the utterance reaches a terminal state, so it cannot grow
  // without bound over a long stream.
  if (update.translationStatus === 'preview') {
    rememberPreviewTranslation(update.segmentId, update.translated)
  } else if (
    update.translationStatus === 'translated'
    || update.translationStatus === 'failed'
    || update.translationStatus === 'skipped'
    || update.translationStatus === 'cleared'
  ) {
    forgetPreviewTranslation(update.segmentId)
  }

  void chrome.runtime.sendMessage<ExtensionMessage>({
    type: 'TRANSCRIPT_UPDATE',
    payload: update,
  })
}

function stopPreviewScheduler(): void {
  previewScheduler?.reset()
  previewScheduler = null
}

onAsrModelStatus((status) => {
  modelReady = status.phase === 'ready'
  if (status.phase === 'ready') {
    // Kept alongside MODEL_STATUS so the popup's existing readiness check
    // works during the migration.
    void chrome.runtime.sendMessage<ExtensionMessage>({ type: 'MODEL_READY' })
  }
  // A failed model load/download must reach the panel as a toast, otherwise the
  // UI stays on "Loading model…" with no way out.
  if (status.phase === 'error') {
    void chrome.runtime.sendMessage<ExtensionMessage>({
      type: 'ERROR',
      payload: { message: status.message },
    })
  }
  void chrome.runtime.sendMessage<ExtensionMessage>({ type: 'MODEL_STATUS', payload: status })
})

// The model tier is not loaded eagerly: this document can't read chrome.storage
// (see modelManager), so the popup tells us which mode to load on START_CAPTURE.

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'BEGIN_STREAM') {
      const {
        streamId,
        targetLanguage,
        sourceLanguage,
        asrMode,
        originalVolume,
        translation,
        finalTranslation,
      } = message.payload

      // Guarantee the selected tier is (loading) before capture, in case the
      // popup's preload SET_ASR_MODE never reached us. No-op if already loaded.
      setAsrMode(asrMode)

      // The main service fills provisional captions. When the user configured
      // a separate final API, only the settled translation uses it — a free
      // service that is down must not take the LLM result down with it.
      const finalTranslationConfig = resolveFinalTranslationConfig(translation, finalTranslation)

      // Provisional captions for speech that is still being spoken: decode the
      // buffer that has not been cut yet, translate it with the main service,
      // and let the settled caption replace it in place.
      const scheduler = createPreviewScheduler({
        transcribePreview: async (audio) => {
          const text = await transcribe(audio.samples, sourceLanguage)
          // A preview in a script the source language cannot produce is the
          // same detection miss the settled pipeline drops; an empty string
          // keeps the scheduler from showing it.
          if (isWrongLanguageOutput(text, sourceLanguage)) return ''
          // The preview decodes the same run-in the settled chunk will, so it
          // strips the same seam text — otherwise the line shrinks on settle.
          return stripSeamRepeat(lastTranscriptionText(), text, {
            carriedSeam: audio.carriedSeam,
          })
        },
        translatePreview: (text, onPartial) =>
          translateText(text, targetLanguage, sourceLanguage, {
            config: translation,
            signal: AbortSignal.timeout(PREVIEW_TRANSLATE_TIMEOUT_MS),
            onPartial,
          }).catch(() => null),
        emit: emitTranscript,
        segmentId: pendingSegmentId,
        isAsrBusy,
      })
      previewScheduler = scheduler

      startAudioCapture(streamId, {
        onChunk: (chunk) => {
          enqueueChunk(chunk, async (queued) => {
            try {
              await processAudioChunk(
                queued.samples,
                targetLanguage,
                sourceLanguage,
                finalTranslationConfig,
                {
                  onTranscript: emitTranscript,
                  onTranslationError: (errorCode) => {
                    console.error('[AuraLang] Translation error:', errorCode)
                    void chrome.runtime.sendMessage<ExtensionMessage>({
                      type: 'ERROR',
                      payload: { message: errorCode },
                    })
                  },
                  onPreviewDropped: (segmentId) => {
                    emitTranscript({
                      segmentId,
                      original: '',
                      translated: null,
                      translationStatus: 'cleared',
                    })
                    // A preview that was decoded from the dropped chunk must not
                    // land after its retraction and resurrect the phantom line.
                    // Reset this session's scheduler, not a newer one that may
                    // have started while the old chunk was still in flight.
                    scheduler.reset()
                  },
                },
                {
                  carriedSeam: queued.carriedSeam,
                  endedOnPause: queued.endedOnPause,
                  silenceBeforeMs: queued.silenceBeforeMs,
                },
              )
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Pipeline error'
              console.error('[AuraLang] Pipeline error:', msg)
              void chrome.runtime.sendMessage<ExtensionMessage>({
                type: 'ERROR',
                payload: { message: msg },
              })
            }
          })
        },
        onError: (msg) => {
          console.error('[AuraLang] Capture error:', msg)
          void chrome.runtime.sendMessage<ExtensionMessage>({
            type: 'ERROR',
            payload: { message: msg },
          })
        },
        onEnded: () => {
          clearQueue()
          resetPipelineState()
          stopPreviewScheduler()
          void chrome.runtime.sendMessage<ExtensionMessage>({ type: 'CAPTURE_ENDED' })
        },
        onAudioTick: () => {
          previewScheduler?.tick(getPendingAudio)
        },
      }, { originalVolume, chunking: chunkingForEngine(tierForMode(asrMode).engine) })
        .then(() => {
          sendResponse({ success: true })
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Capture failed'
          console.error('[AuraLang] startAudioCapture failed:', msg)
          sendResponse({ success: false, error: msg })
        })

      return true
    }

    if (message.type === 'GET_STREAM_STATE') {
      sendResponse({ capturing: isAudioCaptureActive() })
      return false
    }

    if (message.type === 'MODEL_READY') {
      sendResponse({ ready: modelReady })
      return false
    }

    if (message.type === 'SET_ORIGINAL_VOLUME') {
      const { volume } = message.payload
      if (typeof volume === 'number' && Number.isFinite(volume)) setOriginalVolume(volume)
      return false
    }

    if (message.type === 'END_STREAM') {
      stopAudioCapture()
      clearQueue()
      resetPipelineState()
      stopPreviewScheduler()
      sendResponse({ success: true })
    }
  },
)

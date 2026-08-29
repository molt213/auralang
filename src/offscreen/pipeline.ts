import { transcribe } from './asrClient'
import { PrioritizedTranslationQueue } from './latestTranslationQueue'
import { translateText } from '../services/translationService'
import { stopSpeech } from '../services/ttsService'
import { isSilent } from '../utils/audioLevel'
import { isSilenceHallucination, stripSeamRepeat } from '../utils/text'
import type { TranscriptUpdatePayload, TranslationConfig } from '../types'

let lastTranscription = ''
let sessionId = 0
let nextSegmentId = 0
const translationQueue = new PrioritizedTranslationQueue()

function translationErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'translationFailed'

  const { message } = error
  if (
    message.startsWith('googleTranslationRequestFailed:')
    || message.startsWith('externalApi')
  ) {
    return message
  }

  return 'translationFailed'
}

export function createTranslationResultUpdate(
  segmentId: number,
  original: string,
  translation: string | null,
): TranscriptUpdatePayload {
  const translated = translation?.trim() ?? ''
  return {
    segmentId,
    original,
    translated: translated || null,
    translationStatus: translated ? 'translated' : 'failed',
  }
}

export function resetPipelineState(): void {
  lastTranscription = ''
  translationQueue.clear()
  sessionId += 1
  stopSpeech()
}

export async function processAudioChunk(
  samples: Float32Array,
  targetLanguage: string,
  sourceLanguage: string,
  translationConfig: TranslationConfig,
  onTranscript: (update: TranscriptUpdatePayload) => void,
  onTranslationError: (errorCode: string) => void,
): Promise<void> {
  if (isSilent(samples)) return

  const chunkSessionId = sessionId
  const raw = await transcribe(samples, sourceLanguage)
  if (sessionId !== chunkSessionId) return

  // A chunk that is exactly one of Whisper's known silence/noise fillers
  // ("you", "Thank you", …) is a hallucination, not speech. Drop it WITHOUT
  // touching lastTranscription — otherwise it slips between two identical
  // real lines and breaks the consecutive-duplicate check below.
  if (isSilenceHallucination(raw)) return

  // Chunks are cut mid-stream, so Whisper often re-emits the tail of the
  // previous chunk at the start of this one — drop that seam overlap.
  const transcription = stripSeamRepeat(lastTranscription, raw)
  if (!transcription || transcription === lastTranscription) return

  lastTranscription = transcription
  const segmentId = ++nextSegmentId
  onTranscript({
    segmentId,
    original: transcription,
    translated: null,
    translationStatus: 'pending',
  })

  translationQueue.enqueue(async (signal) => {
    try {
      const translation = await translateText(
        transcription,
        targetLanguage,
        sourceLanguage,
        translationConfig,
        signal,
      )
      if (signal.aborted || sessionId !== chunkSessionId) return
      const result = createTranslationResultUpdate(segmentId, transcription, translation)
      onTranscript(result)
      if (result.translationStatus !== 'translated') {
        return
      }

      // The voice is spoken in the side panel (see useTranslation) from this same
      // TRANSCRIPT_UPDATE — speechSynthesis is unreliable in the offscreen document.
    } catch (error) {
      if (signal.aborted || sessionId !== chunkSessionId) return
      onTranscript(createTranslationResultUpdate(segmentId, transcription, null))
      onTranslationError(translationErrorCode(error))
    }
  }, () => {
    if (sessionId !== chunkSessionId) return
    onTranscript({
      segmentId,
      original: transcription,
      translated: null,
      translationStatus: 'skipped',
    })
  })
}

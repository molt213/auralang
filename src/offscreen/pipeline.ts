import { transcribe } from './asrClient'
import { createPartialThrottle } from './partialThrottle'
import { clearPreviewTranslations, previewTranslationFor } from './previewTranslations'
import { PrioritizedTranslationQueue } from './latestTranslationQueue'
import { canExtendSentence, extendSentence, keepsSentenceOpen } from './sentenceAssembly'
import type { OpenSentence } from './sentenceAssembly'
import { translateText } from '../services/translationService'
import { isSilent } from '../utils/audioLevel'
import {
  isPunctuationOnly,
  isRepetitionHallucination,
  isSilenceHallucination,
  isWrongLanguageOutput,
  stripSeamRepeat,
} from '../utils/text'
import type { TranscriptUpdatePayload, TranslationConfig } from '../types'

let lastTranscription = ''
// The line the next chunk may still belong to (see sentenceAssembly.ts).
let openSentence: OpenSentence | null = null
let sessionId = 0
let nextSegmentId = 0
// Bumped whenever a line is amended, so an answer for its earlier, shorter
// text cannot overwrite the merged line.
const sentenceRevisions = new Map<number, number>()
const translationQueue = new PrioritizedTranslationQueue()

function bumpRevision(segmentId: number): number {
  const revision = (sentenceRevisions.get(segmentId) ?? 0) + 1
  sentenceRevisions.set(segmentId, revision)
  return revision
}

function isCurrentRevision(
  segmentId: number,
  revision: number,
  chunkSessionId: number,
): boolean {
  return sessionId === chunkSessionId && sentenceRevisions.get(segmentId) === revision
}

export interface PipelineCallbacks {
  onTranscript: (update: TranscriptUpdatePayload) => void
  onTranslationError: (errorCode: string) => void
  // The provisional preview line for the upcoming segment must be retracted
  // when the chunk it previewed turns out to hold no caption.
  onPreviewDropped: (segmentId: number) => void
}

// The id the utterance currently being spoken will get once it is finalized.
// Previews label themselves with it, so the final update replaces them in place.
export function pendingSegmentId(): number {
  return nextSegmentId + 1
}

// The last accepted caption line. Previews decoded with a cap-split run-in use
// it to strip the audio they share with the settled line.
export function lastTranscriptionText(): string {
  return lastTranscription
}

export interface ProcessAudioOptions {
  // The chunk starts with a run-in copied from the previous chunk, so a
  // repeated run at its seam is duplicated audio rather than new speech.
  carriedSeam?: boolean
  // The chunk ended on the profile's full pause, the only cut that can end a
  // sentence (short pauses and the safety cap land inside one).
  endedOnPause?: boolean
  // Silence dropped between the previous chunk and this one. A long gap ends
  // the thought even when the text still ends on a binding particle.
  silenceBeforeMs?: number
}

// Longer than any pause the cutter waits for (1.4 s at most), so this is a real
// break in speech rather than a mid-sentence breath.
const RESUME_SILENCE_MS = 4000

function translationErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'translationFailed'

  const { message } = error
  if (
    message.startsWith('googleTranslationRequestFailed:')
    || message.startsWith('externalApi')
    || message.startsWith('indexTranslate')
    || message.startsWith('mymemory')
    || message.startsWith('baidu')
  ) {
    return message
  }

  return 'translationFailed'
}

export function createTranslationResultUpdate(
  segmentId: number,
  original: string,
  translation: string | null,
  fallback: string | null = null,
): TranscriptUpdatePayload {
  const realTranslation = translation?.trim() ?? ''
  // The fallback is the provisional translation from the preview. A failed
  // request must not erase the only line the viewer can read.
  const translated = realTranslation || fallback?.trim() || ''
  return {
    segmentId,
    original,
    translated: translated || null,
    translationStatus: realTranslation ? 'translated' : 'failed',
  }
}

export function resetPipelineState(): void {
  lastTranscription = ''
  openSentence = null
  sentenceRevisions.clear()
  translationQueue.clear()
  clearPreviewTranslations()
  sessionId += 1
}

export async function processAudioChunk(
  samples: Float32Array,
  targetLanguage: string,
  sourceLanguage: string,
  translationConfig: TranslationConfig,
  callbacks: PipelineCallbacks,
  options: ProcessAudioOptions = {},
): Promise<void> {
  const { onTranscript, onTranslationError, onPreviewDropped } = callbacks
  const previewSegmentId = pendingSegmentId()
  const dropPreview = (): void => onPreviewDropped(previewSegmentId)

  // A long quiet gap ends the previous thought: the next chunk opens a new
  // line instead of being appended to a sentence the speaker already left.
  // Done before the decode so a filtered chunk cannot carry the old line over.
  if ((options.silenceBeforeMs ?? 0) >= RESUME_SILENCE_MS) openSentence = null

  if (isSilent(samples)) {
    dropPreview()
    return
  }

  const chunkSessionId = sessionId
  const raw = await transcribe(samples, sourceLanguage)
  if (sessionId !== chunkSessionId) return

  // Silence/noise fillers and long looping phrases are hallucinations, not
  // speech. Drop them before a transcript line or translation task is created.
  // Keep lastTranscription unchanged so a filtered chunk cannot affect the
  // consecutive-duplicate check for real speech around it.
  if (isSilenceHallucination(raw) || isRepetitionHallucination(raw) || isPunctuationOnly(raw)) {
    dropPreview()
    return
  }
  // A decode in a script the configured source language cannot produce (Korean
  // from a Japanese stream) is a language-detection miss on marginal audio.
  if (isWrongLanguageOutput(raw, sourceLanguage)) {
    dropPreview()
    return
  }

  // Chunks are cut mid-stream, so Whisper often re-emits the tail of the
  // previous chunk at the start of this one — drop that seam overlap. Dolphin
  // cap splits replay the tail as a run-in on purpose; its scripts have no
  // word spacing, so the character overlap covers the same seam. A line that is
  // being extended is one sentence, so a repeated run at its seam is an
  // artefact there too.
  const extendsLine = canExtendSentence(openSentence, raw)
  const transcription = stripSeamRepeat(lastTranscription, raw, {
    carriedSeam: options.carriedSeam === true || (extendsLine && sourceLanguage === 'ja'),
  })
  if (!transcription || transcription === lastTranscription) {
    dropPreview()
    return
  }

  lastTranscription = transcription
  // The original is assembled first and segmented later: while the previous
  // line is still the same sentence, this chunk is appended to it; otherwise it
  // opens a new line. See sentenceAssembly.ts for the closing rule.
  const line: OpenSentence = extendsLine && openSentence
    ? extendSentence(openSentence, transcription)
    : {
        segmentId: ++nextSegmentId,
        original: transcription,
        extensions: 0,
      }
  openSentence = keepsSentenceOpen(line.original, sourceLanguage, options.endedOnPause === true)
    ? line
    : null
  const { segmentId, original } = line

  // Amending a line restarts its translation; the revision makes any answer
  // for the shorter text a stale message the UI never sees.
  const revision = bumpRevision(segmentId)
  // The preview translation belongs to the pre-merge fragment; the row keeps
  // its previous translation on screen until the merged one starts streaming.
  const fallbackTranslation = extendsLine ? null : previewTranslationFor(segmentId)

  onTranscript({
    segmentId,
    original,
    translated: fallbackTranslation,
    translationStatus: 'pending',
  })
  // The provisional line decoded for this chunk is now inside the merged line.
  if (extendsLine) dropPreview()

  translationQueue.enqueue(async (signal) => {
    const isStale = (): boolean =>
      signal.aborted || !isCurrentRevision(segmentId, revision, chunkSessionId)
    // Tokens arrive faster than the UI needs them; the throttle keeps the
    // caption growing steadily instead of re-rendering per token.
    const emitPartial = createPartialThrottle((partial) => {
      if (isStale()) return
      onTranscript({
        segmentId,
        original,
        translated: partial,
        translationStatus: 'partial',
      })
    })

    try {
      const translation = await translateText(original, targetLanguage, sourceLanguage, {
        config: translationConfig,
        signal,
        onPartial: (partial) => emitPartial.push(partial),
      })
      if (isStale()) return
      const result = createTranslationResultUpdate(segmentId, original, translation)
      onTranscript(result)
    } catch (error) {
      if (isStale()) return
      onTranscript(createTranslationResultUpdate(
        segmentId,
        original,
        null,
        fallbackTranslation,
      ))
      onTranslationError(translationErrorCode(error))
    }
  }, () => {
    if (!isCurrentRevision(segmentId, revision, chunkSessionId)) return
    onTranscript({
      segmentId,
      original,
      translated: fallbackTranslation,
      translationStatus: 'skipped',
    })
  })
}

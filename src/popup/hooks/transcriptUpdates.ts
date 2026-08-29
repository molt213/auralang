import type { TranscriptTranslationStatus, TranscriptUpdatePayload } from '../../types'
import { MAX_TRANSCRIPT_ENTRIES } from '../../constants/transcript'

function statusOf(update: TranscriptUpdatePayload): TranscriptTranslationStatus {
  if (update.translationStatus) return update.translationStatus
  return update.translated === null ? 'pending' : 'translated'
}

export function shouldSpeakTranslation(
  update: TranscriptUpdatePayload,
  latestSegmentId: number,
  isCurrentCaptureKnown: boolean,
): update is TranscriptUpdatePayload & { translated: string } {
  return isCurrentCaptureKnown
    && typeof update.translated === 'string'
    && Boolean(update.translated.trim())
    && statusOf(update) === 'translated'
    && update.segmentId === latestSegmentId
}

export function upsertTranscriptUpdate(
  transcripts: TranscriptUpdatePayload[],
  update: TranscriptUpdatePayload,
): TranscriptUpdatePayload[] {
  const matchingIndex = transcripts.findIndex((entry) => entry.segmentId === update.segmentId)
  if (matchingIndex === -1) {
    return [...transcripts, update]
      .sort((first, second) => first.segmentId - second.segmentId)
      .slice(-MAX_TRANSCRIPT_ENTRIES)
  }

  const current = transcripts[matchingIndex]
  if (!current) return transcripts

  const currentStatus = statusOf(current)
  const incomingStatus = statusOf(update)
  if (
    (currentStatus === 'translated' && incomingStatus !== 'translated')
    || (currentStatus !== 'pending' && incomingStatus === 'pending')
  ) {
    return transcripts
  }

  const next = [...transcripts]
  next[matchingIndex] = update
  return next
}

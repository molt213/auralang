import type { TranscriptTranslationStatus, TranscriptUpdatePayload } from '../../types'
import { MAX_TRANSCRIPT_ENTRIES } from '../../constants/transcript'
import { stripTrailingSentencePunctuation } from '../../utils/text'
import { isStreamingTranslationReady } from '../../utils/translationStream'

function statusOf(update: TranscriptUpdatePayload): TranscriptTranslationStatus {
  if (update.translationStatus) return update.translationStatus
  return update.translated === null || update.translated.trim() === '' ? 'pending' : 'translated'
}

// A caption only moves forward: a preview becomes a pending/streaming caption,
// which becomes a settled one. Anything that would walk a row back is a late
// message from a superseded request and must not overwrite what is on screen.
const STATUS_RANK: Record<TranscriptTranslationStatus, number> = {
  preview: 0,
  pending: 1,
  partial: 2,
  translated: 3,
  failed: 3,
  skipped: 3,
  cleared: 4,
}

export function upsertTranscriptUpdate(
  transcripts: TranscriptUpdatePayload[],
  update: TranscriptUpdatePayload,
): TranscriptUpdatePayload[] {
  const matchingIndex = transcripts.findIndex((entry) => entry.segmentId === update.segmentId)

  // A dropped chunk retracts the provisional line it was previewing; no other
  // update ever removes a row.
  if (statusOf(update) === 'cleared') {
    const current = matchingIndex === -1 ? undefined : transcripts[matchingIndex]
    if (!current || statusOf(current) !== 'preview') return transcripts
    return transcripts.filter((entry) => entry.segmentId !== update.segmentId)
  }

  if (matchingIndex === -1) {
    return [...transcripts, update]
      .sort((first, second) => first.segmentId - second.segmentId)
      .slice(-MAX_TRANSCRIPT_ENTRIES)
  }

  const current = transcripts[matchingIndex]
  if (!current) return transcripts

  const currentStatus = statusOf(current)
  const incomingStatus = statusOf(update)
  const currentText = current.translated?.trim() ?? ''
  const incomingText = update.translated?.trim() ?? ''

  // A pending caption has no translation of its own yet, so the preview's
  // provisional one may keep growing — or arrive late — until the real
  // translation starts streaming. A failed/skipped row with no text can still
  // be filled by a preview that was in flight when the request failed. The row
  // keeps its own status in every case.
  if (
    incomingStatus === 'preview'
    && (currentStatus === 'pending' || currentStatus === 'failed' || currentStatus === 'skipped')
  ) {
    if (!incomingText) return transcripts
    if ((currentStatus === 'failed' || currentStatus === 'skipped') && currentText) return transcripts
    const next = [...transcripts]
    next[matchingIndex] = { ...current, translated: incomingText }
    return next
  }

  // A completed translation must not be walked back to a failure, a retraction
  // or another provisional state.
  const currentOriginal = current.original.trim()
  const incomingOriginal = update.original.trim()

  // Rows never shrink back to the text they were extended from. A late answer
  // for the shorter text of a line that has since been extended is stale; a
  // settled caption replacing a longer preview is not (that direction only
  // happens while the row is still a preview).
  const shortenedPreviousText =
    incomingStatus !== 'preview'
    && currentStatus !== 'preview'
    && incomingOriginal.length < currentOriginal.length
    && currentOriginal.startsWith(stripTrailingSentencePunctuation(incomingOriginal))
  if (shortenedPreviousText) return transcripts

  // A sentence continued in the next chunk amends the line it was cut from:
  // the original grows and its translation restarts. That is the one case
  // where a row may step back to pending. The join drops the boundary period
  // the recognizer added, so the prefix is compared without it.
  const extendsOriginal =
    incomingStatus === 'pending'
    && incomingOriginal.length > currentOriginal.length
    && incomingOriginal.startsWith(stripTrailingSentencePunctuation(currentOriginal))

  if (!extendsOriginal && currentStatus === 'translated' && incomingStatus !== 'translated') {
    return transcripts
  }

  // Late messages for an earlier phase must not overwrite a newer one.
  if (!extendsOriginal && STATUS_RANK[incomingStatus] < STATUS_RANK[currentStatus]) {
    return transcripts
  }

  // A streaming update without text is a no-op, not a request to blank the row.
  if (incomingStatus === 'partial' && !incomingText) return transcripts

  // The provisional translation outlives the preview it came from. It is the
  // only translation the viewer has until the real one lands, so a terminal
  // update without text (LLM failure, queue discard) carries it forward.
  const nextUpdate =
    (incomingStatus === 'pending' || incomingStatus === 'failed' || incomingStatus === 'skipped')
    && currentText
    && !incomingText
      ? { ...update, translated: currentText }
      : update

  // The provisional translation is a complete line; the first few tokens of
  // the LLM stream would make it visibly shrink. Let the stream take over once
  // it has a phrase of its own, then every later partial replaces the previous.
  if (
    incomingStatus === 'partial'
    && currentText
    && (currentStatus === 'preview' || currentStatus === 'pending')
    && !isStreamingTranslationReady(incomingText, currentText)
  ) {
    return transcripts
  }

  const next = [...transcripts]
  next[matchingIndex] = nextUpdate
  return next
}

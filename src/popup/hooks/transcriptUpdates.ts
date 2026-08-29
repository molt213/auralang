import type { TranscriptUpdatePayload } from '../../types'

const MAX_TRANSCRIPTS = 50

export function upsertTranscriptUpdate(
  transcripts: TranscriptUpdatePayload[],
  update: TranscriptUpdatePayload,
): TranscriptUpdatePayload[] {
  const matchingIndex = transcripts.findIndex((entry) => entry.segmentId === update.segmentId)
  if (matchingIndex === -1) {
    return [...transcripts, update].slice(-MAX_TRANSCRIPTS)
  }

  const current = transcripts[matchingIndex]
  if (current?.translated !== null && update.translated === null) {
    return transcripts
  }

  const next = [...transcripts]
  next[matchingIndex] = update
  return next
}

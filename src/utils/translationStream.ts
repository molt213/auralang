// The provisional translation is already a complete line. Replacing it with the
// first token of the LLM stream would make the caption visibly shrink, so the
// stream takes over only once it has a phrase of its own. The final update
// always replaces the line regardless of length.
const STREAM_READY_MIN_CHARS = 12
const STREAM_READY_PUNCTUATION = /[。！？!?…,，、;；:：]/

export function isStreamingTranslationReady(partial: string, provisional: string): boolean {
  const text = partial.trim()
  if (!text) return false
  if (STREAM_READY_PUNCTUATION.test(text)) return true

  const provisionalLength = provisional.trim().length
  if (text.length >= STREAM_READY_MIN_CHARS) return true
  return provisionalLength > 0 && text.length >= Math.max(6, provisionalLength * 0.5)
}

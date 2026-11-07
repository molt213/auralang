// A chunk boundary is not a sentence boundary. Dolphin cuts on acoustic pauses
// and the safety cap, and a speaker can pause mid-clause — "…事前予告を。" |
// "させて頂ければと思いました。" — or still be talking when the cap hits. So the
// original line is assembled first and segmented later: it stays open across
// the cuts that land inside a sentence, and only closes when a full pause
// coincides with a text ending that can end one. When it stays open, the next
// chunk is appended and the whole line is re-translated.
import { hasUnfinishedEnding, joinMidSentenceText } from '../utils/text'

export interface OpenSentence {
  segmentId: number
  original: string
  // Chunks already appended to the line that opened it.
  extensions: number
}

// Japanese sentences are short; a line this long is already beyond a sentence
// and appending more would only make the translation harder to follow.
const MAX_SENTENCE_CHARS = 160
const MAX_EXTENSIONS = 2

export function canExtendSentence(open: OpenSentence | null, nextText: string): boolean {
  if (!open || !nextText.trim()) return false
  if (open.original.length + nextText.length > MAX_SENTENCE_CHARS) return false
  return open.extensions < MAX_EXTENSIONS
}

/**
 * Whether the assembled line stays open for the next chunk.
 *
 * Only a full pause can end a sentence. On top of that, Japanese needs an
 * ending that can close one: a line ending on a particle or a subordinate form
 * is still going. Other source languages have no signal this module can read,
 * so their lines keep closing at every chunk (the previous behaviour).
 */
export function keepsSentenceOpen(
  original: string,
  sourceLanguage: string,
  endedOnPause: boolean,
): boolean {
  if (sourceLanguage !== 'ja') return false
  if (!endedOnPause) return true
  return hasUnfinishedEnding(original, sourceLanguage)
}

export function extendSentence(open: OpenSentence, text: string): OpenSentence {
  return {
    segmentId: open.segmentId,
    original: joinMidSentenceText(open.original, text),
    extensions: open.extensions + 1,
  }
}

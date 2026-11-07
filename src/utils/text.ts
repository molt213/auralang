const normalizeWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// Whisper's documented silence/noise hallucinations: on audio with no real
// speech (background music, game ambience, outros) it emits one of a small,
// well-known set of filler phrases. Only ever matched against the ENTIRE
// chunk — "you" inside a real sentence is never touched.
const SILENCE_HALLUCINATIONS = new Set([
  'you',
  'thank you',
  'thankyou',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'bye',
  'ご視聴ありがとうございました',
])

const MIN_LOOPING_TEXT_LENGTH = 18
const MIN_LOOPING_REPETITIONS = 4
const MAX_LOOPING_UNIT_LENGTH = 48

export function isSilenceHallucination(text: string): boolean {
  const normalized = text.split(/\s+/).filter(Boolean).map(normalizeWord).join(' ')
  return SILENCE_HALLUCINATIONS.has(normalized)
}

// Punctuation-only output is not speech. Dolphin's tokenizer includes
// punctuation tokens, so marginal audio (outro music, room noise, a lone
// breath) can decode to "。" or ",." — which would otherwise surface as a
// transcript line and get translated and spoken. Letters and numbers cover
// latin, kana and CJK ideographs, so this works for every language.
export function isPunctuationOnly(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text)
}

const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/

// Dolphin detects the language itself — sherpa-onnx exposes no way to force it —
// and marginal audio can lock onto the wrong one of its 40 languages (a lone
// breath decoding to Korean "다" on a Japanese stream). Kana and Hangul are
// exclusive to Japanese and Korean, so a decode whose script cannot belong to
// the configured source language is junk. Latin-script source languages have no
// equally clean signal and are left alone.
export function isWrongLanguageOutput(text: string, sourceLanguage: string): boolean {
  if (sourceLanguage === 'ja') return HANGUL.test(text)
  if (sourceLanguage === 'ko') return KANA.test(text)
  if (sourceLanguage === 'zh') return KANA.test(text) || HANGUL.test(text)
  return false
}

// Some Whisper loops are repeated phrases without word boundaries, especially
// in Japanese ("この子供この子供…"). The loop can begin after normal speech or
// switch to another repeated unit, so look for a long periodic run anywhere
// in the result instead of requiring the whole tail to share one period.
export function isRepetitionHallucination(text: string): boolean {
  const characters = Array.from(normalizeWord(text))
  if (characters.length < MIN_LOOPING_TEXT_LENGTH) return false

  const maxUnitLength = Math.min(
    MAX_LOOPING_UNIT_LENGTH,
    Math.floor(characters.length / MIN_LOOPING_REPETITIONS),
  )

  for (let unitLength = 1; unitLength <= maxUnitLength; unitLength++) {
    const minRunLength = Math.max(
      MIN_LOOPING_TEXT_LENGTH,
      unitLength * MIN_LOOPING_REPETITIONS,
    )
    let matchingRunLength = 0

    for (let index = unitLength; index < characters.length; index++) {
      if (characters[index] === characters[index - unitLength]) {
        matchingRunLength += 1
        if (matchingRunLength + unitLength >= minRunLength) {
          return true
        }
      } else {
        matchingRunLength = 0
      }
    }
  }

  return false
}

// Japanese and Chinese are written without word spacing, so the word overlap
// below can never match a partial seam in those scripts. The character rule is
// only used for chunks that were decoded with a run-in from the previous chunk
// (see CHUNKING `seamRunInMs`): there the repeated run is audio the recognizer
// saw twice, not the speaker repeating themselves.
const MIN_CHARACTER_SEAM_OVERLAP = 3
const MAX_CHARACTER_SEAM_OVERLAP = 24

export interface SeamStripOptions {
  // The chunk was decoded with a copy of the previous chunk's tail prepended.
  carriedSeam?: boolean
}

function stripCharacterSeamRepeat(previous: string, text: string): string {
  const previousChars = Array.from(previous).map(normalizeWord).join('')
  if (!previousChars) return text

  const characters = Array.from(text)
  const normalized: string[] = []
  const indexes: number[] = []
  for (let index = 0; index < characters.length; index++) {
    const value = normalizeWord(characters[index])
    if (!value) continue
    normalized.push(value)
    indexes.push(index)
  }

  const maxOverlap = Math.min(
    MAX_CHARACTER_SEAM_OVERLAP,
    previousChars.length,
    normalized.length,
  )
  for (let length = maxOverlap; length >= MIN_CHARACTER_SEAM_OVERLAP; length--) {
    if (!previousChars.endsWith(normalized.slice(0, length).join(''))) continue
    const cutIndex = indexes[length]
    return cutIndex === undefined ? '' : characters.slice(cutIndex).join('').trim()
  }
  return text
}

// Chunks are cut mid-stream, so Whisper often re-emits the tail of the
// previous chunk at the start of the next one ("…creo que sí" | "sí, y
// además…"). Drop the longest run of leading words in `text` that matches the
// trailing words of `previous` (checked longest-first, up to 4 words).
export function stripSeamRepeat(
  previous: string,
  text: string,
  options: SeamStripOptions = {},
): string {
  if (!previous) return text

  const prevWords = previous.split(/\s+/).filter(Boolean).map(normalizeWord)
  const words = text.split(/\s+/).filter(Boolean)
  const maxOverlap = Math.min(4, prevWords.length, words.length)

  for (let k = maxOverlap; k >= 1; k--) {
    const tail = prevWords.slice(-k)
    const head = words.slice(0, k).map(normalizeWord)
    if (tail.every((w, idx) => w !== '' && w === head[idx])) {
      return words.slice(k).join(' ')
    }
  }

  if (options.carriedSeam) return stripCharacterSeamRepeat(previous, text)
  return text
}

// Chunks are cut on acoustic pauses, so the text itself has to say whether the
// cut ended a sentence: the recognizer closes every chunk with a period even
// mid-clause (measured: "…風で舞い。" on a seven-second fragment), so
// punctuation carries no boundary information. These endings bind the clause
// to what follows — case/listing particles, te-forms, clause conjunctions and
// subordinate endings — so a line ending on one is still the same sentence even
// after a full pause ("…事前予告を。" | "させて頂ければ…"). Sentential particles
// (ね/よ/か/わ/な) and verb, adjective or copula endings are deliberately not
// listed: they close a sentence. や is left out because it closes one in
// Kansai-ben ("そうや。").
const JAPANESE_CONTINUING_ENDINGS = [
  'けれども', 'けれど', 'けど', 'ので', 'のに', 'ながら', 'つつ',
  'たら', 'なら', 'れば', 'たり', 'だり',
  'ば', 'し', 'て', 'で', 'と', 'が', 'は', 'に', 'を', 'へ', 'も', 'の',
  'から', 'まで', 'より', 'だけ', 'しか', 'ほど', 'ばかり', 'など', 'こそ',
  'さえ', 'でも', 'って',
]

export function hasUnfinishedEnding(text: string, sourceLanguage: string): boolean {
  if (sourceLanguage !== 'ja') return false

  const trimmed = stripTrailingSentencePunctuation(text.trim()).trimEnd()
  return JAPANESE_CONTINUING_ENDINGS.some((ending) => trimmed.endsWith(ending))
}

// Joins the two halves of one sentence. The recognizer closes every chunk with
// a period even when the sentence continues, so that boundary punctuation is
// dropped; scripts written without word spacing are joined directly.
const CJK_CHARACTER = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const TRAILING_SENTENCE_PUNCTUATION = /[。．.!?！？、,，…]+$/u

export function stripTrailingSentencePunctuation(text: string): string {
  return text.replace(TRAILING_SENTENCE_PUNCTUATION, '')
}

export function joinMidSentenceText(previous: string, next: string): string {
  const left = stripTrailingSentencePunctuation(previous).trimEnd()
  const right = next.trimStart()
  if (!left) return right
  if (!right) return left

  const leftCharacter = Array.from(left).pop() ?? ''
  const rightCharacter = Array.from(right)[0] ?? ''
  const needsSpace = !(CJK_CHARACTER.test(leftCharacter) && CJK_CHARACTER.test(rightCharacter))
  return needsSpace ? `${left} ${right}` : `${left}${right}`
}

// Whisper stutters on short or near-silent fragments: it repeats a single
// token many times ("tu tu tu tu…"). Collapse any run of 3+ identical
// consecutive words down to one. Natural language almost never repeats the
// same word 3+ times in a row, so this removes the hallucinated stutter while
// leaving legitimate doubles ("no no", "muy muy") untouched.
export function collapseRepeats(text: string): string {
  const words = text.split(/\s+/).filter(Boolean)

  const out: string[] = []
  let i = 0
  while (i < words.length) {
    const key = normalizeWord(words[i])
    let j = i + 1
    while (j < words.length && key !== '' && normalizeWord(words[j]) === key) j++

    const runLength = j - i
    if (runLength >= 3) {
      out.push(words[i]) // stutter run → keep a single occurrence
    } else {
      for (let k = i; k < j; k++) out.push(words[k])
    }
    i = j
  }

  return out.join(' ')
}

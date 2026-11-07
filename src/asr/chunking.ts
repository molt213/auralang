import type { AsrEngine } from './types'

// Chunking is VAD-style: the worklet cuts audio when speech goes quiet for
// `pauseMs`. These profiles are per engine because the decoders behave very
// differently when a chunk contains only part of a sentence.
export interface ChunkingProfile {
  // A pause this long always ends a chunk.
  pauseMs: number
  minChunkMs: number
  // Safety cap: interrupted speech this long must be cut even with no pause.
  maxChunkMs: number
  minSpeechMs: number
  // Once a chunk reaches `softMaxMs`, a much shorter pause (`softPauseMs`)
  // also ends it. Continuous narration otherwise runs into the cap, and a cap
  // cut lands mid-word: measured against Dolphin, the continuation then loses
  // anywhere from a syllable to most of the clause (a cut 2.5s into a clause
  // left only "ようです。" of the remaining 3.9s). Cutting at the first short
  // pause after `softMaxMs` is what keeps chunks whole.
  softMaxMs: number
  softPauseMs: number
  // When the cap is hit anyway (no pause at all), the cut is placed inside
  // this window before the cap rather than at the newest sample.
  lookbackMs: number
  // Audio from the end of the emitted chunk replayed at the start of the next
  // one when the cap forced a split. CTC loses most of a clause when the input
  // begins mid-clause (measured: 28% of the clause without context, 100% with
  // a 2 s run-in), so the continuation needs the tail it was cut from. 0
  // disables it; the text pipeline strips the duplicated run at the seam.
  seamRunInMs: number
}

// Whisper profile. 900ms was tuned against mid-sentence breathing/comma
// pauses (300–600ms) — see the note in audioCapture.ts.
export const WHISPER_CHUNKING: ChunkingProfile = {
  pauseMs: 900,
  minChunkMs: 600,
  maxChunkMs: 5000,
  minSpeechMs: 300,
  softMaxMs: 2800,
  softPauseMs: 250,
  lookbackMs: 1000,
  seamRunInMs: 0,
}

// Dolphin decodes every chunk independently (CTC has no cross-chunk context and
// no tail re-emission), so a cut mid-sentence permanently splits the sentence
// into two transcript lines that can never be re-joined. Live Japanese clause
// and breath pauses routinely sit in the 300–900ms range, so wait for a clearly
// sentence-final pause and allow longer bursts between cuts.
export const DOLPHIN_CHUNKING: ChunkingProfile = {
  pauseMs: 1400,
  minChunkMs: 600,
  maxChunkMs: 7000,
  minSpeechMs: 300,
  softMaxMs: 3800,
  softPauseMs: 250,
  lookbackMs: 1500,
  seamRunInMs: 2000,
}

export function chunkingForEngine(engine: AsrEngine): ChunkingProfile {
  return engine === 'sherpa-dolphin' ? DOLPHIN_CHUNKING : WHISPER_CHUNKING
}

import { describe, expect, it } from '@jest/globals'

import {
  DOLPHIN_CHUNKING,
  WHISPER_CHUNKING,
  chunkingForEngine,
} from './chunking'

describe('Given the per-engine chunking profiles', () => {
  it('When the engine is Dolphin, Then it waits for a clearly sentence-final pause', () => {
    const profile = chunkingForEngine('sherpa-dolphin')

    expect(profile).toBe(DOLPHIN_CHUNKING)
    // Japanese clause/breath pauses sit in the 300–900ms range; only longer
    // pauses should end a chunk.
    expect(profile.pauseMs).toBeGreaterThan(WHISPER_CHUNKING.pauseMs)
    expect(profile.pauseMs).toBeGreaterThanOrEqual(1400)
  })

  it('When the engine is Dolphin, Then the safety cap allows longer uninterrupted bursts', () => {
    expect(DOLPHIN_CHUNKING.maxChunkMs).toBeGreaterThan(WHISPER_CHUNKING.maxChunkMs)
  })

  it('When the engine is a whisper tier, Then the whisper profile is unchanged', () => {
    expect(chunkingForEngine('transformers')).toBe(WHISPER_CHUNKING)
    expect(WHISPER_CHUNKING).toEqual({
      pauseMs: 900,
      minChunkMs: 600,
      maxChunkMs: 5000,
      minSpeechMs: 300,
      softMaxMs: 2800,
      softPauseMs: 250,
      lookbackMs: 1000,
      seamRunInMs: 0,
    })
  })

  it('When the cap splits a Dolphin chunk, Then the continuation carries a run-in from the cut', () => {
    // Without it a clause cut at the cap decodes to a word or two; measured
    // with the real model, 28% coverage without context vs 100% with 2 s.
    expect(DOLPHIN_CHUNKING.seamRunInMs).toBeGreaterThanOrEqual(1500)
    // Chunk + run-in must stay well under the ~11 s input where the model
    // starts dropping whole segments.
    expect(DOLPHIN_CHUNKING.seamRunInMs).toBeLessThan(4000)
    expect(WHISPER_CHUNKING.seamRunInMs).toBe(0)
  })

  it('When any profile is used, Then a short pause can end a long chunk before the cap', () => {
    for (const profile of [WHISPER_CHUNKING, DOLPHIN_CHUNKING]) {
      // The soft pause sits between a mid-word breath and the full pause, and
      // becomes available well before the cap forces a cut.
      expect(profile.softPauseMs).toBeLessThan(profile.pauseMs)
      expect(profile.softPauseMs).toBeGreaterThanOrEqual(250)
      expect(profile.softMaxMs).toBeLessThan(profile.maxChunkMs)
      // The cap looks back far enough to find a pause, but stays inside the cap.
      expect(profile.lookbackMs).toBeLessThan(profile.softMaxMs)
    }
  })

  it('When any profile is used, Then a chunk still needs a minimum of real speech', () => {
    expect(DOLPHIN_CHUNKING.minSpeechMs).toBe(WHISPER_CHUNKING.minSpeechMs)
    expect(DOLPHIN_CHUNKING.minSpeechMs).toBeGreaterThan(0)
  })
})

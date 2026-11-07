// Provisional captions for speech that is still being spoken. The recognizer
// decodes a whole buffer at once (CTC greedy), so a preview means decoding the
// in-progress buffer again — measured at ~240 ms per second of audio on this
// runtime, i.e. roughly a quarter of real time. Previews therefore space
// themselves out in proportion to what the last one cost, which keeps the
// recognizer free most of the time for the real chunk decodes.
import { createPartialThrottle } from './partialThrottle'
import { isPunctuationOnly, isSilenceHallucination } from '../utils/text'
import type { PendingAudio } from './audioCapture'
import type { TranscriptUpdatePayload } from '../types'

// A preview must never hold up the pipeline: the provider is asked once and the
// answer is dropped if it takes longer than this. It is generous enough that a
// slow model can still fill the settled caption before its own translation lands.
export const PREVIEW_TRANSLATE_TIMEOUT_MS = 3000

// The provisional translation streams in; it is redrawn less often than the
// settled one because the preview line is already being rewritten by the
// recognizer as the speaker keeps talking.
export const PREVIEW_PARTIAL_INTERVAL_MS = 250

// Room left for the recognizer between previews, on top of the time the last
// preview itself took (dutyFactor) — so a cheap preview repeats quickly and an
// expensive one backs off instead of starving the final decodes.
export const PREVIEW_BASE_GAP_MS = 400
export const PREVIEW_DUTY_FACTOR = 2.2

// Below this the caption would flash single characters.
export const PREVIEW_MIN_CHARS = 4

export interface PreviewSchedulerDeps {
  // `carriedSeam` tells the caller the preview starts with a run-in from the
  // previous chunk, so the seam has to be stripped from the decoded text.
  transcribePreview: (audio: PendingAudio) => Promise<string>
  // Streams the provisional translation so even a slow provider shows text as
  // soon as it starts answering; null means it did not answer in time.
  translatePreview: (text: string, onPartial: (partial: string) => void) => Promise<string | null>
  emit: (update: TranscriptUpdatePayload) => void
  // The id the in-progress utterance will get once it is finalized; a preview
  // is dropped when it no longer matches (the utterance was cut while decoding).
  segmentId: () => number
  isAsrBusy: () => boolean
  now?: () => number
}

export interface PreviewSchedulerOptions {
  baseGapMs?: number
  dutyFactor?: number
  minChars?: number
}

export interface PreviewScheduler {
  // Takes a provider rather than the audio itself: joining and resampling the
  // buffer costs real work, so it must only happen for a preview that will
  // actually be decoded — not on every captured frame.
  tick: (provideAudio: () => PendingAudio | null) => void
  reset: () => void
}

export function createPreviewScheduler(
  deps: PreviewSchedulerDeps,
  options: PreviewSchedulerOptions = {},
): PreviewScheduler {
  const now = deps.now ?? Date.now
  const baseGapMs = options.baseGapMs ?? PREVIEW_BASE_GAP_MS
  const dutyFactor = options.dutyFactor ?? PREVIEW_DUTY_FACTOR
  const minChars = options.minChars ?? PREVIEW_MIN_CHARS

  let inFlight = false
  let nextAt = 0
  let lastText = ''
  // Bumped by reset(): a preview that outlives its session must not emit.
  let generation = 0

  return {
    tick(provideAudio) {
      if (inFlight) return
      const at = now()
      if (at < nextAt) return
      // A real chunk always wins the recognizer.
      if (deps.isAsrBusy()) return

      const audio = provideAudio()
      if (!audio) return

      inFlight = true
      const startedAt = at
      const generationAtStart = generation
      const segmentId = deps.segmentId()

      void (async () => {
        try {
          const raw = await deps.transcribePreview(audio)
          if (generation !== generationAtStart) return

          const text = raw.trim()
          if (text.length < minChars || text === lastText) return
          if (isPunctuationOnly(text) || isSilenceHallucination(text)) return
          lastText = text

          let lastEmitted: string | null | undefined
          const emitPreview = (translation: string | null): void => {
            if (generation !== generationAtStart) return
            if (translation === lastEmitted) return
            lastEmitted = translation
            deps.emit({
              segmentId,
              original: text,
              translated: translation,
              translationStatus: 'preview',
            })
          }
          const throttle = createPartialThrottle(
            (partial) => emitPreview(partial),
            PREVIEW_PARTIAL_INTERVAL_MS,
          )

          const translation = await deps.translatePreview(text, (partial) => throttle.push(partial))
          if (generation !== generationAtStart) return
          // The utterance may have been finalized while this ran. The
          // translation is still delivered: the settled caption keeps it until
          // the real translation replaces it, so the line never blanks out.
          if (translation) emitPreview(translation)
          else if (lastEmitted === undefined) emitPreview(null)
        } catch {
          // A preview is a courtesy: it must never surface an error, because
          // the settled caption replaces it a moment later.
        } finally {
          // A reset may have started a new preview while this one was still
          // running; it owns `inFlight` and the schedule now.
          if (generation === generationAtStart) {
            inFlight = false
            nextAt = now() + baseGapMs + (now() - startedAt) * dutyFactor
          }
        }
      })()
    },

    reset() {
      generation += 1
      inFlight = false
      nextAt = 0
      lastText = ''
    },
  }
}

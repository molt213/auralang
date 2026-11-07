// The fast translation shown while an utterance is still being spoken is the
// only translation the viewer has until the real one arrives. It is kept here
// so the settled row can carry it across the hand-off — and so a failed or
// skipped LLM request still leaves a readable line on screen.
// A late preview can arrive after its segment already settled, which would
// re-add an entry that the terminal update just removed. The cap keeps that
// rare case from growing the map over a long stream.
const MAX_PREVIEW_TRANSLATIONS = 32
const translations = new Map<number, string>()

export function rememberPreviewTranslation(segmentId: number, translation: string | null): void {
  const text = translation?.trim()
  if (!text) return
  if (!translations.has(segmentId) && translations.size >= MAX_PREVIEW_TRANSLATIONS) {
    const oldest = translations.keys().next().value
    if (typeof oldest === 'number') translations.delete(oldest)
  }
  translations.set(segmentId, text)
}

export function previewTranslationFor(segmentId: number): string | null {
  return translations.get(segmentId) ?? null
}

export function forgetPreviewTranslation(segmentId: number): void {
  translations.delete(segmentId)
}

export function clearPreviewTranslations(): void {
  translations.clear()
}

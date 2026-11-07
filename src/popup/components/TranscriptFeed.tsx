import { useEffect, useRef } from 'react'
import type { TranscriptUpdatePayload } from '../../types'

interface TranscriptFeedProps {
  transcripts: TranscriptUpdatePayload[]
  translatingLabel: string
  translationFailedLabel: string
  translationSkippedLabel: string
  className?: string
}

export function TranscriptFeed({
  transcripts,
  translatingLabel,
  translationFailedLabel,
  translationSkippedLabel,
  className = '',
}: TranscriptFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll ONLY the feed container — scrollIntoView scrolls every scrollable
  // ancestor, which shifted the whole panel on each new line and made clicks
  // (e.g. the settings gear) land on the wrong spot.
  useEffect(() => {
    const container = containerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [transcripts])

  return (
    <div
      ref={containerRef}
      className={`transcript-feed relative flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--panel-card)] px-3.5 py-3 text-left ${className}`}
    >
      {transcripts.length === 0 ? (
        <p className="text-caption text-muted">···</p>
      ) : (
        transcripts.map((entry, i) => {
          const status = entry.translationStatus
            ?? (entry.translated === null ? 'pending' : 'translated')
          return (
            <div
              key={entry.segmentId}
              className={`flex animate-fade-in flex-col gap-1 rounded-lg px-1 py-0.5 transition-colors ${
                i === transcripts.length - 1 ? '' : 'opacity-75'
              }`}
            >
              <p className="text-subtitle leading-snug text-muted">{entry.original}</p>
              {status === 'pending' ? (
                entry.translated ? (
                  // The provisional translation from the preview stays on
                  // screen until the real one arrives — blanking out to a
                  // loading label would throw away the only line the viewer has.
                  <p className="text-subtitle font-medium italic leading-snug text-muted">
                    {entry.translated}
                    <span className="ml-0.5 animate-pulse" aria-hidden="true">▍</span>
                  </p>
                ) : (
                  // Every queued line stays eligible for translation, so each
                  // one needs an explicit loading state while it is backfilled.
                  <p className="animate-pulse text-subtitle font-medium italic leading-snug text-muted">
                    {translatingLabel}
                  </p>
                )
              ) : status === 'failed' ? (
                entry.translated ? (
                  // The LLM request failed, but the fast translation is still
                  // the best line available — keep it and mark the row subtly.
                  <p className="text-subtitle font-medium leading-snug text-[var(--text-primary)]">
                    {entry.translated}
                    <span
                      className="ml-1 text-caption text-amber-500"
                      title={translationFailedLabel}
                      aria-label={translationFailedLabel}
                    >
                      ⚠
                    </span>
                  </p>
                ) : (
                  <p className="text-subtitle font-medium italic leading-snug text-muted">
                    {translationFailedLabel}
                  </p>
                )
              ) : status === 'skipped' ? (
                entry.translated ? (
                  // A stopped/backfilled-out request must not erase the
                  // provisional translation the viewer is already reading.
                  <p className="text-subtitle font-medium leading-snug text-[var(--text-primary)]">
                    {entry.translated}
                  </p>
                ) : (
                  <p className="text-subtitle font-medium italic leading-snug text-muted">
                    {translationSkippedLabel}
                  </p>
                )
              ) : status === 'preview' ? (
                // Speech that has not settled yet: provisional, and replaced by
                // the settled caption once the utterance is cut and translated.
                entry.translated ? (
                  <p className="text-subtitle font-medium italic leading-snug text-muted">
                    {entry.translated}
                    <span className="ml-0.5 animate-pulse" aria-hidden="true">▍</span>
                  </p>
                ) : (
                  // The original is already on the line above; without a
                  // translation there is nothing more to say yet.
                  <p className="text-subtitle font-medium italic leading-snug text-muted">···</p>
                )
              ) : status === 'partial' ? (
                // The translation is still streaming in: the caret marks the
                // line as provisional, so it is not mistaken for the final one.
                entry.translated ? (
                  <p className="text-subtitle font-medium leading-snug text-[var(--text-primary)]">
                    {entry.translated}
                    <span className="ml-0.5 animate-pulse" aria-hidden="true">▍</span>
                  </p>
                ) : (
                  <p className="text-subtitle font-medium italic leading-snug text-muted">···</p>
                )
              ) : (
                <p className="animate-fade-in text-subtitle font-medium leading-snug text-[var(--text-primary)]">
                  {entry.translated}
                </p>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

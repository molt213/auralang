import { WaveformBars } from './WaveformBars'

interface StatusStripProps {
  title: string
  subtitle: string
  progress?: number | null
  loading?: boolean
}

// The active view is about the live transcript, so the big idle status circle
// shrinks to one dense row and leaves the rest of the floating panel to the
// captions. Title and subtitle share a line; only loading/backfill adds a bar.
export function StatusStrip({
  title,
  subtitle,
  progress = null,
  loading = false,
}: StatusStripProps) {
  const clampedProgress = progress === null ? null : Math.max(0, Math.min(100, progress))
  const determinate = clampedProgress !== null && clampedProgress > 0 && clampedProgress < 100
  const showBar = loading || determinate

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--panel-card)] px-2.5 py-1.5"
      role="status"
      aria-live="polite"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-purple/40 bg-[var(--surface-bg)]">
        <WaveformBars className="scale-[0.4]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="shrink-0 truncate text-caption font-semibold text-[var(--text-primary)]">
            {title}
          </p>
          <p className="min-w-0 truncate text-caption text-muted">{subtitle}</p>
        </div>
        {showBar && (
          <div className="relative mt-1 h-0.5 w-full overflow-hidden rounded-full bg-[var(--border-color)]">
            {determinate ? (
              <div
                className="h-full rounded-full bg-brand-purple transition-[width] duration-300 ease-out"
                style={{ width: `${clampedProgress}%` }}
              />
            ) : (
              <div className="animate-indeterminate absolute inset-y-0 w-2/5 rounded-full bg-brand-purple" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

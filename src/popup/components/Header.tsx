import { LogoIcon } from './LogoIcon'
import { GearIcon } from './Icons'

interface HeaderProps {
  tagline: string
  onOpenSettings: () => void
  settingsAriaLabel: string
  // While captions are running the header is chrome, not content: the logo,
  // tagline and button all shrink so the transcript gets the room.
  compact?: boolean
}

export function Header({ tagline, onOpenSettings, settingsAriaLabel, compact = false }: HeaderProps) {
  return (
    <header className={`flex items-center ${compact ? 'gap-2' : 'gap-3'}`}>
      <LogoIcon className={compact ? 'h-6 w-6' : 'h-10 w-10'} />
      <div className="min-w-0 flex-1">
        <h1
          className={`font-semibold leading-tight text-[var(--text-primary)] ${
            compact ? 'text-caption' : 'text-body'
          }`}
        >
          AuraLang
        </h1>
        {!compact && <p className="text-caption leading-snug text-muted">{tagline}</p>}
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-transparent text-muted transition-colors hover:border-[var(--border-color)] hover:bg-[var(--surface-elevated)] hover:text-brand-purple ${
          compact ? 'h-7 w-7' : 'h-9 w-9'
        }`}
        aria-label={settingsAriaLabel}
      >
        <GearIcon size={compact ? 15 : 18} />
      </button>
    </header>
  )
}

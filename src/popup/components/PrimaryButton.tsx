import type { ReactNode } from 'react'

interface PrimaryButtonProps {
  children: ReactNode
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost'
  type?: 'button' | 'submit'
  compact?: boolean
  fullWidth?: boolean
}

export function PrimaryButton({
  children,
  icon,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
  compact = false,
  fullWidth = true,
}: PrimaryButtonProps) {
  const base = `flex items-center justify-center gap-2.5 font-semibold rounded-xl transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
    fullWidth ? 'w-full' : ''
  } ${compact ? 'px-4 py-2.5 text-caption' : 'py-3.5 text-body'}`

  const variantClass =
    variant === 'ghost'
      ? 'bg-transparent border border-[var(--border-color)] text-[var(--text-primary)] shadow-[var(--surface-shadow)] hover:border-brand-purple/50 hover:text-brand-purple hover:bg-brand-purple/5'
      : 'bg-brand-purple text-white border border-brand-purple/80 shadow-glow-purple hover:bg-brand-purple-dark'

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variantClass}`}>
      {icon && <span className="inline-flex shrink-0 items-center justify-center">{icon}</span>}
      <span>{children}</span>
    </button>
  )
}

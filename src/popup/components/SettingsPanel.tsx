import type { TranslationConfig, TranslationProvider, UiLanguage, UiTheme } from '../../types'
import type { AsrMode } from '../../asr/types'
import { CloseIcon } from './Icons'
import { SegmentedControl } from './SegmentedControl'
import type { MessageKey } from '../hooks/useI18n'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  uiLanguage: UiLanguage
  uiTheme: UiTheme
  asrMode: AsrMode
  asrModeLocked: boolean
  translation: TranslationConfig
  translationLocked: boolean
  // What Auto resolves to on this device, e.g. "En este equipo: Equilibrado · ~290 MB".
  autoResolvedNote: string
  backdropCloseAriaLabel: string
  closeAriaLabel: string
  onLanguageChange: (lang: UiLanguage) => void
  onThemeChange: (theme: UiTheme) => void
  onAsrModeChange: (mode: AsrMode) => void
  onTranslationChange: <K extends keyof TranslationConfig>(
    key: K,
    value: TranslationConfig[K],
  ) => void
  t: (key: MessageKey) => string
}

export function SettingsPanel({
  isOpen,
  onClose,
  uiLanguage,
  uiTheme,
  asrMode,
  asrModeLocked,
  translation,
  translationLocked,
  autoResolvedNote,
  backdropCloseAriaLabel,
  closeAriaLabel,
  onLanguageChange,
  onThemeChange,
  onAsrModeChange,
  onTranslationChange,
  t,
}: SettingsPanelProps) {
  if (!isOpen) return null

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 bg-black/50 z-10"
        onClick={onClose}
        aria-label={backdropCloseAriaLabel}
      />
      <div className="transcript-feed absolute inset-x-3 top-14 z-20 flex max-h-[calc(100vh-5rem)] flex-col gap-4 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--surface-elevated)] p-4 shadow-[0_12px_32px_rgba(15,23,42,0.18)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-semibold text-[var(--text-primary)]">{t('settings.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-[var(--text-primary)] transition-colors"
            aria-label={closeAriaLabel}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-muted">{t('settings.uiLanguage')}</span>
          <SegmentedControl
            value={uiLanguage}
            onChange={onLanguageChange}
            options={[
              { value: 'en', label: t('languageName.english') },
              { value: 'es', label: t('languageName.spanish') },
              { value: 'zh-CN', label: t('languageName.simplifiedChinese') },
            ]}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-muted">{t('settings.translationProvider')}</span>
          <SegmentedControl
            value={translation.provider}
            onChange={(provider: TranslationProvider) => onTranslationChange('provider', provider)}
            disabled={translationLocked}
            options={[
              { value: 'google', label: t('provider.google') },
              { value: 'openai-compatible', label: t('provider.externalApi') },
            ]}
          />
          <span className="text-caption leading-snug text-muted">
            {translation.provider === 'google'
              ? t('provider.googleHint')
              : t('provider.externalApiHint')}
          </span>
        </div>

        {translation.provider === 'openai-compatible' && (
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--surface-bg)] p-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="external-api-base-url" className="text-caption font-medium text-muted">
                {t('externalApi.baseUrl')}
              </label>
              <input
                id="external-api-base-url"
                type="url"
                value={translation.baseUrl}
                onChange={(event) => onTranslationChange('baseUrl', event.target.value)}
                disabled={translationLocked}
                placeholder={t('externalApi.baseUrlPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none placeholder:text-muted focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="external-api-model" className="text-caption font-medium text-muted">
                {t('externalApi.model')}
              </label>
              <input
                id="external-api-model"
                type="text"
                value={translation.model}
                onChange={(event) => onTranslationChange('model', event.target.value)}
                disabled={translationLocked}
                placeholder={t('externalApi.modelPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none placeholder:text-muted focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="external-api-key" className="text-caption font-medium text-muted">
                {t('externalApi.apiKey')}
              </label>
              <input
                id="external-api-key"
                type="password"
                value={translation.apiKey}
                onChange={(event) => onTranslationChange('apiKey', event.target.value)}
                disabled={translationLocked}
                placeholder={t('externalApi.apiKeyPlaceholder')}
                autoComplete="new-password"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none placeholder:text-muted focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-muted">{t('settings.theme')}</span>
          <SegmentedControl
            value={uiTheme}
            onChange={onThemeChange}
            options={[
              { value: 'dark', label: t('theme.dark') },
              { value: 'light', label: t('theme.light') },
            ]}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-muted">{t('settings.model')}</span>
          <SegmentedControl
            value={asrMode}
            onChange={onAsrModeChange}
            disabled={asrModeLocked}
            options={[
              { value: 'auto', label: t('model.auto') },
              { value: 'light', label: t('model.light') },
              { value: 'balanced', label: t('model.balanced') },
            ]}
          />
          <span className="text-caption leading-snug text-muted">
            {asrModeLocked
              ? t('model.lockedHint')
              : asrMode === 'balanced'
                ? t('model.balancedHint')
                : asrMode === 'light'
                  ? t('model.lightHint')
                  : `${t('model.autoHint')} ${autoResolvedNote}`}
          </span>
        </div>
      </div>
    </>
  )
}

import type { FinalTranslationConfig, TranslationConfig, UiLanguage, UiTheme } from '../../types'
import type { AsrMode } from '../../asr/types'
import { indexTranslateModelOrDefault } from '../../constants/indexTranslate'
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
  finalTranslation: FinalTranslationConfig
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
  onFinalTranslationChange: <K extends keyof FinalTranslationConfig>(
    key: K,
    value: FinalTranslationConfig[K],
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
  finalTranslation,
  translationLocked,
  autoResolvedNote,
  backdropCloseAriaLabel,
  closeAriaLabel,
  onLanguageChange,
  onThemeChange,
  onAsrModeChange,
  onTranslationChange,
  onFinalTranslationChange,
  t,
}: SettingsPanelProps) {
  if (!isOpen) return null

  const mainHandlesFinal =
    translation.provider === 'openai-compatible' || translation.provider === 'index-translate'
  const indexModelOptions = [
    { value: 'Index-Translate-35B-A3B', label: t('indexTranslate.model35b') },
    { value: 'Index-Translate-9B', label: t('indexTranslate.model9b') },
    { value: 'Index-Translate-2B', label: t('indexTranslate.model2b') },
  ] as const
  const fieldClassName =
    'w-full rounded-lg border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none placeholder:text-muted focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 bg-black/50 z-10"
        onClick={onClose}
        aria-label={backdropCloseAriaLabel}
      />
      <div className="transcript-feed absolute inset-x-3 top-14 z-20 flex max-h-[calc(100vh-5rem)] flex-col gap-4 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--panel-modal)] p-4 shadow-[0_12px_32px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
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
          <label htmlFor="translation-provider" className="text-caption font-medium text-muted">
            {t('settings.translationProvider')}
          </label>
          <select
            id="translation-provider"
            value={translation.provider}
            onChange={(event) => {
              const provider = event.target.value
              if (
                provider === 'google'
                || provider === 'mymemory'
                || provider === 'baidu'
                || provider === 'openai-compatible'
                || provider === 'index-translate'
              ) {
                onTranslationChange('provider', provider)
              }
            }}
            disabled={translationLocked}
            className={fieldClassName}
          >
            <option value="google">{t('provider.google')}</option>
            <option value="mymemory">{t('provider.mymemory')}</option>
            <option value="baidu">{t('provider.baidu')}</option>
            <option value="index-translate">{t('provider.indexTranslate')}</option>
            <option value="openai-compatible">{t('provider.externalApi')}</option>
          </select>
          <span className="text-caption leading-snug text-muted">
            {translation.provider === 'google'
              ? t('provider.googleHint')
              : translation.provider === 'mymemory'
                ? t('provider.mymemoryHint')
                : translation.provider === 'baidu'
                  ? t('provider.baiduHint')
                  : translation.provider === 'index-translate'
                    ? t('provider.indexTranslateHint')
                    : t('provider.externalApiHint')}
            {finalTranslation.enabled && !mainHandlesFinal
              ? ` ${t('finalTranslation.mainProviderHint')}`
              : ''}
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

        {translation.provider === 'index-translate' && (
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--surface-bg)] p-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="index-translate-model" className="text-caption font-medium text-muted">
                {t('indexTranslate.model')}
              </label>
              <select
                id="index-translate-model"
                value={indexTranslateModelOrDefault(translation.model)}
                onChange={(event) => onTranslationChange('model', event.target.value)}
                disabled={translationLocked}
                className={fieldClassName}
              >
                {indexModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <span className="text-caption leading-snug text-muted">
              {t('indexTranslate.freeNote')}
            </span>
          </div>
        )}

        {translation.provider === 'baidu' && (
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--surface-bg)] p-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="baidu-app-id" className="text-caption font-medium text-muted">
                {t('baidu.appId')}
              </label>
              <input
                id="baidu-app-id"
                type="text"
                value={translation.appId}
                onChange={(event) => onTranslationChange('appId', event.target.value)}
                disabled={translationLocked}
                placeholder={t('baidu.appIdPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none placeholder:text-muted focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="baidu-secret" className="text-caption font-medium text-muted">
                {t('baidu.secret')}
              </label>
              <input
                id="baidu-secret"
                type="password"
                value={translation.apiKey}
                onChange={(event) => onTranslationChange('apiKey', event.target.value)}
                disabled={translationLocked}
                placeholder={t('baidu.secretPlaceholder')}
                autoComplete="new-password"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none placeholder:text-muted focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        )}

        {!mainHandlesFinal && (
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--surface-bg)] p-3">
            <label
              htmlFor="final-translation-enabled"
              className="flex items-center justify-between gap-3"
            >
              <span className="text-caption font-medium text-muted">
                {t('finalTranslation.title')}
              </span>
              <input
                id="final-translation-enabled"
                type="checkbox"
                checked={finalTranslation.enabled}
                onChange={(event) => onFinalTranslationChange('enabled', event.target.checked)}
                disabled={translationLocked}
                className="h-4 w-4 shrink-0 accent-brand-purple disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <span className="text-caption leading-snug text-muted">
              {t('finalTranslation.hint')}
            </span>

            {finalTranslation.enabled && (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-muted">
                    {t('finalTranslation.service')}
                  </span>
                  <SegmentedControl
                    value={finalTranslation.provider}
                    onChange={(provider) => onFinalTranslationChange('provider', provider)}
                    disabled={translationLocked}
                    options={[
                      { value: 'index-translate', label: t('provider.indexTranslateShort') },
                      { value: 'openai-compatible', label: t('provider.externalApi') },
                    ]}
                  />
                </div>

                {finalTranslation.provider === 'index-translate' ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="final-index-model" className="text-caption font-medium text-muted">
                        {t('indexTranslate.model')}
                      </label>
                      <select
                        id="final-index-model"
                        value={indexTranslateModelOrDefault(finalTranslation.model)}
                        onChange={(event) => onFinalTranslationChange('model', event.target.value)}
                        disabled={translationLocked}
                        className={fieldClassName}
                      >
                        {indexModelOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <span className="text-caption leading-snug text-muted">
                      {t('indexTranslate.freeNote')}
                    </span>
                  </>
                ) : (
                  <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="final-api-base-url" className="text-caption font-medium text-muted">
                    {t('externalApi.baseUrl')}
                  </label>
                  <input
                    id="final-api-base-url"
                    type="url"
                    value={finalTranslation.baseUrl}
                    onChange={(event) => onFinalTranslationChange('baseUrl', event.target.value)}
                    disabled={translationLocked}
                    placeholder={t('externalApi.baseUrlPlaceholder')}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none placeholder:text-muted focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="final-api-model" className="text-caption font-medium text-muted">
                    {t('externalApi.model')}
                  </label>
                  <input
                    id="final-api-model"
                    type="text"
                    value={finalTranslation.model}
                    onChange={(event) => onFinalTranslationChange('model', event.target.value)}
                    disabled={translationLocked}
                    placeholder={t('externalApi.modelPlaceholder')}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none placeholder:text-muted focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="final-api-key" className="text-caption font-medium text-muted">
                    {t('externalApi.apiKey')}
                  </label>
                  <input
                    id="final-api-key"
                    type="password"
                    value={finalTranslation.apiKey}
                    onChange={(event) => onFinalTranslationChange('apiKey', event.target.value)}
                    disabled={translationLocked}
                    placeholder={t('externalApi.apiKeyPlaceholder')}
                    autoComplete="new-password"
                    spellCheck={false}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption text-[var(--text-primary)] outline-none placeholder:text-muted focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                  </>
                )}
              </>
            )}
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
              { value: 'dolphin', label: t('model.dolphin') },
            ]}
          />
          <span className="text-caption leading-snug text-muted">
            {asrModeLocked
              ? t('model.lockedHint')
              : asrMode === 'balanced'
                ? t('model.balancedHint')
                : asrMode === 'light'
                  ? t('model.lightHint')
                  : asrMode === 'dolphin'
                    ? t('model.dolphinHint')
                    : `${t('model.autoHint')} ${autoResolvedNote}`}
          </span>
        </div>
      </div>
    </>
  )
}

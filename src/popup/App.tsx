import { useState, useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { useApiConfig } from './hooks/useApiConfig'
import { useTranslation } from './hooks/useTranslation'
import { useI18n } from './hooks/useI18n'
import type { MessageKey } from './hooks/useI18n'
import { useTheme } from './hooks/useTheme'
import { useErrorToasts } from './hooks/useErrorToasts'
import { useStatusToasts } from './hooks/useStatusToasts'
import { useActiveStatus } from './hooks/useActiveStatus'
import { Header } from './components/Header'
import { StatusCircle } from './components/StatusCircle'
import { StatusStrip } from './components/StatusStrip'
import { LanguageSelect } from './components/LanguageSelect'
import { PrimaryButton } from './components/PrimaryButton'
import { Footer } from './components/Footer'
import { SettingsPanel } from './components/SettingsPanel'
import { VolumeSlider } from './components/VolumeSlider'
import { TranscriptFeed } from './components/TranscriptFeed'
import { PlayIcon, StopIcon } from './components/Icons'
import type { FinalTranslationConfig, TranslationConfig, UiLanguage, UiTheme } from '../types'
import type { AsrMode } from '../asr/types'
import { tierForMode } from '../asr/registry'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Only one language dropdown open at a time.
  const [openSelect, setOpenSelect] = useState<'source' | 'target' | null>(null)
  const { config, updateField, error: saveError } = useApiConfig()
  useTheme(config.uiTheme)
  const { t } = useI18n(config.uiLanguage)
  const { state: translation, toggle } = useTranslation(config)

  useEffect(() => {
    document.documentElement.lang = config.uiLanguage
  }, [config.uiLanguage])

  useErrorToasts({
    translationError: translation.error,
    saveError,
    t,
  })

  useStatusToasts({ modelStatus: translation.modelStatus, t })

  // The model isn't downloaded until the user hits Start, so the idle screen
  // shows which model will be pulled and its size — nothing downloads silently.
  // In Auto mode the label is just "Auto", so we also spell out the concrete
  // tier it resolves to on this device (Light/Balanced) — otherwise the user
  // has no idea which model is actually about to run.
  const selectedTier = tierForMode(config.asrMode)
  const selectedTierLabel = t(`model.${selectedTier.id}` as MessageKey)
  const modelNote =
    config.asrMode === 'auto'
      ? `${t('model.auto')} · ${selectedTierLabel} · ~${selectedTier.approxDownloadMB} MB · ${t('downloadsOnStart')}`
      : `${selectedTierLabel} · ~${selectedTier.approxDownloadMB} MB · ${t('downloadsOnStart')}`

  // What Auto resolves to on THIS device, shown in the settings hint so the
  // user knows which model "Auto" actually means — regardless of current mode.
  const autoTier = tierForMode('auto')
  const autoResolvedNote = `${t('model.autoResolved')}: ${t(`model.${autoTier.id}` as MessageKey)} · ~${autoTier.approxDownloadMB} MB.`

  const activeStatus = useActiveStatus(translation, config.asrMode, t)

  return (
    <>
      <Toaster
        position="top-center"
        containerStyle={{ top: 16 }}
        toastOptions={{
          style: {
            maxWidth: '300px',
            background: 'var(--surface-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            fontSize: '12px',
            lineHeight: '1.4',
          },
          error: {
            style: {
              color: '#f87171',
            },
            iconTheme: {
              primary: '#f87171',
              secondary: 'var(--surface-elevated)',
            },
          },
        }}
      />

      <div className="panel-shell relative flex h-screen w-full flex-col overflow-hidden bg-[var(--panel-bg)]">
        <div className={translation.isActive ? 'px-3 pb-0 pt-2' : 'px-4 pb-1 pt-3'}>
          <Header
            tagline={t('tagline')}
            compact={translation.isActive}
            settingsAriaLabel={t('settings.openAriaLabel')}
            onOpenSettings={() => {
              setOpenSelect(null)
              setSettingsOpen(true)
            }}
          />
        </div>

        <SettingsPanel
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          uiLanguage={config.uiLanguage}
          uiTheme={config.uiTheme}
          asrMode={config.asrMode}
          asrModeLocked={translation.isActive}
          translation={config.translation}
          finalTranslation={config.finalTranslation}
          translationLocked={translation.isActive}
          autoResolvedNote={autoResolvedNote}
          backdropCloseAriaLabel={t('settings.backdropAriaLabel')}
          closeAriaLabel={t('settings.closeAriaLabel')}
          onLanguageChange={(lang: UiLanguage) => updateField('uiLanguage', lang)}
          onThemeChange={(theme: UiTheme) => updateField('uiTheme', theme)}
          onAsrModeChange={(mode: AsrMode) => updateField('asrMode', mode)}
          onTranslationChange={<K extends keyof TranslationConfig>(key: K, value: TranslationConfig[K]) => {
            updateField('translation', { ...config.translation, [key]: value })
          }}
          onFinalTranslationChange={<K extends keyof FinalTranslationConfig>(key: K, value: FinalTranslationConfig[K]) => {
            updateField('finalTranslation', { ...config.finalTranslation, [key]: value })
          }}
          t={t}
        />

        <main
          className={`flex min-h-0 flex-1 flex-col ${
            translation.isActive ? 'gap-2 px-3 pb-1.5 pt-2' : 'gap-3 px-4 pb-2 pt-3'
          }`}
        >
          {!translation.isActive ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
              <StatusCircle
                title={t('readyToTranslate')}
                subtitle={t('readyDescription')}
                animated={false}
                glow="none"
                compact
              />
              <div className="flex flex-col gap-2.5">
                <LanguageSelect
                  label={t('sourceLanguage')}
                  value={config.sourceLanguage}
                  uiLanguage={config.uiLanguage}
                  searchPlaceholder={t('searchLanguage')}
                  noResultsText={t('noResults')}
                  disabled={translation.isActive}
                  isOpen={openSelect === 'source'}
                  onOpenChange={(open) => setOpenSelect(open ? 'source' : null)}
                  onChange={(value) => updateField('sourceLanguage', value)}
                  placement="bottom"
                  compact
                />
                <LanguageSelect
                  label={t('targetLanguage')}
                  value={config.targetLanguage}
                  uiLanguage={config.uiLanguage}
                  searchPlaceholder={t('searchLanguage')}
                  noResultsText={t('noResults')}
                  disabled={translation.isActive}
                  isOpen={openSelect === 'target'}
                  onOpenChange={(open) => setOpenSelect(open ? 'target' : null)}
                  onChange={(value) => updateField('targetLanguage', value)}
                  placement="bottom"
                  compact
                />
              </div>
              <PrimaryButton
                icon={<PlayIcon />}
                onClick={toggle}
                disabled={translation.isLoading}
              >
                {translation.isLoading ? t('connecting') : t('startTranslation')}
              </PrimaryButton>
              <VolumeSlider
                label={t('originalVolume')}
                value={config.originalVolume}
                onChange={(value) => updateField('originalVolume', value)}
                compact
              />
              <p className="text-center text-caption text-muted">{modelNote}</p>
              {translation.transcripts.length > 0 && (
                <TranscriptFeed
                  transcripts={translation.transcripts}
                  translatingLabel={t('translating')}
                  translationFailedLabel={t('translationFailed')}
                  translationSkippedLabel={t('translationSkipped')}
                  className="max-h-52"
                />
              )}
            </div>
          ) : (
            <>
              <StatusStrip
                title={activeStatus.title}
                subtitle={activeStatus.subtitle}
                progress={activeStatus.progress}
                loading={activeStatus.loading}
              />

              <div className="flex min-h-0 flex-1 flex-col">
                {translation.transcripts.length > 0 ? (
                  <TranscriptFeed
                    transcripts={translation.transcripts}
                    translatingLabel={t('translating')}
                    translationFailedLabel={t('translationFailed')}
                    translationSkippedLabel={t('translationSkipped')}
                  />
                ) : (
                  translation.isModelReady && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
                      <p className="text-body font-medium text-muted">{t('waitingForSpeech')}</p>
                      <p className="text-caption leading-snug text-muted">
                        {t('waitingForSpeechHint')}
                      </p>
                    </div>
                  )
                )}
              </div>

              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  <VolumeSlider
                    label={t('originalVolume')}
                    value={config.originalVolume}
                    onChange={(value) => updateField('originalVolume', value)}
                    compact
                  />
                </div>
                <PrimaryButton
                  icon={<StopIcon />}
                  onClick={toggle}
                  variant="ghost"
                  disabled={translation.isLoading}
                  compact
                  fullWidth={false}
                >
                  {t('stop')}
                </PrimaryButton>
              </div>

              {translation.transcripts.length === 0 && (
                <p className="text-center text-caption leading-snug text-muted">
                  {t('floatingWindowHint')}
                </p>
              )}
            </>
          )}
        </main>

        {!translation.isActive && <Footer label={t('tabAudioOnly')} />}
      </div>
    </>
  )
}

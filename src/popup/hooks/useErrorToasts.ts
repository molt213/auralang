import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { DOLPHIN_DOWNLOAD_FAILED_PREFIX, DOLPHIN_MODEL_FAILED_PREFIX } from '../../asr/dolphin/types'
import type { MessageKey } from './useI18n'

interface UseErrorToastsOptions {
  translationError: string | null
  saveError: string | null
  t: (key: MessageKey) => string
}

function friendlyMessage(error: string, t: (key: MessageKey) => string): string {
  if (error === 'captureEnded') return t('captureEnded')
  const translatedErrors: Partial<Record<string, MessageKey>> = {
    unknownError: 'error.unknown',
    translationFailed: 'error.translationFailed',
    externalApiMissingBaseUrl: 'externalApi.errorMissingBaseUrl',
    externalApiInvalidBaseUrl: 'externalApi.errorInvalidBaseUrl',
    externalApiInsecureUrl: 'externalApi.errorInsecureUrl',
    externalApiMissingKey: 'externalApi.errorMissingKey',
    externalApiMissingModel: 'externalApi.errorMissingModel',
    externalApiMissingTranslation: 'externalApi.errorMissingTranslation',
    externalApiPermissionDenied: 'externalApi.errorPermissionDenied',
    externalApiSetupFailed: 'externalApi.errorSetupFailed',
    captureNotStarted: 'captureNotStarted',
  }
  if (error.startsWith('indexTranslateRequestFailed:')) {
    return `${t('indexTranslate.errorRequestFailed')} (${error.slice('indexTranslateRequestFailed:'.length)})`
  }
  if (error === 'indexTranslateNetworkFailed') {
    return t('indexTranslate.errorNetworkFailed')
  }
  if (error.startsWith('externalApiRequestFailed:')) {
    return t('externalApi.errorRequestFailed')
  }
  if (error.startsWith('googleTranslationRequestFailed:')) {
    return t('google.errorRequestFailed')
  }
  if (error.startsWith('mymemoryRequestFailed:')) {
    return t('mymemory.errorRequestFailed')
  }
  if (error === 'mymemoryQuotaExceeded') {
    return t('mymemory.errorQuotaExceeded')
  }
  if (error.startsWith('baiduRequestFailed:')) {
    // The numeric code makes a failed request actionable: 52003 = unauthorized,
    // 54001 = bad signature, 54003 = rate limit, 54004 = no balance,
    // 58001 = unsupported language pair.
    return `${t('baidu.errorRequestFailed')} (${error.slice('baiduRequestFailed:'.length)})`
  }
  if (error === 'baiduNetworkFailed') {
    return t('baidu.errorNetworkFailed')
  }
  if (error === 'baiduInvalidResponse') {
    return t('baidu.errorInvalidResponse')
  }
  if (error === 'baiduMissingAppId') {
    return t('baidu.errorMissingAppId')
  }
  if (error === 'baiduMissingKey') {
    return t('baidu.errorMissingKey')
  }
  if (error === 'translationPermissionDenied') {
    return t('translationPermissionDenied')
  }
  if (error.startsWith(DOLPHIN_DOWNLOAD_FAILED_PREFIX)) {
    return t('dolphin.errorDownloadFailed')
  }
  if (error.startsWith(DOLPHIN_MODEL_FAILED_PREFIX)) {
    return t('dolphin.errorLoadFailed')
  }
  if (error.startsWith('Dolphin')) {
    return t('dolphin.errorTranscribeFailed')
  }
  const translatedError = translatedErrors[error]
  if (translatedError) return t(translatedError)
  // Raw chrome.tabCapture error: activeTab not granted on this tab, or a
  // chrome:// / Web Store page, which can never be captured.
  if (error.includes('has not been invoked') || error.includes('cannot be captured')) {
    return t('captureNotAllowed')
  }
  return error
}

export function useErrorToasts({ translationError, saveError, t }: UseErrorToastsOptions) {
  const lastTranslationError = useRef<string | null>(null)
  const lastSaveError = useRef<string | null>(null)

  useEffect(() => {
    if (!translationError) {
      lastTranslationError.current = null
      return
    }
    if (translationError === lastTranslationError.current) return

    lastTranslationError.current = translationError
    toast.error(friendlyMessage(translationError, t), {
      id: `translation:${translationError}`,
    })
  }, [translationError, t])

  useEffect(() => {
    if (!saveError || translationError) {
      lastSaveError.current = null
      return
    }
    if (saveError === lastSaveError.current) return

    lastSaveError.current = saveError
    toast.error(t('saveError'), { id: 'save-error' })
  }, [saveError, translationError, t])
}

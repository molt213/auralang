import type { UiLanguage } from '../../types'
import en from './locales/en.json'
import es from './locales/es.json'
import zhCN from './locales/zh-CN.json'

type Messages = typeof en

const locales: Record<UiLanguage, Messages> = { en, es, 'zh-CN': zhCN }

export function detectBrowserLocale(): UiLanguage {
  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : ''
  if (
    browserLanguage === 'zh' ||
    browserLanguage.startsWith('zh-cn') ||
    browserLanguage.startsWith('zh-sg') ||
    browserLanguage.includes('-hans')
  ) {
    return 'zh-CN'
  }
  if (browserLanguage.startsWith('es')) {
    return 'es'
  }
  return 'en'
}

export function t(key: keyof Messages, language: UiLanguage): string {
  return locales[language][key] ?? locales.en[key] ?? key
}

const displayNamesCache = new Map<string, Intl.DisplayNames>()

function getDisplayNames(locale: UiLanguage): Intl.DisplayNames {
  const cacheKey = locale
  if (!displayNamesCache.has(cacheKey)) {
    displayNamesCache.set(
      cacheKey,
      new Intl.DisplayNames([locale], { type: 'language' }),
    )
  }
  return displayNamesCache.get(cacheKey)!
}

export function getLanguageLabel(code: string, uiLanguage: UiLanguage): string {
  return getDisplayNames(uiLanguage).of(code) ?? code
}

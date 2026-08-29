import { afterEach, describe, expect, it } from '@jest/globals'

import { detectBrowserLocale, t as translate } from './index'

const originalLanguage = navigator.language

function setBrowserLanguage(language: string): void {
  Object.defineProperty(navigator, 'language', {
    configurable: true,
    value: language,
  })
}

afterEach(() => {
  setBrowserLanguage(originalLanguage)
})

describe('Given a browser configured to use Chinese', () => {
  it('When AuraLang detects the browser locale, Then it defaults to Simplified Chinese', () => {
    setBrowserLanguage('zh-CN')

    expect(detectBrowserLocale()).toBe('zh-CN')
  })

  it('When AuraLang detects a Traditional Chinese locale, Then it does not select Simplified Chinese', () => {
    setBrowserLanguage('zh-TW')

    expect(detectBrowserLocale()).toBe('en')
  })

  it('When the popup uses Simplified Chinese, Then it returns the translated interface copy', () => {
    expect(translate('startTranslation', 'zh-CN')).toBe('开始翻译')
    expect(translate('error.unknown', 'zh-CN')).toBe('出现问题，请重试。')
    expect(translate('error.translationFailed', 'zh-CN')).toBe('翻译失败，请重试。')
  })
})

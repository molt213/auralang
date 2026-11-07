import { describe, expect, it } from '@jest/globals'

import { resolveFinalTranslationConfig } from './translationConfigs'
import type { FinalTranslationConfig, TranslationConfig } from '../types'

const baidu: TranslationConfig = {
  provider: 'baidu',
  baseUrl: '',
  model: '',
  apiKey: '',
  appId: 'baidu-app',
}

const finalApi: FinalTranslationConfig = {
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'example-model',
  apiKey: '',
}

describe('Given a free service selected for provisional captions', () => {
  it('When the final external API is enabled, Then the settled translation uses that API', () => {
    expect(resolveFinalTranslationConfig(baidu, finalApi)).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'example-model',
      apiKey: '',
      appId: '',
    })
  })

  it('When the final external API is disabled, Then the same service is used for both stages', () => {
    expect(resolveFinalTranslationConfig(baidu, { ...finalApi, enabled: false })).toBe(baidu)
  })

  it('When an older panel sends no final config at all, Then the main service is used', () => {
    expect(resolveFinalTranslationConfig(baidu, undefined)).toBe(baidu)
  })
})

describe('Given an external API selected as the main service', () => {
  it('When a second final API is enabled, Then the main service still handles both stages', () => {
    const main: TranslationConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://api.main.example/v1',
      model: 'main-model',
      apiKey: '',
      appId: '',
    }

    expect(resolveFinalTranslationConfig(main, finalApi)).toBe(main)
  })
})

describe('Given the built-in Index-Translate service as the final translator', () => {
  it('When it is enabled, Then the fixed free endpoint and chosen model are used', () => {
    expect(resolveFinalTranslationConfig(baidu, {
      enabled: true,
      provider: 'index-translate',
      baseUrl: '',
      model: 'Index-Translate-9B',
      apiKey: '',
    })).toEqual({
      provider: 'index-translate',
      baseUrl: 'https://index-translate.bilibili.com/v1',
      model: 'Index-Translate-9B',
      apiKey: '',
      appId: '',
    })
  })

  it('When no valid model was stored, Then the 35B model is the default', () => {
    const resolved = resolveFinalTranslationConfig(baidu, {
      enabled: true,
      provider: 'index-translate',
      baseUrl: '',
      model: 'some-old-model',
      apiKey: '',
    })

    expect(resolved.model).toBe('Index-Translate-35B-A3B')
  })
})

describe('Given Index-Translate selected as the main service', () => {
  it('When a final translator is enabled, Then the main service still handles both stages', () => {
    const main: TranslationConfig = {
      provider: 'index-translate',
      baseUrl: '',
      model: '',
      apiKey: '',
      appId: '',
    }

    expect(resolveFinalTranslationConfig(main, {
      ...finalApi,
      provider: 'index-translate',
    })).toBe(main)
  })
})

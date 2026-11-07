import { beforeEach, describe, expect, it } from '@jest/globals'

import { createTranslationResultUpdate } from './pipeline'
import {
  clearPreviewTranslations,
  previewTranslationFor,
  rememberPreviewTranslation,
} from './previewTranslations'

beforeEach(() => {
  clearPreviewTranslations()
})

describe('Given a translation result for a visible transcript line', () => {
  it('When the provider returns an empty translation, Then it marks the line as terminally failed', () => {
    expect(createTranslationResultUpdate(7, 'Hello world', '   ')).toEqual({
      segmentId: 7,
      original: 'Hello world',
      translated: null,
      translationStatus: 'failed',
    })
  })

  it('When the provider returns translated text with surrounding whitespace, Then it trims it and marks it complete', () => {
    expect(createTranslationResultUpdate(7, 'Hello world', '  你好，世界  ')).toEqual({
      segmentId: 7,
      original: 'Hello world',
      translated: '你好，世界',
      translationStatus: 'translated',
    })
  })

  it('When the provider fails but a provisional translation exists, Then the line keeps that translation', () => {
    rememberPreviewTranslation(7, '还在说')

    expect(createTranslationResultUpdate(7, 'まだ話している途中です', null, previewTranslationFor(7))).toEqual({
      segmentId: 7,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'failed',
    })
  })

  it('When the provider succeeds, Then its translation replaces the provisional one', () => {
    rememberPreviewTranslation(7, '还在说')

    expect(createTranslationResultUpdate(7, 'まだ話している途中です', '话还没说完', previewTranslationFor(7))).toEqual({
      segmentId: 7,
      original: 'まだ話している途中です',
      translated: '话还没说完',
      translationStatus: 'translated',
    })
  })
})

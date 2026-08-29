import { describe, expect, it } from '@jest/globals'

import { createTranslationResultUpdate } from './pipeline'

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
})

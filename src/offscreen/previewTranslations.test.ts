import { beforeEach, describe, expect, it } from '@jest/globals'

import {
  clearPreviewTranslations,
  previewTranslationFor,
  rememberPreviewTranslation,
} from './previewTranslations'

beforeEach(() => {
  clearPreviewTranslations()
})

describe('Given a provisional translation remembered for a segment', () => {
  it('When it is read back, Then the trimmed translation is returned', () => {
    rememberPreviewTranslation(7, '  还在说  ')

    expect(previewTranslationFor(7)).toBe('还在说')
  })

  it('When an empty translation is remembered, Then it does not overwrite the line', () => {
    rememberPreviewTranslation(7, '还在说')
    rememberPreviewTranslation(7, '   ')

    expect(previewTranslationFor(7)).toBe('还在说')
  })
})

describe('Given a long stream of provisional translations', () => {
  it('When more than the cap arrive, Then the oldest entry is evicted', () => {
    for (let segmentId = 1; segmentId <= 33; segmentId += 1) {
      rememberPreviewTranslation(segmentId, `译文 ${segmentId}`)
    }

    expect(previewTranslationFor(1)).toBeNull()
    expect(previewTranslationFor(33)).toBe('译文 33')
  })
})

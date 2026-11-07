import { describe, expect, it } from '@jest/globals'

import { isStreamingTranslationReady } from './translationStream'

describe('Given a provisional translation already on screen', () => {
  it('When the stream has only produced the first short token, Then it is not ready to replace the line', () => {
    expect(isStreamingTranslationReady('你', '你好，世界')).toBe(false)
    expect(isStreamingTranslationReady('你好', '你好，世界')).toBe(false)
  })

  it('When the stream reaches a clause boundary, Then it is ready even if the text is still short', () => {
    expect(isStreamingTranslationReady('你好，', '你好，世界')).toBe(true)
  })

  it('When the stream has grown into a phrase, Then it is ready to take over', () => {
    expect(isStreamingTranslationReady('这是一个完整的短语', '这是一个很长的临时翻译')).toBe(true)
  })

  it('When the stream is empty, Then it never replaces the provisional line', () => {
    expect(isStreamingTranslationReady('   ', '你好，世界')).toBe(false)
  })
})

import { describe, expect, it } from '@jest/globals'

import { canExtendSentence, extendSentence, keepsSentenceOpen } from './sentenceAssembly'
import type { OpenSentence } from './sentenceAssembly'

const openLine = (overrides: Partial<OpenSentence> = {}): OpenSentence => ({
  segmentId: 7,
  original: '告知といいますか事前予告を。',
  extensions: 0,
  ...overrides,
})

describe('Given a caption line that is still open', () => {
  it('When the next chunk settles, Then the chunk extends it', () => {
    expect(canExtendSentence(openLine(), 'させて頂ければと思いました。')).toBe(true)
  })

  it('When there is no open line, Then the chunk starts a new line', () => {
    expect(canExtendSentence(null, 'させて頂ければと思いました。')).toBe(false)
  })

  it('When the line already absorbed two continuations, Then the chunk starts a new line', () => {
    expect(canExtendSentence(openLine({ extensions: 2 }), 'まだ続きます。')).toBe(false)
  })

  it('When appending would run past the sentence length limit, Then the chunk starts a new line', () => {
    expect(canExtendSentence(openLine({ original: 'あ'.repeat(150) }), 'い'.repeat(11))).toBe(false)
  })
})

describe('Given a Japanese line and the cut that produced it', () => {
  it('When the cut was the safety cap, Then the line stays open', () => {
    expect(keepsSentenceOpen('告知といいますか事前予告を。', 'ja', false)).toBe(true)
    expect(keepsSentenceOpen('させて頂ければと思いました。', 'ja', false)).toBe(true)
  })

  it('When the cut was a full pause but the ending binds the clause, Then the line stays open', () => {
    expect(keepsSentenceOpen('告知といいますか事前予告を。', 'ja', true)).toBe(true)
    expect(keepsSentenceOpen('たぶん行くけど。', 'ja', true)).toBe(true)
  })

  it('When the cut was a full pause and the ending can close a sentence, Then the line closes', () => {
    expect(keepsSentenceOpen('させて頂ければと思いました。', 'ja', true)).toBe(false)
    expect(keepsSentenceOpen('そうですね', 'ja', true)).toBe(false)
  })
})

describe('Given a line in another source language', () => {
  it('When a chunk settles, Then the line closes at the chunk boundary', () => {
    expect(keepsSentenceOpen('and then', 'en', false)).toBe(false)
    expect(keepsSentenceOpen('y luego', 'es', true)).toBe(false)
  })
})

describe('Given the two halves of a Japanese sentence', () => {
  it('When the line is extended, Then the boundary period is dropped and the line keeps its id', () => {
    expect(extendSentence(openLine(), 'させて頂ければと思いました。')).toEqual({
      segmentId: 7,
      original: '告知といいますか事前予告をさせて頂ければと思いました。',
      extensions: 1,
    })
  })
})

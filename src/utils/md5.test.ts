import { describe, expect, it } from '@jest/globals'

import { md5Hex } from './md5'

describe('Given a string to hash', () => {
  it('When it is empty, Then the digest matches the RFC 1321 vector', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })

  it('When it is ASCII, Then the digest matches the reference vectors', () => {
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5Hex('The quick brown fox jumps over the lazy dog'))
      .toBe('9e107d9d372bb6826bd81d3542a419d6')
  })

  it('When it contains non-ASCII characters, Then it hashes the UTF-8 bytes', () => {
    expect(md5Hex('你好')).toBe('7eca689f0d3389d9dea66ae112e5cfd7')
  })

  it('When it spans more than one block, Then the length is appended correctly', () => {
    // 55 and 56 bytes are the padding boundary: 56 forces a second block.
    expect(md5Hex('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65')
    expect(md5Hex('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218')
  })

  it('When it is a Baidu signing input, Then the signature matches the reference', () => {
    expect(md5Hex('appid123今日は配信を見に来てくれてありがとう1700000000000secretkey'))
      .toBe('651a1cf3e178cab9b054db10a96e28a7')
  })
})

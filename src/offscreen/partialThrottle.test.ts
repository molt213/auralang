import { describe, expect, it } from '@jest/globals'

import { createPartialThrottle } from './partialThrottle'

function createClock(start = 0) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe('Given a stream of partial translations', () => {
  it('When the first partial arrives, Then it is emitted right away', () => {
    const emitted: string[] = []
    const throttle = createPartialThrottle((text) => emitted.push(text), 120, () => 0)

    throttle.push('你好')

    expect(emitted).toEqual(['你好'])
  })

  it('When partials arrive faster than the interval, Then only the ones clearing it are emitted', () => {
    const emitted: string[] = []
    const clock = createClock()
    const throttle = createPartialThrottle((text) => emitted.push(text), 120, clock.now)

    throttle.push('你')
    clock.advance(50)
    throttle.push('你好')
    clock.advance(50)
    throttle.push('你好世')
    clock.advance(50)
    throttle.push('你好世界')

    expect(emitted).toEqual(['你', '你好世界'])
  })

  it('When the same text is pushed twice, Then the duplicate is not emitted', () => {
    const emitted: string[] = []
    const clock = createClock()
    const throttle = createPartialThrottle((text) => emitted.push(text), 120, clock.now)

    throttle.push('你好')
    clock.advance(500)
    throttle.push('你好')

    expect(emitted).toEqual(['你好'])
  })
})

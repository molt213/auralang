import { describe, expect, it } from '@jest/globals'

import { LatestTranslationQueue } from './latestTranslationQueue'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolvePromise: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })

  return { promise, resolve: resolvePromise }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('Given a translation task that is still running', () => {
  it('When a newer task arrives, Then it aborts the running task and starts only the newest queued task next', async () => {
    const queue = new LatestTranslationQueue()
    const firstTask = createDeferred()
    const newestTask = createDeferred()
    const signals: AbortSignal[] = []
    const started: string[] = []

    queue.enqueue(async (signal) => {
      signals.push(signal)
      started.push('first')
      await firstTask.promise
    })
    queue.enqueue(async (signal) => {
      signals.push(signal)
      started.push('older-pending')
    })
    queue.enqueue(async (signal) => {
      signals.push(signal)
      started.push('newest')
      await newestTask.promise
    })

    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)

    firstTask.resolve()
    await nextTurn()

    expect(signals).toHaveLength(2)
    expect(started).toEqual(['first', 'newest'])

    newestTask.resolve()
    await nextTurn()
  })
})

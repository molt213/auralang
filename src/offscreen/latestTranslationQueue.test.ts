import { describe, expect, it } from '@jest/globals'

import { MAX_TRANSCRIPT_ENTRIES } from '../constants/transcript'
import { PrioritizedTranslationQueue } from './latestTranslationQueue'

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

describe('Given two translation tasks that are already running', () => {
  it('When newer and older tasks are waiting, Then it starts the newest first and still completes the older task', async () => {
    const queue = new PrioritizedTranslationQueue(2)
    const firstTask = createDeferred()
    const secondTask = createDeferred()
    const olderPendingTask = createDeferred()
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
      started.push('second')
      await secondTask.promise
    })
    queue.enqueue(async (signal) => {
      signals.push(signal)
      started.push('older-pending')
      await olderPendingTask.promise
    })
    queue.enqueue(async (signal) => {
      signals.push(signal)
      started.push('newest')
      await newestTask.promise
    })

    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => !signal.aborted)).toBe(true)

    firstTask.resolve()
    await nextTurn()

    expect(signals).toHaveLength(3)
    expect(started).toEqual(['first', 'second', 'newest'])

    newestTask.resolve()
    await nextTurn()

    secondTask.resolve()
    await nextTurn()

    expect(signals).toHaveLength(4)
    expect(started).toEqual(['first', 'second', 'newest', 'older-pending'])

    olderPendingTask.resolve()
    await nextTurn()
  })
})

describe('Given running and pending translation tasks', () => {
  it('When the queue is cleared, Then it aborts running work and does not start pending work', async () => {
    const queue = new PrioritizedTranslationQueue(1)
    const activeTask = createDeferred()
    const signals: AbortSignal[] = []
    const started: string[] = []

    queue.enqueue(async (signal) => {
      signals.push(signal)
      started.push('active')
      await activeTask.promise
    })
    queue.enqueue(async () => {
      started.push('pending')
    })

    queue.clear()

    expect(signals[0]?.aborted).toBe(true)

    activeTask.resolve()
    await nextTurn()

    expect(started).toEqual(['active'])
  })
})

describe('Given an older translation remains pending during a busy stream', () => {
  it('When newer tasks keep arriving, Then it still starts the older translation after two newer tasks', async () => {
    const queue = new PrioritizedTranslationQueue(1)
    const activeTask = createDeferred()
    const oldestPendingTask = createDeferred()
    const newestOneTask = createDeferred()
    const newestTwoTask = createDeferred()
    const newestThreeTask = createDeferred()
    const started: string[] = []

    queue.enqueue(async () => {
      started.push('active')
      await activeTask.promise
    })
    queue.enqueue(async () => {
      started.push('oldest')
      await oldestPendingTask.promise
    })
    queue.enqueue(async () => {
      started.push('newest-one')
      await newestOneTask.promise
    })

    activeTask.resolve()
    await nextTurn()

    queue.enqueue(async () => {
      started.push('newest-two')
      await newestTwoTask.promise
    })
    newestOneTask.resolve()
    await nextTurn()

    queue.enqueue(async () => {
      started.push('newest-three')
      await newestThreeTask.promise
    })
    newestTwoTask.resolve()
    await nextTurn()

    expect(started).toEqual(['active', 'newest-one', 'newest-two', 'oldest'])

    oldestPendingTask.resolve()
    await nextTurn()
    newestThreeTask.resolve()
    await nextTurn()
  })
})

describe('Given a cleared translation queue still has an aborting request', () => {
  it('When a new stream queues translation, Then it waits for the prior request to settle before using the slot', async () => {
    const queue = new PrioritizedTranslationQueue(1)
    const priorTask = createDeferred()
    const started: string[] = []

    queue.enqueue(async () => {
      started.push('prior')
      await priorTask.promise
    })
    queue.clear()
    queue.enqueue(async () => {
      started.push('current')
    })

    expect(started).toEqual(['prior'])

    priorTask.resolve()
    await nextTurn()

    expect(started).toEqual(['prior', 'current'])
  })
})

describe('Given translation falls behind a long live stream', () => {
  it('When the pending history grows past the visible transcript window, Then it drops only the oldest unseen pending task', async () => {
    const queue = new PrioritizedTranslationQueue(1)
    const activeTask = createDeferred()
    const newestPendingTask = createDeferred()
    const started: string[] = []

    queue.enqueue(async () => {
      started.push('active')
      await activeTask.promise
    })

    for (let index = 1; index <= MAX_TRANSCRIPT_ENTRIES + 1; index += 1) {
      const taskName = `pending-${index}`
      const isNewestPendingTask = index === MAX_TRANSCRIPT_ENTRIES + 1
      queue.enqueue(async () => {
        started.push(taskName)
        if (isNewestPendingTask) await newestPendingTask.promise
      })
    }

    activeTask.resolve()
    await nextTurn()

    expect(started).toEqual(['active', `pending-${MAX_TRANSCRIPT_ENTRIES + 1}`])

    newestPendingTask.resolve()
    await nextTurn()

    expect(started).not.toContain('pending-1')
  })
})

describe('Given translation work is cleared while the stream stops', () => {
  it('When active and pending tasks are discarded, Then it notifies each task once', async () => {
    const queue = new PrioritizedTranslationQueue(1)
    const activeTask = createDeferred()
    const discarded: string[] = []

    queue.enqueue(async () => {
      await activeTask.promise
    }, () => discarded.push('active'))
    queue.enqueue(async () => undefined, () => discarded.push('pending'))

    queue.clear()
    queue.clear()

    expect(discarded).toEqual(['pending', 'active'])

    activeTask.resolve()
    await nextTurn()
    expect(discarded).toEqual(['pending', 'active'])
  })
})

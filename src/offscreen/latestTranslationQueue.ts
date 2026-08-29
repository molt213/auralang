import { MAX_TRANSCRIPT_ENTRIES } from '../constants/transcript'

export type TranslationTask = (signal: AbortSignal) => Promise<void>
export type TranslationDiscardHandler = () => void

interface PendingTranslation {
  task: TranslationTask
  onDiscard?: TranslationDiscardHandler
}

interface ActiveTranslation {
  controller: AbortController
  onDiscard?: TranslationDiscardHandler
  discarded: boolean
}

const DEFAULT_MAX_CONCURRENT_TRANSLATIONS = 3
const NEWEST_TASKS_BEFORE_BACKFILL = 2

// New captions start before older queued work, while the visible transcript
// window remains bounded so a slow provider cannot grow memory forever.
export class PrioritizedTranslationQueue {
  private readonly maxConcurrent: number
  private active = new Set<ActiveTranslation>()
  private pending: PendingTranslation[] = []
  private newestTasksSinceBackfill = 0

  constructor(maxConcurrent: number = DEFAULT_MAX_CONCURRENT_TRANSLATIONS) {
    this.maxConcurrent = maxConcurrent
  }

  enqueue(task: TranslationTask, onDiscard?: TranslationDiscardHandler): void {
    this.pending.push({ task, onDiscard })
    if (this.pending.length > MAX_TRANSCRIPT_ENTRIES) {
      this.pending.shift()?.onDiscard?.()
    }
    this.startAvailableTasks()
  }

  clear(): void {
    const pending = this.pending
    this.pending = []
    this.newestTasksSinceBackfill = 0
    for (const item of pending) item.onDiscard?.()
    for (const active of this.active) {
      active.controller.abort()
      if (!active.discarded) {
        active.discarded = true
        active.onDiscard?.()
      }
    }
  }

  private startAvailableTasks(): void {
    while (this.active.size < this.maxConcurrent) {
      const pending = this.takeNextTask()
      if (!pending) return

      const active: ActiveTranslation = {
        controller: new AbortController(),
        onDiscard: pending.onDiscard,
        discarded: false,
      }
      this.active.add(active)
      void pending.task(active.controller.signal)
        .catch(() => undefined)
        .finally(() => {
          this.active.delete(active)
          this.startAvailableTasks()
        })
    }
  }

  private takeNextTask(): PendingTranslation | undefined {
    if (this.pending.length === 0) {
      this.newestTasksSinceBackfill = 0
      return undefined
    }

    if (this.pending.length === 1) {
      this.newestTasksSinceBackfill = 0
      return this.pending.shift()
    }

    if (this.newestTasksSinceBackfill < NEWEST_TASKS_BEFORE_BACKFILL) {
      this.newestTasksSinceBackfill += 1
      return this.pending.pop()
    }

    this.newestTasksSinceBackfill = 0
    return this.pending.shift()
  }
}

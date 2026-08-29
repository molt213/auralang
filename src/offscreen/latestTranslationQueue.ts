export type TranslationTask = (signal: AbortSignal) => Promise<void>

interface ActiveTranslation {
  controller: AbortController
}

// Live captions favor the newest spoken line. A stale network request is
// cancelled when newer speech arrives, while ASR continues on its own queue.
export class LatestTranslationQueue {
  private active: ActiveTranslation | null = null
  private pending: TranslationTask | null = null

  enqueue(task: TranslationTask): void {
    this.pending = task
    this.active?.controller.abort()
    this.startNext()
  }

  clear(): void {
    this.pending = null
    this.active?.controller.abort()
  }

  private startNext(): void {
    if (this.active || !this.pending) return

    const task = this.pending
    this.pending = null
    const active: ActiveTranslation = { controller: new AbortController() }
    this.active = active

    void task(active.controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (this.active !== active) return
        this.active = null
        this.startNext()
      })
  }
}

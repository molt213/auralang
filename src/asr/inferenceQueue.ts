// Chunks arrive from the audio worklet faster than a slow machine can
// transcribe them. Processing them unawaited (the previous behavior) meant
// concurrent inferences piling up: memory spikes, out-of-order transcripts,
// and compounding latency. Single-flight with a small drop-oldest buffer
// keeps playback close to live instead of drifting ever further behind.
const MAX_PENDING = 2

let pending: unknown[] = []
let running = false

export function enqueueChunk<T>(chunk: T, process: (chunk: T) => Promise<void>): void {
  pending.push(chunk)
  while (pending.length > MAX_PENDING) pending.shift()

  if (running) return
  running = true
  void (async () => {
    try {
      let next: unknown
      while ((next = pending.shift()) !== undefined) {
        // `process` is expected to handle its own errors; a defensive catch
        // here keeps one bad chunk from stalling the whole queue regardless.
        await process(next as T).catch(() => {})
      }
    } finally {
      running = false
    }
  })()
}

export function clearQueue(): void {
  pending = []
}

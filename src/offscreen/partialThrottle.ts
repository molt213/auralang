// A token stream arrives far faster than the UI needs to redraw: every update
// is a runtime message plus a render in the panel, the video overlay and the
// floating window. Emit at most once per interval — the final 'translated'
// update carries the complete text, so a dropped partial costs nothing.
export const PARTIAL_EMIT_INTERVAL_MS = 120

export interface PartialThrottle {
  push: (text: string) => void
}

export function createPartialThrottle(
  emit: (text: string) => void,
  intervalMs: number = PARTIAL_EMIT_INTERVAL_MS,
  now: () => number = Date.now,
): PartialThrottle {
  let lastEmitAt = Number.NEGATIVE_INFINITY
  let lastText = ''

  return {
    push(text) {
      if (text === lastText) return
      const at = now()
      if (at - lastEmitAt < intervalMs) return
      lastEmitAt = at
      lastText = text
      emit(text)
    },
  }
}

import type { TranscriptTranslationStatus } from '../types'

export const VIDEO_SUBTITLE_OVERLAY_ID = 'auralang-video-subtitle-overlay'
export const VIDEO_SUBTITLE_OVERLAY_STYLE_ID = 'auralang-video-subtitle-overlay-styles'
export const FLOATING_SUBTITLE_BUTTON_ID = 'auralang-floating-subtitle-button'

// Injected with chrome.scripting.executeScript, which serializes this function
// on its own — it must stay self-contained: no imports and no references to
// module scope (types are erased at build time and are safe).
export function installVideoSubtitleOverlay(): void {
  const overlayId = 'auralang-video-subtitle-overlay'
  const styleId = 'auralang-video-subtitle-overlay-styles'
  const buttonId = 'auralang-floating-subtitle-button'

  const FLOATING_WINDOW_WIDTH = 560
  const FLOATING_WINDOW_HEIGHT = 200

  type CaptionStatus = TranscriptTranslationStatus

  interface CaptionState {
    segmentId: number
    original: string
    translated: string
    status: CaptionStatus
  }

  interface SubtitleView {
    element: HTMLDivElement
    originalLine: HTMLParagraphElement
    translationLine: HTMLParagraphElement
  }

  // The caption block is rendered both inside the page overlay and inside the
  // floating window, so its rules hang off a class rather than the overlay id.
  const blockStyles = `
    .auralang-subtitle-block {
      display: flex;
      flex-direction: column;
      text-align: center;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    }
    .auralang-subtitle-block[hidden] {
      display: none !important;
    }
    .auralang-subtitle-block .auralang-video-subtitle-original {
      margin: 0 0 4px;
      color: rgba(255, 255, 255, 0.78);
      font-size: clamp(13px, 1.4vw, 18px);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .auralang-subtitle-block .auralang-video-subtitle-original[hidden] {
      display: none !important;
    }
    .auralang-subtitle-block .auralang-video-subtitle-translation {
      margin: 0;
      color: #ffffff;
      font-size: clamp(17px, 2vw, 27px);
      font-weight: 700;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .auralang-subtitle-block .auralang-video-subtitle-partial {
      opacity: 0.82;
    }
  `

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    #${overlayId} {
      position: fixed;
      z-index: 2147483647;
      box-sizing: border-box;
      max-width: min(92vw, 1100px);
      padding: 10px 18px;
      border-radius: 12px;
      background: rgba(8, 12, 24, 0.78);
      color: #ffffff;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: none;
      transition: opacity 160ms ease;
    }
    #${overlayId}[hidden] {
      display: none !important;
    }
    #${buttonId} {
      position: fixed;
      z-index: 2147483647;
      padding: 6px 12px;
      border: 0;
      border-radius: 999px;
      background: rgba(8, 12, 24, 0.72);
      color: #ffffff;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 140ms ease, background 140ms ease;
    }
    #${buttonId}:hover,
    #${buttonId}:focus-visible,
    #${buttonId}[aria-pressed="true"] {
      opacity: 1;
      background: rgba(8, 12, 24, 0.92);
    }
    #${buttonId}:focus-visible {
      outline: 2px solid #8b5cf6;
      outline-offset: 2px;
    }
    #${buttonId}[hidden] {
      display: none !important;
    }
    ${blockStyles}
  `
  document.head.append(style)

  function createSubtitleView(target: Document): SubtitleView {
    const element = target.createElement('div')
    element.className = 'auralang-subtitle-block'

    const originalLine = target.createElement('p')
    originalLine.className = 'auralang-video-subtitle-original'
    originalLine.hidden = true

    const translationLine = target.createElement('p')
    translationLine.className = 'auralang-video-subtitle-translation'

    element.append(originalLine, translationLine)
    return { element, originalLine, translationLine }
  }

  const overlay = document.createElement('section')
  overlay.id = overlayId
  overlay.hidden = true
  overlay.setAttribute('aria-live', 'polite')
  overlay.setAttribute('aria-atomic', 'true')

  const overlayView = createSubtitleView(document)
  overlay.append(overlayView.element)
  document.body.append(overlay)

  let observedVideo: HTMLVideoElement | null = null
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null
  let activeVideo: HTMLVideoElement | null = null
  let hasSubtitle = false
  let disposed = false
  let button: HTMLButtonElement | null = null
  let floatingWindow: Window | null = null
  let floatingView: SubtitleView | null = null
  let latestFinal: CaptionState | null = null
  let latestPreview: CaptionState | null = null

  function visibleVideo(): HTMLVideoElement | null {
    const candidates = Array.from(document.querySelectorAll('video'))
      .map((video) => ({ video, rect: video.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width >= 160 && rect.height >= 90)
      .filter(({ rect }) => rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth)
      .sort((first, second) => second.rect.width * second.rect.height - first.rect.width * first.rect.height)

    if (activeVideo && candidates.some(({ video }) => video === activeVideo)) {
      return activeVideo
    }

    const playingVideo = candidates.find(({ video }) => !video.paused && !video.ended)
    if (playingVideo) return playingVideo.video

    return candidates[0]?.video ?? null
  }

  function moveToFullscreenContainer(): void {
    const fullscreenElement = document.fullscreenElement
    const container = fullscreenElement instanceof HTMLElement && fullscreenElement.tagName !== 'VIDEO'
      ? fullscreenElement
      : document.body

    // Re-parent only what is still in the document: a page that removed the
    // overlay (or a disposed capture) must not have it resurrected here.
    if (overlay.isConnected && overlay.parentElement !== container) container.append(overlay)
    if (button?.isConnected && button.parentElement !== container) container.append(button)
  }

  function observeVideo(video: HTMLVideoElement): void {
    if (observedVideo === video || typeof ResizeObserver === 'undefined') return

    resizeObserver ??= new ResizeObserver(positionOverlay)
    resizeObserver.disconnect()
    resizeObserver.observe(video)
    observedVideo = video
  }

  // The floating window opens from a click on the page (Chrome requires a user
  // gesture), so the button tracks the video's top-right corner and stays
  // available even before the first caption arrives.
  function positionFloatingButton(video: HTMLVideoElement | null): void {
    if (!button) return

    if (!video) {
      button.style.left = ''
      button.style.right = '16px'
      button.style.top = '16px'
      button.hidden = false
      return
    }

    const rect = video.getBoundingClientRect()
    button.style.left = ''
    button.style.right = `${Math.max(12, window.innerWidth - rect.right + 16)}px`
    button.style.top = `${Math.max(12, rect.top + 16)}px`
    button.hidden = false
  }

  function positionOverlay(): void {
    if (disposed) return

    const video = visibleVideo()
    moveToFullscreenContainer()
    positionFloatingButton(video)

    if (!hasSubtitle) return

    if (!video) {
      overlay.hidden = true
      return
    }

    observeVideo(video)

    const rect = video.getBoundingClientRect()
    const horizontalInset = Math.min(48, Math.max(16, rect.width * 0.06))
    const verticalInset = Math.min(72, Math.max(20, rect.height * 0.08))
    const left = Math.max(12, rect.left + horizontalInset)
    const right = Math.min(window.innerWidth - 12, rect.right - horizontalInset)

    if (right <= left) {
      overlay.hidden = true
      return
    }

    overlay.style.left = `${left}px`
    overlay.style.width = `${right - left}px`
    overlay.style.bottom = `${Math.max(12, window.innerHeight - rect.bottom + verticalInset)}px`
    overlay.hidden = false
  }

  function applyCaption(
    view: SubtitleView,
    original: string,
    translated: string,
    provisional: boolean,
  ): void {
    const hasTranslation = Boolean(translated)
    view.originalLine.textContent = hasTranslation ? original : ''
    view.originalLine.hidden = !hasTranslation
    view.translationLine.textContent = translated || original
    view.translationLine.classList.toggle('auralang-video-subtitle-partial', provisional)
    view.element.hidden = !original && !translated
  }

  function clearCaption(view: SubtitleView): void {
    view.originalLine.textContent = ''
    view.translationLine.textContent = ''
    view.originalLine.hidden = true
    view.translationLine.classList.remove('auralang-video-subtitle-partial')
    view.element.hidden = true
  }

  function isSettled(status: CaptionStatus): boolean {
    return status === 'translated' || status === 'failed' || status === 'skipped'
  }

  // Mirrors isStreamingTranslationReady in src/utils/translationStream.ts. The
  // injected function cannot import, so the rule is duplicated here: a
  // provisional line must not be replaced by the first token of the LLM stream.
  const STREAM_READY_MIN_CHARS = 12
  const STREAM_READY_PUNCTUATION = /[。！？!?…,，、;；:：]/

  function isStreamingTranslationReady(partial: string, provisional: string): boolean {
    const text = partial.trim()
    if (!text) return false
    if (STREAM_READY_PUNCTUATION.test(text)) return true

    const provisionalLength = provisional.trim().length
    if (text.length >= STREAM_READY_MIN_CHARS) return true
    return provisionalLength > 0 && text.length >= Math.max(6, provisionalLength * 0.5)
  }

  // A finalized segment that is still translating outranks the next
  // utterance's provisional line: the translation the viewer is reading must
  // not be cut off by a preview of speech that has not settled yet.
  function currentCaption(): CaptionState | null {
    const settled = latestFinal
    if (settled && (settled.status === 'pending' || settled.status === 'partial')) return settled
    if (latestPreview && (!settled || latestPreview.segmentId >= settled.segmentId)) return latestPreview
    if (settled && settled.status === 'translated') return settled
    // A failed/skipped line still has the provisional translation to show; a
    // failed line without one is not worth presenting as the original alone.
    if (settled && (settled.status === 'failed' || settled.status === 'skipped') && settled.translated) {
      return settled
    }
    return null
  }

  function renderCaption(): void {
    const caption = currentCaption()
    if (!caption) {
      hideSubtitles()
      return
    }

    // Anything that has not settled is still provisional — including a settled
    // caption still carrying the preview's translation — so it is shown dimmed
    // until the real translation replaces it.
    const provisional = !isSettled(caption.status)
    const streaming = caption.status === 'partial' || caption.status === 'preview'
    applyCaption(overlayView, caption.original, caption.translated, provisional)
    if (floatingView) applyCaption(floatingView, caption.original, caption.translated, provisional)

    // Streaming rewrites this line several times a second; announcing every
    // token would make a screen reader unusable, so only settled text is read.
    overlay.setAttribute('aria-live', streaming ? 'off' : 'polite')
    hasSubtitle = true
    positionOverlay()
  }

  function hideSubtitles(): void {
    hasSubtitle = false
    clearCaption(overlayView)
    if (floatingView) clearCaption(floatingView)
    overlay.hidden = true
    overlay.setAttribute('aria-live', 'polite')
  }

  function floatingApi(): DocumentPictureInPictureApi | null {
    const api = window.documentPictureInPicture
    return api && typeof api.requestWindow === 'function' ? api : null
  }

  function floatingButtonLabel(): string {
    if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
      const message = chrome.i18n.getMessage('floatingWindowToggle')
      if (message) return message
    }
    return 'Floating captions'
  }

  function updateButtonState(): void {
    if (!button) return
    button.setAttribute('aria-pressed', floatingWindow ? 'true' : 'false')
  }

  function closeFloatingWindow(): void {
    const open = floatingWindow
    floatingWindow = null
    floatingView = null
    if (open && !open.closed) open.close()
    updateButtonState()
  }

  function installFloatingStyles(target: Document): void {
    const floatingStyle = target.createElement('style')
    floatingStyle.textContent = `
      html, body {
        margin: 0;
        height: 100%;
        background: #0b1020;
      }
      body {
        color: #ffffff;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .auralang-floating-stage {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 14px 18px;
      }
      .auralang-subtitle-block {
        width: 100%;
      }
      .auralang-subtitle-block .auralang-video-subtitle-original {
        font-size: clamp(13px, 3.4vh, 20px);
      }
      .auralang-subtitle-block .auralang-video-subtitle-translation {
        font-size: clamp(20px, 7vh, 46px);
      }
      ${blockStyles}
    `
    target.head.append(floatingStyle)
  }

  async function openFloatingWindow(): Promise<void> {
    const api = floatingApi()
    if (!api || floatingWindow) return

    let pipWindow: Window
    try {
      pipWindow = await api.requestWindow({
        width: FLOATING_WINDOW_WIDTH,
        height: FLOATING_WINDOW_HEIGHT,
      })
    } catch {
      // No user activation, or the page blocks the API — leave the button off.
      return
    }

    floatingWindow = pipWindow
    installFloatingStyles(pipWindow.document)

    const stage = pipWindow.document.createElement('div')
    stage.className = 'auralang-floating-stage'
    floatingView = createSubtitleView(pipWindow.document)
    stage.append(floatingView.element)
    pipWindow.document.body.append(stage)

    pipWindow.addEventListener('pagehide', () => {
      if (floatingWindow !== pipWindow) return
      floatingWindow = null
      floatingView = null
      updateButtonState()
    })

    updateButtonState()
    renderCaption()
  }

  function toggleFloatingWindow(): void {
    if (floatingWindow) {
      closeFloatingWindow()
      return
    }
    void openFloatingWindow()
  }

  function createFloatingButton(): void {
    if (!floatingApi()) return // Chrome < 116 has no floating window to offer.

    button = document.createElement('button')
    button.id = buttonId
    button.type = 'button'
    button.setAttribute('aria-pressed', 'false')
    const label = floatingButtonLabel()
    button.textContent = label
    button.title = label
    button.hidden = true
    button.addEventListener('click', toggleFloatingWindow)
    document.body.append(button)
  }

  function markActiveVideo(event: Event): void {
    if (event.target instanceof HTMLVideoElement) {
      activeVideo = event.target
      positionOverlay()
    }
  }

  function clearActiveVideo(event: Event): void {
    if (event.target === activeVideo) {
      activeVideo = null
      positionOverlay()
    }
  }

  function onFullscreenChange(): void {
    positionOverlay()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    hideSubtitles()
    closeFloatingWindow()
    chrome.runtime.onMessage.removeListener(onMessage)
    window.removeEventListener('resize', positionOverlay)
    window.removeEventListener('scroll', positionOverlay, true)
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    document.removeEventListener('play', markActiveVideo, true)
    document.removeEventListener('playing', markActiveVideo, true)
    document.removeEventListener('pause', clearActiveVideo, true)
    document.removeEventListener('ended', clearActiveVideo, true)
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    button?.removeEventListener('click', toggleFloatingWindow)
    button?.remove()
    button = null
    style.remove()
    overlay.remove()
  }

  // Mirrors stripTrailingSentencePunctuation in src/utils/text.ts; the injected
  // function has to stay self-contained.
  const TRAILING_SENTENCE_PUNCTUATION = /[。．.!?！？、,，…]+$/u

  function stripTrailingSentencePunctuation(text: string): string {
    return text.replace(TRAILING_SENTENCE_PUNCTUATION, '')
  }

  function captionStatus(payload: { translationStatus?: unknown; translated: string }): CaptionStatus {
    const raw = payload.translationStatus
    if (
      raw === 'preview'
      || raw === 'pending'
      || raw === 'partial'
      || raw === 'translated'
      || raw === 'failed'
      || raw === 'skipped'
      || raw === 'cleared'
    ) {
      return raw
    }
    return payload.translated ? 'translated' : 'pending'
  }

  function onMessage(message: unknown): void {
    if (disposed || typeof message !== 'object' || message === null || !('type' in message)) return

    if (message.type === 'DISPOSE_VIDEO_SUBTITLE_OVERLAY') {
      dispose()
      return
    }

    if (message.type !== 'VIDEO_SUBTITLE_UPDATE' || !('payload' in message)) return

    const { payload } = message
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('segmentId' in payload) ||
      !('original' in payload) ||
      !('translated' in payload) ||
      typeof payload.segmentId !== 'number' ||
      !Number.isInteger(payload.segmentId) ||
      payload.segmentId < 1 ||
      typeof payload.original !== 'string' ||
      (typeof payload.translated !== 'string' && payload.translated !== null)
    ) {
      return
    }

    const original = payload.original.trim()
    const translated = payload.translated?.trim() ?? ''
    const status = captionStatus({
      translationStatus: 'translationStatus' in payload ? payload.translationStatus : undefined,
      translated,
    })

    if (status === 'cleared') {
      if (latestPreview && latestPreview.segmentId === payload.segmentId) latestPreview = null
      renderCaption()
      return
    }

    const caption: CaptionState = {
      segmentId: payload.segmentId,
      original,
      translated,
      status,
    }

    if (status === 'preview') {
      // The settled caption may already be on screen with no translation yet:
      // keep feeding it the provisional one until the real one arrives. A
      // failed/skipped row with no text can still take a preview that was in
      // flight when the request failed.
      if (latestFinal && caption.segmentId === latestFinal.segmentId) {
        const canFill =
          latestFinal.status === 'pending'
          || ((latestFinal.status === 'failed' || latestFinal.status === 'skipped') && !latestFinal.translated)
        if (canFill && caption.translated) {
          latestFinal = { ...latestFinal, translated: caption.translated }
          renderCaption()
        }
        return
      }
      if (latestPreview && caption.segmentId < latestPreview.segmentId) return
      latestPreview = caption
      renderCaption()
      return
    }

    // The settled caption inherits the preview's translation, so the line never
    // blanks out to the original while the real translation runs.
    if (
      latestPreview
      && caption.segmentId === latestPreview.segmentId
      && !caption.translated
      && latestPreview.translated
    ) {
      caption.translated = latestPreview.translated
    }

    // A terminal update without its own text keeps the line already on screen.
    if (
      (caption.status === 'failed' || caption.status === 'skipped')
      && !caption.translated
      && latestFinal
      && latestFinal.segmentId === caption.segmentId
      && latestFinal.translated
    ) {
      caption.translated = latestFinal.translated
    }

    // A streaming update without text is a no-op, not a request to blank the
    // line. The first short tokens are held back until they form a phrase.
    if (caption.status === 'partial') {
      if (!caption.translated) return
      if (
        latestFinal
        && latestFinal.segmentId === caption.segmentId
        && (latestFinal.status === 'pending' || latestFinal.status === 'preview')
        && latestFinal.translated
        && !isStreamingTranslationReady(caption.translated, latestFinal.translated)
      ) {
        return
      }
    }

    if (latestFinal) {
      if (caption.segmentId < latestFinal.segmentId) return
      if (caption.segmentId === latestFinal.segmentId) {
        const currentOriginal = latestFinal.original.trim()
        const incomingOriginal = caption.original.trim()
        // A late answer for the text this line had before it was extended is
        // stale. (The preview-to-settled path is handled above and may shrink.)
        if (
          incomingOriginal.length < currentOriginal.length
          && currentOriginal.startsWith(stripTrailingSentencePunctuation(incomingOriginal))
        ) {
          return
        }
        // A sentence continued in the next chunk amends the line it was cut
        // from: the original grows and its translation restarts. That is the
        // one case where a settled line may step back to pending.
        const extendsOriginal =
          caption.status === 'pending'
          && incomingOriginal.length > currentOriginal.length
          && incomingOriginal.startsWith(stripTrailingSentencePunctuation(currentOriginal))
        if (extendsOriginal) {
          // Keep the line that is on screen until the merged sentence's
          // translation streams.
          if (!caption.translated && latestFinal.translated) {
            caption.translated = latestFinal.translated
          }
        } else {
          // A completed translation must not be walked back to a failure, a
          // retraction or another provisional state.
          if (latestFinal.status === 'translated' && caption.status !== 'translated') {
            return
          }
          // A settled caption must not fall back to an earlier state.
          if (isSettled(latestFinal.status) && !isSettled(caption.status)) {
            return
          }
        }
      }
    }

    latestFinal = caption
    if (latestPreview && caption.segmentId >= latestPreview.segmentId) latestPreview = null
    renderCaption()
  }

  chrome.runtime.onMessage.addListener(onMessage)
  window.addEventListener('resize', positionOverlay)
  window.addEventListener('scroll', positionOverlay, true)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('play', markActiveVideo, true)
  document.addEventListener('playing', markActiveVideo, true)
  document.addEventListener('pause', clearActiveVideo, true)
  document.addEventListener('ended', clearActiveVideo, true)

  mutationObserver = new MutationObserver(positionOverlay)
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true })

  createFloatingButton()
  positionOverlay()
}

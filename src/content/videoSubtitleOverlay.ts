export const VIDEO_SUBTITLE_OVERLAY_ID = 'auralang-video-subtitle-overlay'
export const VIDEO_SUBTITLE_OVERLAY_STYLE_ID = 'auralang-video-subtitle-overlay-styles'

export function installVideoSubtitleOverlay(): void {
  const overlayId = 'auralang-video-subtitle-overlay'
  const styleId = 'auralang-video-subtitle-overlay-styles'
  if (document.getElementById(overlayId)) return

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
      text-align: center;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
      pointer-events: none;
      transition: opacity 160ms ease;
    }
    #${overlayId}[hidden] {
      display: none !important;
    }
    #${overlayId} .auralang-video-subtitle-original,
    #${overlayId} .auralang-video-subtitle-translation {
      margin: 0;
      overflow-wrap: anywhere;
    }
    #${overlayId} .auralang-video-subtitle-original {
      margin-bottom: 4px;
      color: rgba(255, 255, 255, 0.78);
      font-size: clamp(13px, 1.4vw, 18px);
      line-height: 1.35;
    }
    #${overlayId} .auralang-video-subtitle-translation {
      color: #ffffff;
      font-size: clamp(17px, 2vw, 27px);
      font-weight: 700;
      line-height: 1.35;
    }
  `
  document.head.append(style)

  const overlay = document.createElement('section')
  overlay.id = overlayId
  overlay.hidden = true
  overlay.setAttribute('aria-live', 'polite')
  overlay.setAttribute('aria-atomic', 'true')

  const originalLine = document.createElement('p')
  originalLine.className = 'auralang-video-subtitle-original'
  originalLine.hidden = true

  const translationLine = document.createElement('p')
  translationLine.className = 'auralang-video-subtitle-translation'

  overlay.append(originalLine, translationLine)
  document.body.append(overlay)

  let observedVideo: HTMLVideoElement | null = null
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null
  let activeVideo: HTMLVideoElement | null = null
  let hasSubtitle = false
  let disposed = false
  let displayedSegmentId = 0
  let displayedTranslation = false

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

    if (overlay.parentElement !== container) container.append(overlay)
  }

  function observeVideo(video: HTMLVideoElement): void {
    if (observedVideo === video || typeof ResizeObserver === 'undefined') return

    resizeObserver ??= new ResizeObserver(positionOverlay)
    resizeObserver.disconnect()
    resizeObserver.observe(video)
    observedVideo = video
  }

  function positionOverlay(): void {
    if (disposed || !hasSubtitle) return

    const video = visibleVideo()
    if (!video) {
      overlay.hidden = true
      return
    }

    observeVideo(video)
    moveToFullscreenContainer()

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

  function hideSubtitles(): void {
    hasSubtitle = false
    originalLine.textContent = ''
    translationLine.textContent = ''
    originalLine.hidden = true
    overlay.hidden = true
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
    moveToFullscreenContainer()
    positionOverlay()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    hideSubtitles()
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
    style.remove()
    overlay.remove()
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

    const translated = payload.translated?.trim() ?? ''
    const original = payload.original.trim()
    if (payload.segmentId < displayedSegmentId) return
    if (payload.segmentId === displayedSegmentId && !translated && displayedTranslation) return

    displayedSegmentId = payload.segmentId
    displayedTranslation = Boolean(translated)

    if (!translated && !original) {
      hideSubtitles()
      return
    }

    originalLine.textContent = translated ? original : ''
    originalLine.hidden = !translated
    translationLine.textContent = translated || original
    hasSubtitle = true
    positionOverlay()
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
}

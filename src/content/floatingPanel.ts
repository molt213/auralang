export const FLOATING_PANEL_HOST_ID = 'auralang-floating-panel'
export const FLOATING_PANEL_FRAME_ID = 'auralang-floating-panel-frame'

// Injected with chrome.scripting.executeScript, which serializes this function
// on its own — it must stay self-contained: no imports and no references to
// module scope (types are erased at build time and are safe). The exported ids
// above are mirrored as literals inside for that reason.
export function installFloatingPanel(): void {
  const hostId = 'auralang-floating-panel'
  const frameId = 'auralang-floating-panel-frame'
  const geometryKey = 'auralang_floating_panel_geometry'

  const DEFAULT_WIDTH = 360
  const DEFAULT_HEIGHT = 560
  const MIN_WIDTH = 320
  const MIN_HEIGHT = 400
  const COLLAPSED_HEIGHT = 34
  const VIEWPORT_MARGIN = 16

  interface PanelGeometry {
    left: number
    top: number
    width: number
    height: number
    collapsed: boolean
  }

  type PanelHost = HTMLDivElement & { __auralangPanelDispose?: () => void }

  function message(key: string, fallback: string): string {
    try {
      const text = chrome.i18n?.getMessage(key)
      return text || fallback
    } catch {
      return fallback
    }
  }

  const title = message('floatingPanelTitle', 'AuraLang')
  const minimizeLabel = message('floatingPanelMinimize', 'Minimize panel')
  const expandLabel = message('floatingPanelExpand', 'Expand panel')
  const closeLabel = message('floatingPanelClose', 'Close panel')

  // Clicking the toolbar icon while the panel is open closes it. A stale panel
  // left behind by an extension reload has no dispose handle in this isolated
  // world, so it is removed and replaced in the same click instead.
  const existing = document.getElementById(hostId) as PanelHost | null
  if (existing) {
    if (typeof existing.__auralangPanelDispose === 'function') {
      existing.__auralangPanelDispose()
      return
    }
    existing.remove()
  }

  const host = document.createElement('div') as PanelHost
  host.id = hostId
  host.setAttribute('role', 'region')
  host.setAttribute('aria-label', title)
  // Inline so a page's own `div` rules cannot move or hide the panel.
  host.style.cssText =
    'position:fixed;z-index:2147483647;box-sizing:border-box;margin:0;pointer-events:auto;'

  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    :host {
      position: fixed;
      z-index: 2147483647;
      box-sizing: border-box;
      color-scheme: dark;
    }
    * {
      box-sizing: border-box;
    }
    .frame {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 16px;
      background: rgba(11, 16, 32, 0.16);
      box-shadow:
        0 24px 64px rgba(0, 0, 0, 0.5),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
      -webkit-backdrop-filter: blur(24px) saturate(1.5);
      backdrop-filter: blur(24px) saturate(1.5);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 32px;
      flex: 0 0 32px;
      padding: 0 4px 0 9px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(15, 23, 42, 0.52);
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .bar:active {
      cursor: grabbing;
    }
    .grip {
      display: grid;
      grid-template-columns: repeat(2, 2px);
      gap: 3px;
      opacity: 0.5;
    }
    .grip span {
      width: 2px;
      height: 2px;
      border-radius: 999px;
      background: #94a3b8;
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      color: #cbd5e1;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      gap: 2px;
    }
    .actions button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #94a3b8;
      font: inherit;
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
    }
    .actions button:hover,
    .actions button:focus-visible {
      background: rgba(148, 163, 184, 0.16);
      color: #f8fafc;
    }
    .actions button:focus-visible {
      outline: 2px solid #8b5cf6;
      outline-offset: 1px;
    }
    .iframe-wrap {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      background: transparent;
    }
    iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: transparent;
      color-scheme: normal;
    }
    .frame.is-collapsed .iframe-wrap,
    .frame.is-collapsed .resize {
      display: none;
    }
    .resize {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      touch-action: none;
    }
    .resize::after {
      content: "";
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 6px;
      height: 6px;
      border-right: 2px solid rgba(148, 163, 184, 0.6);
      border-bottom: 2px solid rgba(148, 163, 184, 0.6);
      border-radius: 0 0 2px 0;
    }
    :host(.is-interacting) iframe {
      pointer-events: none;
    }
  `

  const frame = document.createElement('div')
  frame.className = 'frame'

  const bar = document.createElement('div')
  bar.className = 'bar'

  const grip = document.createElement('div')
  grip.className = 'grip'
  grip.setAttribute('aria-hidden', 'true')
  for (let index = 0; index < 6; index += 1) {
    grip.append(document.createElement('span'))
  }

  const titleElement = document.createElement('span')
  titleElement.className = 'title'
  titleElement.textContent = title

  const actions = document.createElement('div')
  actions.className = 'actions'

  const minimizeButton = document.createElement('button')
  minimizeButton.type = 'button'
  minimizeButton.textContent = '−'
  minimizeButton.setAttribute('aria-controls', frameId)

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.textContent = '×'
  closeButton.setAttribute('aria-label', closeLabel)
  closeButton.title = closeLabel

  actions.append(minimizeButton, closeButton)
  bar.append(grip, titleElement, actions)

  const iframeWrap = document.createElement('div')
  iframeWrap.className = 'iframe-wrap'

  const iframe = document.createElement('iframe')
  iframe.id = frameId
  iframe.title = title
  iframeWrap.append(iframe)

  const resizeGrip = document.createElement('div')
  resizeGrip.className = 'resize'
  resizeGrip.setAttribute('aria-hidden', 'true')

  frame.append(bar, iframeWrap, resizeGrip)
  shadow.append(style, frame)

  const root = document.body ?? document.documentElement
  root.append(host)

  let disposed = false
  let geometry: PanelGeometry = {
    left: 0,
    top: 64,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    collapsed: false,
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum)
  }

  function clampGeometry(input: PanelGeometry): PanelGeometry {
    const availableWidth = Math.max(1, window.innerWidth - VIEWPORT_MARGIN)
    const availableHeight = Math.max(COLLAPSED_HEIGHT, window.innerHeight - VIEWPORT_MARGIN)
    const width = clamp(input.width, Math.min(MIN_WIDTH, availableWidth), availableWidth)
    const height = clamp(input.height, Math.min(MIN_HEIGHT, availableHeight), availableHeight)

    return {
      left: clamp(input.left, 0, Math.max(0, window.innerWidth - width)),
      top: clamp(input.top, 0, Math.max(0, window.innerHeight - height)),
      width,
      height,
      collapsed: input.collapsed === true,
    }
  }

  function applyGeometry(): void {
    host.style.left = `${geometry.left}px`
    host.style.top = `${geometry.top}px`
    host.style.width = `${geometry.width}px`
    host.style.height = `${geometry.collapsed ? COLLAPSED_HEIGHT : geometry.height}px`
    frame.classList.toggle('is-collapsed', geometry.collapsed)
    minimizeButton.textContent = geometry.collapsed ? '+' : '−'
    minimizeButton.setAttribute('aria-expanded', geometry.collapsed ? 'false' : 'true')
    const label = geometry.collapsed ? expandLabel : minimizeLabel
    minimizeButton.setAttribute('aria-label', label)
    minimizeButton.title = label
  }

  function saveGeometry(): void {
    try {
      // A closed extension context must not break the page; older mocks and
      // browsers may return void instead of a promise.
      void Promise.resolve(chrome.storage.local.set({ [geometryKey]: geometry })).catch(() => undefined)
    } catch {
      // The extension context was invalidated.
    }
  }

  function isStoredGeometry(value: unknown): value is PanelGeometry {
    if (typeof value !== 'object' || value === null) return false
    const record = value as Record<string, unknown>
    return (
      typeof record.left === 'number' && Number.isFinite(record.left)
      && typeof record.top === 'number' && Number.isFinite(record.top)
      && typeof record.width === 'number' && Number.isFinite(record.width)
      && typeof record.height === 'number' && Number.isFinite(record.height)
    )
  }

  function loadGeometry(): void {
    try {
      chrome.storage.local.get(geometryKey, (result: Record<string, unknown>) => {
        if (disposed || chrome.runtime.lastError) return
        const stored: unknown = result[geometryKey]
        if (!isStoredGeometry(stored)) return
        geometry = clampGeometry(stored)
        applyGeometry()
      })
    } catch {
      // Storage is optional; the default geometry is already applied.
    }
  }

  let dragStart: {
    pointerId: number
    x: number
    y: number
    left: number
    top: number
  } | null = null

  function onBarPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button')) return

    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: geometry.left,
      top: geometry.top,
    }
    host.classList.add('is-interacting')
    try {
      bar.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is an enhancement; dragging still works without it.
    }
    event.preventDefault()
  }

  function onBarPointerMove(event: PointerEvent): void {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return
    geometry = clampGeometry({
      ...geometry,
      left: dragStart.left + event.clientX - dragStart.x,
      top: dragStart.top + event.clientY - dragStart.y,
    })
    applyGeometry()
  }

  function endBarDrag(event: PointerEvent): void {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return
    dragStart = null
    host.classList.remove('is-interacting')
    try {
      bar.releasePointerCapture(event.pointerId)
    } catch {
      // The capture may already be gone.
    }
    saveGeometry()
  }

  let resizeStart: {
    pointerId: number
    x: number
    y: number
    width: number
    height: number
  } | null = null

  function onResizePointerDown(event: PointerEvent): void {
    if (event.button !== 0 || geometry.collapsed) return
    resizeStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: geometry.width,
      height: geometry.height,
    }
    host.classList.add('is-interacting')
    try {
      resizeGrip.setPointerCapture(event.pointerId)
    } catch {
      // See onBarPointerDown.
    }
    event.preventDefault()
  }

  function onResizePointerMove(event: PointerEvent): void {
    if (!resizeStart || event.pointerId !== resizeStart.pointerId) return
    geometry = clampGeometry({
      ...geometry,
      width: resizeStart.width + event.clientX - resizeStart.x,
      height: resizeStart.height + event.clientY - resizeStart.y,
    })
    applyGeometry()
  }

  function endResize(event: PointerEvent): void {
    if (!resizeStart || event.pointerId !== resizeStart.pointerId) return
    resizeStart = null
    host.classList.remove('is-interacting')
    try {
      resizeGrip.releasePointerCapture(event.pointerId)
    } catch {
      // The capture may already be gone.
    }
    saveGeometry()
  }

  function toggleCollapsed(): void {
    geometry = { ...geometry, collapsed: !geometry.collapsed }
    applyGeometry()
    saveGeometry()
  }

  function onViewportResize(): void {
    geometry = clampGeometry(geometry)
    applyGeometry()
  }

  function keepInFullscreenContainer(): void {
    if (!host.isConnected) return
    const fullscreen = document.fullscreenElement
    const container =
      fullscreen instanceof HTMLElement && fullscreen.tagName !== 'VIDEO'
        ? fullscreen
        : document.body ?? document.documentElement
    if (container && host.parentElement !== container) container.append(host)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    observer.disconnect()
    window.removeEventListener('resize', onViewportResize)
    document.removeEventListener('fullscreenchange', keepInFullscreenContainer)
    bar.removeEventListener('pointerdown', onBarPointerDown)
    bar.removeEventListener('pointermove', onBarPointerMove)
    bar.removeEventListener('pointerup', endBarDrag)
    bar.removeEventListener('pointercancel', endBarDrag)
    resizeGrip.removeEventListener('pointerdown', onResizePointerDown)
    resizeGrip.removeEventListener('pointermove', onResizePointerMove)
    resizeGrip.removeEventListener('pointerup', endResize)
    resizeGrip.removeEventListener('pointercancel', endResize)
    minimizeButton.removeEventListener('click', toggleCollapsed)
    closeButton.removeEventListener('click', dispose)
    host.remove()
  }

  // If the page (or a SPA re-render) removes the host, release the listeners
  // that would otherwise keep this closure alive for the page's lifetime.
  const observer = new MutationObserver(() => {
    if (!host.isConnected) dispose()
  })

  minimizeButton.addEventListener('click', toggleCollapsed)
  closeButton.addEventListener('click', dispose)
  bar.addEventListener('pointerdown', onBarPointerDown)
  bar.addEventListener('pointermove', onBarPointerMove)
  bar.addEventListener('pointerup', endBarDrag)
  bar.addEventListener('pointercancel', endBarDrag)
  resizeGrip.addEventListener('pointerdown', onResizePointerDown)
  resizeGrip.addEventListener('pointermove', onResizePointerMove)
  resizeGrip.addEventListener('pointerup', endResize)
  resizeGrip.addEventListener('pointercancel', endResize)
  window.addEventListener('resize', onViewportResize)
  document.addEventListener('fullscreenchange', keepInFullscreenContainer)
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // Left side by default: the always-on-top captions button lives at the
  // video's top-right, and the panel must not cover the only way to open it.
  geometry = clampGeometry({
    left: VIEWPORT_MARGIN,
    top: 64,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    collapsed: false,
  })
  applyGeometry()

  try {
    iframe.src = chrome.runtime.getURL('src/popup/index.html')
  } catch {
    dispose()
    return
  }

  host.__auralangPanelDispose = dispose
  loadGeometry()
}

import type { AsrMode } from '../asr/types'
import type {
  CaptureStateResponse,
  ExtensionMessage,
  StartCapturePayload,
  TranslationConfig,
} from '../types'
import {
  clearCaptureSession,
  loadCaptureSession,
  saveCaptureSession,
} from './captureSessionService'
import {
  disposeVideoSubtitleOverlay,
  ensureVideoSubtitleOverlay,
  updateVideoSubtitles,
} from './videoSubtitleService'

const OFFSCREEN_URL = chrome.runtime.getURL('src/offscreen/index.html')

let captureActive = false
let capturedTabId: number | null = null
let latestTranscriptSegmentId = 0

const PANEL_PATH = 'src/popup/index.html'

// Per-tab side panel, opened explicitly on icon click. A globally-registered
// panel (manifest side_panel.default_path + openPanelOnActionClick) stays
// visible on every tab and window — and lets the user hit Start on tabs where
// the icon was never clicked, where activeTab was never granted, so capture
// fails with "Extension has not been invoked for the current page". Opening
// per-tab means the icon click both grants activeTab for that exact tab and
// scopes the panel to it: it only shows while that tab is active.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return
  void chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true })
  void chrome.sidePanel.open({ tabId: tab.id })
})

// Create offscreen document immediately so Whisper model starts loading
chrome.runtime.onInstalled.addListener((details) => {
  void ensureOffscreenDocument()
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/index.html') })
  }
})
chrome.runtime.onStartup.addListener(() => void ensureOffscreenDocument())

async function setCaptureActive(active: boolean): Promise<void> {
  captureActive = active
  latestTranscriptSegmentId = 0
  if (active && capturedTabId !== null) {
    await saveCaptureSession(capturedTabId, latestTranscriptSegmentId)
    return
  }
  await clearCaptureSession()
}

async function getCaptureActive(): Promise<boolean> {
  if (captureActive) return true
  const session = await loadCaptureSession()
  captureActive = session.active
  capturedTabId = session.tabId
  latestTranscriptSegmentId = session.latestSegmentId
  return captureActive
}

async function getCapturedTabId(): Promise<number | null> {
  if (capturedTabId !== null) return capturedTabId
  const session = await loadCaptureSession()
  captureActive = session.active
  capturedTabId = session.tabId
  latestTranscriptSegmentId = session.latestSegmentId
  return capturedTabId
}

async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Capture and process tab audio stream for real-time translation',
    })
  }
}

async function startCapture(payload: StartCapturePayload): Promise<void> {
  await ensureOffscreenDocument()
  await chrome.runtime.sendMessage<ExtensionMessage>({
    type: 'BEGIN_STREAM',
    payload,
  })
  await setCaptureActive(true)
}

async function stopCapture(): Promise<void> {
  const tabId = await getCapturedTabId()
  if (tabId !== null) void disposeVideoSubtitleOverlay(tabId)

  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })
  if (contexts.length > 0) {
    // Keep offscreen alive so the model stays in memory
    await chrome.runtime.sendMessage<ExtensionMessage>({ type: 'END_STREAM' })
  }
  capturedTabId = null
  await setCaptureActive(false)
}

// Backup for the offscreen "stream ended" signal: if the captured tab is closed
// outright, make sure our own state doesn't stay stuck on "active".
chrome.tabs.onRemoved.addListener((tabId) => {
  void getCapturedTabId().then((capturedId) => {
    if (tabId === capturedId) return stopCapture()
  })
})

function requestMediaStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'No stream ID'))
        return
      }
      resolve(streamId)
    })
  })
}

async function beginCaptureForTab(
  tabId: number,
  targetLanguage: string,
  sourceLanguage: string,
  asrMode: AsrMode,
  originalVolume: number,
  translation: TranslationConfig,
  isRetry = false,
): Promise<void> {
  try {
    const streamId = await requestMediaStreamId(tabId)
    capturedTabId = tabId
    await ensureVideoSubtitleOverlay(tabId)
    await startCapture({ streamId, targetLanguage, sourceLanguage, asrMode, originalVolume, translation })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknownError'
    // Stale session from a tab that closed without a clean STOP_CAPTURE — clear
    // our own state and retry once before giving up.
    if (!isRetry && msg.includes('active stream')) {
      await stopCapture()
      await beginCaptureForTab(tabId, targetLanguage, sourceLanguage, asrMode, originalVolume, translation, true)
      return
    }
    throw err
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'START_CAPTURE') {
      const { targetLanguage, sourceLanguage, asrMode, originalVolume, translation } = message.payload

      // targetTabId = tab to capture; omit consumerTabId so offscreen can redeem the streamId (Chrome 116+)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id
        if (!tabId) {
          sendResponse({ success: false, error: 'No active tab found' })
          return
        }
        beginCaptureForTab(tabId, targetLanguage, sourceLanguage, asrMode, originalVolume, translation)
          .then(() => sendResponse({ success: true }))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : 'unknownError'
            sendResponse({ success: false, error: msg })
          })
      })
      return true
    }

    if (message.type === 'STOP_CAPTURE') {
      stopCapture()
        .then(() => sendResponse({ success: true }))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'unknownError'
          sendResponse({ success: false, error: msg })
        })
      return true
    }

    if (message.type === 'CAPTURE_ENDED') {
      void stopCapture()
      return false
    }

    if (message.type === 'TRANSCRIPT_UPDATE') {
      void getCapturedTabId().then((tabId) => {
        if (!captureActive || tabId === null) return

        if (message.payload.segmentId > latestTranscriptSegmentId) {
          latestTranscriptSegmentId = message.payload.segmentId
          void saveCaptureSession(tabId, latestTranscriptSegmentId).catch(() => undefined)
        }
        return updateVideoSubtitles(tabId, message.payload)
      })
      return false
    }

    if (message.type === 'GET_CAPTURE_STATE') {
      void getCaptureActive().then((active) => {
        const response: CaptureStateResponse = {
          active,
          latestSegmentId: active ? latestTranscriptSegmentId : 0,
        }
        sendResponse(response)
      })
      return true
    }
  },
)

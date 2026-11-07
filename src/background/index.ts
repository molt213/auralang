import type { AsrMode } from '../asr/types'
import type {
  CaptureStateResponse,
  ExtensionMessage,
  FinalTranslationConfig,
  StartCapturePayload,
  TranslationConfig,
} from '../types'
import {
  clearCaptureSession,
  loadCaptureSession,
  saveCaptureSession,
} from './captureSessionService'
import { installFloatingPanel } from '../content/floatingPanel'
import {
  disposeVideoSubtitleOverlay,
  ensureVideoSubtitleOverlay,
  updateVideoSubtitles,
} from './videoSubtitleService'

const OFFSCREEN_URL = chrome.runtime.getURL('src/offscreen/index.html')

let captureActive = false
let capturedTabId: number | null = null
let latestTranscriptSegmentId = 0

// The panel floats inside the page instead of taking over a side panel, so the
// video keeps its full width. The icon click both grants activeTab for this
// exact tab (needed for tabCapture) and toggles the panel on it.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return
  void chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: installFloatingPanel })
    .catch(() => undefined)
})

// Create offscreen document immediately so Whisper model starts loading
chrome.runtime.onInstalled.addListener((details) => {
  void ensureOffscreenDocument()
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/index.html') })
  }
})
chrome.runtime.onStartup.addListener(() => void ensureOffscreenDocument())

function updateActionBadge(tabId: number, active: boolean): void {
  try {
    void chrome.action.setBadgeText({ tabId, text: active ? 'REC' : '' }).catch(() => undefined)
    if (active) {
      void chrome.action.setBadgeBackgroundColor({ tabId, color: '#6C4DFF' }).catch(() => undefined)
    }
  } catch {
    // The badge is a convenience; a browser that lacks it must not break capture.
  }
}

async function setCaptureActive(active: boolean): Promise<void> {
  const tabId = capturedTabId
  captureActive = active
  latestTranscriptSegmentId = 0
  if (active && tabId !== null) {
    updateActionBadge(tabId, true)
    await saveCaptureSession(tabId, latestTranscriptSegmentId)
    return
  }
  // Closing the panel does not stop capture, so the toolbar badge is what
  // tells the user a tab is still being captured.
  if (tabId !== null) updateActionBadge(tabId, false)
  await clearCaptureSession()
}

function requestStreamState(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'GET_STREAM_STATE' } satisfies ExtensionMessage,
      (response: { capturing?: boolean } | undefined) => {
        if (chrome.runtime.lastError) {
          resolve(false)
          return
        }
        resolve(response?.capturing === true)
      },
    )
  })
}

async function getCaptureActive(): Promise<boolean> {
  if (!captureActive) {
    const session = await loadCaptureSession()
    captureActive = session.active
    capturedTabId = session.tabId
    latestTranscriptSegmentId = session.latestSegmentId
  }
  if (!captureActive) return false

  // The persisted flag can outlive the offscreen stream (extension reload, a
  // crashed document). Never let the panel sit on "waiting for speech" for a
  // capture that is not actually running.
  if (await requestStreamState()) return true

  captureActive = false
  capturedTabId = null
  latestTranscriptSegmentId = 0
  await clearCaptureSession()
  return false
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
  // BEGIN_STREAM only resolves after the offscreen document has set up its
  // audio graph, but a silent failure (or an old document that ignored the
  // message) must not leave the panel pretending to listen.
  if (!(await requestStreamState())) {
    throw new Error('captureNotStarted')
  }
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
  await setCaptureActive(false)
  capturedTabId = null
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
  finalTranslation: FinalTranslationConfig,
  isRetry = false,
): Promise<void> {
  try {
    const streamId = await requestMediaStreamId(tabId)
    capturedTabId = tabId
    await ensureVideoSubtitleOverlay(tabId)
    await startCapture({
      streamId,
      targetLanguage,
      sourceLanguage,
      asrMode,
      originalVolume,
      translation,
      finalTranslation,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknownError'
    // Stale session from a tab that closed without a clean STOP_CAPTURE — clear
    // our own state and retry once before giving up.
    if (!isRetry && msg.includes('active stream')) {
      await stopCapture()
      await beginCaptureForTab(
        tabId,
        targetLanguage,
        sourceLanguage,
        asrMode,
        originalVolume,
        translation,
        finalTranslation,
        true,
      )
      return
    }
    throw err
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'START_CAPTURE') {
      const {
        targetLanguage,
        sourceLanguage,
        asrMode,
        originalVolume,
        translation,
        finalTranslation,
      } = message.payload

      // targetTabId = tab to capture; omit consumerTabId so offscreen can redeem the streamId (Chrome 116+)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id
        if (!tabId) {
          sendResponse({ success: false, error: 'No active tab found' })
          return
        }
        beginCaptureForTab(
          tabId,
          targetLanguage,
          sourceLanguage,
          asrMode,
          originalVolume,
          translation,
          finalTranslation,
        )
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

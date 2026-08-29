export const CAPTURE_STATE_KEY = 'auralang_capture_active'
export const CAPTURED_TAB_ID_KEY = 'auralang_captured_tab_id'
export const LATEST_SEGMENT_ID_KEY = 'auralang_latest_segment_id'

export interface CaptureSession {
  active: boolean
  tabId: number | null
  latestSegmentId: number
}

export async function saveCaptureSession(tabId: number, latestSegmentId = 0): Promise<void> {
  await chrome.storage.session.set({
    [CAPTURE_STATE_KEY]: true,
    [CAPTURED_TAB_ID_KEY]: tabId,
    [LATEST_SEGMENT_ID_KEY]: latestSegmentId,
  })
}

export async function loadCaptureSession(): Promise<CaptureSession> {
  const stored = await chrome.storage.session.get([
    CAPTURE_STATE_KEY,
    CAPTURED_TAB_ID_KEY,
    LATEST_SEGMENT_ID_KEY,
  ])
  const tabId = typeof stored[CAPTURED_TAB_ID_KEY] === 'number' ? stored[CAPTURED_TAB_ID_KEY] : null
  const latestSegmentId =
    typeof stored[LATEST_SEGMENT_ID_KEY] === 'number' && stored[LATEST_SEGMENT_ID_KEY] >= 0
      ? stored[LATEST_SEGMENT_ID_KEY]
      : 0

  if (stored[CAPTURE_STATE_KEY] !== true || tabId === null) {
    return { active: false, tabId: null, latestSegmentId: 0 }
  }

  return { active: true, tabId, latestSegmentId }
}

export async function clearCaptureSession(): Promise<void> {
  await chrome.storage.session.remove([CAPTURE_STATE_KEY, CAPTURED_TAB_ID_KEY, LATEST_SEGMENT_ID_KEY])
}

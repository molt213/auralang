export const CAPTURE_STATE_KEY = 'auralang_capture_active'
export const CAPTURED_TAB_ID_KEY = 'auralang_captured_tab_id'

export interface CaptureSession {
  active: boolean
  tabId: number | null
}

export async function saveCaptureSession(tabId: number): Promise<void> {
  await chrome.storage.session.set({
    [CAPTURE_STATE_KEY]: true,
    [CAPTURED_TAB_ID_KEY]: tabId,
  })
}

export async function loadCaptureSession(): Promise<CaptureSession> {
  const stored = await chrome.storage.session.get([CAPTURE_STATE_KEY, CAPTURED_TAB_ID_KEY])
  const tabId = typeof stored[CAPTURED_TAB_ID_KEY] === 'number' ? stored[CAPTURED_TAB_ID_KEY] : null

  if (stored[CAPTURE_STATE_KEY] !== true || tabId === null) {
    return { active: false, tabId: null }
  }

  return { active: true, tabId }
}

export async function clearCaptureSession(): Promise<void> {
  await chrome.storage.session.remove([CAPTURE_STATE_KEY, CAPTURED_TAB_ID_KEY])
}

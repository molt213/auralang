import { installVideoSubtitleOverlay } from '../content/videoSubtitleOverlay'
import type {
  DisposeVideoSubtitleOverlayMessage,
  TranscriptUpdatePayload,
  VideoSubtitleUpdateMessage,
} from '../types'

export async function ensureVideoSubtitleOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: installVideoSubtitleOverlay,
    })
  } catch {
    // A page may reject injection even though tab audio capture still works.
  }
}

export async function updateVideoSubtitles(
  tabId: number,
  payload: TranscriptUpdatePayload,
): Promise<void> {
  const message: VideoSubtitleUpdateMessage = { type: 'VIDEO_SUBTITLE_UPDATE', payload }

  try {
    await chrome.tabs.sendMessage(tabId, message)
  } catch {
    // Captions are optional, so a navigated or closed page must not stop translation.
  }
}

export async function disposeVideoSubtitleOverlay(tabId: number): Promise<void> {
  const message: DisposeVideoSubtitleOverlayMessage = { type: 'DISPOSE_VIDEO_SUBTITLE_OVERLAY' }

  try {
    await chrome.tabs.sendMessage(tabId, message)
  } catch {
    // The tab can disappear before capture cleanup finishes.
  }
}

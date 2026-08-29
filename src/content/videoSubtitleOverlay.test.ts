import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import type { ExtensionMessage } from '../types'
import {
  VIDEO_SUBTITLE_OVERLAY_ID,
  VIDEO_SUBTITLE_OVERLAY_STYLE_ID,
  installVideoSubtitleOverlay,
} from './videoSubtitleOverlay'

type MessageListener = (message: ExtensionMessage) => void

const messageListeners = new Set<MessageListener>()

function mockRuntimeMessaging(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        onMessage: {
          addListener: (listener: MessageListener) => messageListeners.add(listener),
          removeListener: (listener: MessageListener) => messageListeners.delete(listener),
        },
      },
    },
  })
}

function sendToSubtitleOverlay(message: ExtensionMessage): void {
  for (const listener of messageListeners) {
    listener(message)
  }
}

interface VideoPosition {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

function createVideo(position: VideoPosition = {
  bottom: 620,
  height: 540,
  left: 120,
  right: 1080,
  top: 80,
  width: 960,
}): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'getBoundingClientRect', {
    value: () => position as DOMRect,
  })
  document.body.append(video)
  return video
}

beforeEach(() => {
  mockRuntimeMessaging()
})

afterEach(() => {
  document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)?.remove()
  document.getElementById(VIDEO_SUBTITLE_OVERLAY_STYLE_ID)?.remove()
  document.body.replaceChildren()
  messageListeners.clear()
  Reflect.deleteProperty(globalThis, 'chrome')
})

describe('Given a page with a playing video', () => {
  it('When a completed translation arrives, Then it displays bilingual subtitles at the bottom of the video', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: '你好，世界' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.hidden).toBe(false)
    expect(overlay?.textContent).toContain('Hello world')
    expect(overlay?.textContent).toContain('你好，世界')
  })

  it('When a smaller video is playing, Then it positions subtitles on that video instead of a larger preview', () => {
    createVideo()
    const playingVideo = createVideo({
      bottom: 400,
      height: 270,
      left: 20,
      right: 500,
      top: 130,
      width: 480,
    })
    installVideoSubtitleOverlay()
    playingVideo.dispatchEvent(new Event('playing', { bubbles: true }))

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: '你好，世界' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(Number.parseFloat(overlay?.style.left ?? '')).toBeLessThan(100)
  })

  it('When translation stops, Then it disposes the subtitles and page listeners', () => {
    createVideo()
    installVideoSubtitleOverlay()
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: '你好，世界' },
    })

    sendToSubtitleOverlay({ type: 'DISPOSE_VIDEO_SUBTITLE_OVERLAY' })

    expect(document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)).toBeNull()
    expect(document.getElementById(VIDEO_SUBTITLE_OVERLAY_STYLE_ID)).toBeNull()
    expect(messageListeners.size).toBe(0)
  })

  it('When an older translation arrives after a newer original, Then it keeps the newer subtitle on screen', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'First sentence', translated: null },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 2, original: 'Second sentence', translated: null },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'First sentence', translated: '第一句' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.textContent).toContain('Second sentence')
    expect(overlay?.textContent).not.toContain('第一句')
  })

  it('When an untranslated update arrives after the same segment is translated, Then it keeps the completed subtitle', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'First sentence', translated: '第一句' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'First sentence', translated: null },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.textContent).toContain('第一句')
  })
})

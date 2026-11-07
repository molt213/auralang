import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { waitFor } from '@testing-library/react'

import type { ExtensionMessage } from '../types'
import {
  FLOATING_SUBTITLE_BUTTON_ID,
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
  document.getElementById(FLOATING_SUBTITLE_BUTTON_ID)?.remove()
  document.body.replaceChildren()
  messageListeners.clear()
  Reflect.deleteProperty(globalThis, 'chrome')
  Reflect.deleteProperty(window, 'documentPictureInPicture')
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

  it('When the next chunk continues a settled caption, Then the overlay shows the merged sentence with its translation kept', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: {
        segmentId: 1,
        original: '告知といいますか事前予告を。',
        translated: '算是通知，或者说提前预告吧。',
        translationStatus: 'translated',
      },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: {
        segmentId: 1,
        original: '告知といいますか事前予告をさせて頂ければと思いました。',
        translated: null,
        translationStatus: 'pending',
      },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.textContent).toContain('させて頂ければと思いました')
    expect(overlay?.textContent).toContain('算是通知')
  })

  it('When a late answer for the shorter text arrives after the merge, Then the merged line stays on screen', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: {
        segmentId: 1,
        original: '告知といいますか事前予告をさせて頂ければと思いました。',
        translated: null,
        translationStatus: 'pending',
      },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: {
        segmentId: 1,
        original: '告知といいますか事前予告を。',
        translated: '算是通知，或者说提前预告吧。',
        translationStatus: 'translated',
      },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.textContent).toContain('させて頂ければと思いました')
  })

  it('When a translation fails, Then it hides the overlay instead of presenting the original as a translation', () => {
    createVideo()
    installVideoSubtitleOverlay()
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Failed sentence', translated: null, translationStatus: 'failed' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.hidden).toBe(true)
    expect(overlay?.textContent).toBe('')
  })

  it('When translation stops for the current segment, Then it hides the overlay without showing the original as completed output', () => {
    createVideo()
    installVideoSubtitleOverlay()
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Stopped sentence', translated: null, translationStatus: 'skipped' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.hidden).toBe(true)
    expect(overlay?.textContent).toBe('')
  })

  it('When a translation is still streaming, Then it shows the growing text marked as provisional', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: '你好', translationStatus: 'partial' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(translationLine?.textContent).toBe('你好')
    expect(translationLine?.classList.contains('auralang-video-subtitle-partial')).toBe(true)
    // Announcing every token would make the live region unusable.
    expect(overlay?.getAttribute('aria-live')).toBe('off')
  })

  it('When the settled caption carries the provisional translation, Then it is shown as provisional', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: '还在说', translationStatus: 'pending' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(translationLine?.textContent).toBe('还在说')
    expect(translationLine?.classList.contains('auralang-video-subtitle-partial')).toBe(true)
  })

  it('When the streaming translation settles, Then the line is presented as final again', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: '你好', translationStatus: 'partial' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: '你好，世界', translationStatus: 'translated' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(translationLine?.textContent).toBe('你好，世界')
    expect(translationLine?.classList.contains('auralang-video-subtitle-partial')).toBe(false)
    expect(overlay?.getAttribute('aria-live')).toBe('polite')
  })
})

interface FakeFloatingWindow {
  document: Document
  closed: boolean
  close: () => void
  addEventListener: (type: string, listener: () => void) => void
}

// The overlay only touches document / addEventListener / close on the floating
// window, so a detached document plus those three members is a faithful fake.
function installFakeFloatingApi(): FakeFloatingWindow[] {
  const opened: FakeFloatingWindow[] = []

  Object.defineProperty(window, 'documentPictureInPicture', {
    configurable: true,
    value: {
      requestWindow: async () => {
        const listeners = new Set<() => void>()
        const pipWindow: FakeFloatingWindow = {
          document: document.implementation.createHTMLDocument('floating'),
          closed: false,
          close: () => {
            if (pipWindow.closed) return
            pipWindow.closed = true
            for (const listener of listeners) listener()
          },
          addEventListener: (type, listener) => {
            if (type === 'pagehide') listeners.add(listener)
          },
        }
        opened.push(pipWindow)
        return pipWindow
      },
    },
  })

  return opened
}

describe('Given a browser that offers the floating window', () => {
  it('When the floating-caption button is clicked, Then the captions move into that window', async () => {
    const opened = installFakeFloatingApi()
    createVideo()
    installVideoSubtitleOverlay()
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: '你好，世界' },
    })

    const button = document.getElementById(FLOATING_SUBTITLE_BUTTON_ID)
    expect(button).not.toBeNull()
    button?.click()

    await waitFor(() => expect(opened).toHaveLength(1))
    expect(opened[0]?.document.body.textContent).toContain('Hello world')
    expect(opened[0]?.document.body.textContent).toContain('你好，世界')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
  })

  it('When a caption arrives while the floating window is open, Then the window follows it', async () => {
    const opened = installFakeFloatingApi()
    createVideo()
    installVideoSubtitleOverlay()
    document.getElementById(FLOATING_SUBTITLE_BUTTON_ID)?.click()
    await waitFor(() => expect(opened).toHaveLength(1))

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: '你好，世界' },
    })

    expect(opened[0]?.document.body.textContent).toContain('你好，世界')
  })

  it('When the button is clicked again, Then the floating window closes and the button reports it', async () => {
    const opened = installFakeFloatingApi()
    createVideo()
    installVideoSubtitleOverlay()
    const button = document.getElementById(FLOATING_SUBTITLE_BUTTON_ID)

    button?.click()
    await waitFor(() => expect(button?.getAttribute('aria-pressed')).toBe('true'))

    button?.click()

    expect(opened[0]?.closed).toBe(true)
    expect(button?.getAttribute('aria-pressed')).toBe('false')
  })

  it('When the floating window is closed by the user, Then the button reports the closed state', async () => {
    const opened = installFakeFloatingApi()
    createVideo()
    installVideoSubtitleOverlay()
    const button = document.getElementById(FLOATING_SUBTITLE_BUTTON_ID)

    button?.click()
    await waitFor(() => expect(button?.getAttribute('aria-pressed')).toBe('true'))

    opened[0]?.close()

    expect(button?.getAttribute('aria-pressed')).toBe('false')
  })

  it('When the capture stops, Then the floating window closes and the button disappears', async () => {
    const opened = installFakeFloatingApi()
    createVideo()
    installVideoSubtitleOverlay()
    document.getElementById(FLOATING_SUBTITLE_BUTTON_ID)?.click()
    await waitFor(() => expect(opened).toHaveLength(1))

    sendToSubtitleOverlay({ type: 'DISPOSE_VIDEO_SUBTITLE_OVERLAY' })

    expect(opened[0]?.closed).toBe(true)
    expect(document.getElementById(FLOATING_SUBTITLE_BUTTON_ID)).toBeNull()
  })
})

describe('Given a browser without the floating-window API', () => {
  it('When the overlay is installed, Then no floating-caption button is offered', () => {
    createVideo()
    installVideoSubtitleOverlay()

    expect(document.getElementById(FLOATING_SUBTITLE_BUTTON_ID)).toBeNull()
  })
})

describe('Given speech that has not settled yet', () => {
  it('When a preview of the next utterance arrives mid-translation, Then the streaming line stays on screen', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'First sentence', translated: '第一', translationStatus: 'partial' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 2, original: 'Second sentence', translated: '第二句', translationStatus: 'preview' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.textContent).toContain('第一')
    expect(overlay?.textContent).not.toContain('第二句')
  })

  it('When that translation settles, Then the newer preview takes the screen', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'First sentence', translated: '第一', translationStatus: 'partial' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 2, original: 'Second sentence', translated: '第二句', translationStatus: 'preview' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'First sentence', translated: '第一句话', translationStatus: 'translated' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.textContent).toContain('第二句')
  })

  it('When a dropped chunk retracts its preview, Then the last settled translation comes back', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'First sentence', translated: '第一句话', translationStatus: 'translated' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 2, original: 'Second sentence', translated: '第二句', translationStatus: 'preview' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 2, original: '', translated: null, translationStatus: 'cleared' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    expect(overlay?.textContent).toContain('第一句话')
    expect(overlay?.textContent).not.toContain('第二句')
  })

  it('When the preview translation arrives after the settled caption, Then the line fills in instead of showing the original', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: null, translationStatus: 'pending' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している', translated: '还在说', translationStatus: 'preview' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(translationLine?.textContent).toBe('还在说')
    expect(translationLine?.classList.contains('auralang-video-subtitle-partial')).toBe(true)
  })

  it('When the settled caption arrives after the preview translation, Then it keeps showing that translation', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している', translated: '还在说', translationStatus: 'preview' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: null, translationStatus: 'pending' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(translationLine?.textContent).toBe('还在说')
  })

  it('When the stream starts with a short token, Then the provisional line stays on screen', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: '还在说', translationStatus: 'pending' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: '还', translationStatus: 'partial' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(translationLine?.textContent).toBe('还在说')
  })

  it('When the stream reaches a phrase, Then it replaces the provisional line', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: '还在说', translationStatus: 'pending' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: '还在说话呢，', translationStatus: 'partial' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(translationLine?.textContent).toBe('还在说话呢，')
    expect(translationLine?.classList.contains('auralang-video-subtitle-partial')).toBe(true)
  })

  it('When the LLM request fails, Then the provisional translation remains visible', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: '还在说', translationStatus: 'pending' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: null, translationStatus: 'failed' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(overlay?.hidden).toBe(false)
    expect(translationLine?.textContent).toBe('还在说')
    expect(translationLine?.classList.contains('auralang-video-subtitle-partial')).toBe(false)
  })

  it('When the LLM request is skipped, Then the provisional translation remains visible', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: '还在说', translationStatus: 'pending' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: null, translationStatus: 'skipped' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(overlay?.hidden).toBe(false)
    expect(translationLine?.textContent).toBe('还在说')
  })

  it('When a preview translation lands after a failed caption with no text, Then it fills the line', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している途中です', translated: null, translationStatus: 'failed' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'まだ話している', translated: '还在说', translationStatus: 'preview' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(overlay?.hidden).toBe(false)
    expect(translationLine?.textContent).toBe('还在说')
    expect(translationLine?.classList.contains('auralang-video-subtitle-partial')).toBe(false)
  })

  it('When a failure arrives after a completed translation, Then the completed line is kept', () => {
    createVideo()
    installVideoSubtitleOverlay()

    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: '你好，世界', translationStatus: 'translated' },
    })
    sendToSubtitleOverlay({
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: { segmentId: 1, original: 'Hello world', translated: null, translationStatus: 'failed' },
    })

    const overlay = document.getElementById(VIDEO_SUBTITLE_OVERLAY_ID)
    const translationLine = overlay?.querySelector('.auralang-video-subtitle-translation')
    expect(translationLine?.textContent).toBe('你好，世界')
    expect(translationLine?.classList.contains('auralang-video-subtitle-partial')).toBe(false)
  })
})

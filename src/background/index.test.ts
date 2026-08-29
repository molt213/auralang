import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import type { ExtensionMessage, TranscriptUpdatePayload } from '../types'
import { CAPTURED_TAB_ID_KEY, CAPTURE_STATE_KEY } from './captureSessionService'

type MessageListener = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void
type SessionGet = (keys: string[]) => Promise<Record<string, unknown>>
type TabSendMessage = (tabId: number, message: unknown) => Promise<unknown>

let messageListener: MessageListener | null = null

const sessionGet = jest.fn<SessionGet>()
const tabSendMessage = jest.fn<TabSendMessage>()

function mockBackgroundChrome(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      action: { onClicked: { addListener: () => undefined } },
      offscreen: { createDocument: () => Promise.resolve() },
      runtime: {
        getURL: (path: string) => `chrome-extension://auralang/${path}`,
        getContexts: () => Promise.resolve([]),
        onInstalled: { addListener: () => undefined },
        onMessage: { addListener: (listener: MessageListener) => { messageListener = listener } },
        onStartup: { addListener: () => undefined },
        sendMessage: () => Promise.resolve({ success: true }),
      },
      sidePanel: {
        open: () => Promise.resolve(),
        setOptions: () => Promise.resolve(),
      },
      storage: {
        session: {
          get: sessionGet,
          remove: () => Promise.resolve(),
          set: () => Promise.resolve(),
        },
      },
      tabCapture: { getMediaStreamId: () => undefined },
      tabs: {
        onRemoved: { addListener: () => undefined },
        query: () => undefined,
        sendMessage: tabSendMessage,
      },
    },
  })
}

beforeEach(() => {
  messageListener = null
  sessionGet.mockReset()
  tabSendMessage.mockReset()
  sessionGet.mockResolvedValue({
    [CAPTURE_STATE_KEY]: true,
    [CAPTURED_TAB_ID_KEY]: 42,
  })
  tabSendMessage.mockResolvedValue(undefined)
  mockBackgroundChrome()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'chrome')
})

describe('Given a restarted service worker with an active capture session', () => {
  it('When a transcript update arrives, Then it forwards the subtitle to the restored tab', async () => {
    await import('./index')
    if (!messageListener) throw new Error('The background message listener was not registered')

    const transcript: TranscriptUpdatePayload = {
      segmentId: 1,
      original: 'Hello world',
      translated: '你好，世界',
    }

    messageListener(
      { type: 'TRANSCRIPT_UPDATE', payload: transcript },
      {} as chrome.runtime.MessageSender,
      () => undefined,
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(sessionGet).toHaveBeenCalledWith([CAPTURE_STATE_KEY, CAPTURED_TAB_ID_KEY])
    expect(tabSendMessage).toHaveBeenCalledWith(42, {
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: transcript,
    })
  })
})

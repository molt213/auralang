import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'

import { installFloatingPanel } from '../content/floatingPanel'
import type { ExtensionMessage, TranscriptUpdatePayload } from '../types'
import {
  CAPTURED_TAB_ID_KEY,
  CAPTURE_STATE_KEY,
  LATEST_SEGMENT_ID_KEY,
} from './captureSessionService'

type MessageListener = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void
type SessionGet = (keys: string[]) => Promise<Record<string, unknown>>
type TabSendMessage = (tabId: number, message: unknown) => Promise<unknown>

let messageListener: MessageListener | null = null
let actionClickListener: ((tab: chrome.tabs.Tab) => void) | null = null

const sessionGet = jest.fn<SessionGet>()
const sessionRemove = jest.fn<(keys: string[]) => Promise<unknown>>()
const tabSendMessage = jest.fn<TabSendMessage>()
const executeScript = jest.fn<(details: unknown) => Promise<unknown>>()
let streamCapturing = true

function mockBackgroundChrome(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      action: {
        onClicked: {
          addListener: (listener: (tab: chrome.tabs.Tab) => void) => { actionClickListener = listener },
        },
        setBadgeBackgroundColor: () => Promise.resolve(),
        setBadgeText: () => Promise.resolve(),
      },
      offscreen: { createDocument: () => Promise.resolve() },
      runtime: {
        getURL: (path: string) => `chrome-extension://auralang/${path}`,
        getContexts: () => Promise.resolve([]),
        onInstalled: { addListener: () => undefined },
        onMessage: { addListener: (listener: MessageListener) => { messageListener = listener } },
        onStartup: { addListener: () => undefined },
        sendMessage: (message: { type?: string }, callback?: (response: unknown) => void) => {
          const response = message?.type === 'GET_STREAM_STATE'
            ? { capturing: streamCapturing }
            : { success: true }
          if (typeof callback === 'function') {
            callback(response)
            return undefined
          }
          return Promise.resolve(response)
        },
      },
      scripting: { executeScript },
      storage: {
        session: {
          get: sessionGet,
          remove: sessionRemove,
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

beforeAll(async () => {
  mockBackgroundChrome()
  await import('./index')
})

beforeEach(() => {
  sessionGet.mockReset()
  sessionRemove.mockReset()
  sessionRemove.mockResolvedValue(undefined)
  streamCapturing = true
  tabSendMessage.mockReset()
  executeScript.mockReset()
  executeScript.mockResolvedValue([])
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

    expect(sessionGet).toHaveBeenCalledWith([
      CAPTURE_STATE_KEY,
      CAPTURED_TAB_ID_KEY,
      LATEST_SEGMENT_ID_KEY,
    ])
    expect(tabSendMessage).toHaveBeenCalledWith(42, {
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: transcript,
    })

    let captureState: unknown
    messageListener(
      { type: 'GET_CAPTURE_STATE' },
      {} as chrome.runtime.MessageSender,
      (response) => { captureState = response },
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(captureState).toEqual({ active: true, latestSegmentId: 1 })
  })

  it('When the offscreen document is no longer capturing, Then the stale session is cleared', async () => {
    if (!messageListener) throw new Error('The background message listener was not registered')
    streamCapturing = false

    let captureState: unknown
    messageListener(
      { type: 'GET_CAPTURE_STATE' },
      {} as chrome.runtime.MessageSender,
      (response) => { captureState = response },
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(captureState).toEqual({ active: false, latestSegmentId: 0 })
    expect(sessionRemove).toHaveBeenCalledWith([
      CAPTURE_STATE_KEY,
      CAPTURED_TAB_ID_KEY,
      LATEST_SEGMENT_ID_KEY,
    ])
  })

  it('When the toolbar icon is clicked, Then the floating panel is injected into that tab', async () => {
    if (!actionClickListener) throw new Error('The background action listener was not registered')

    actionClickListener({ id: 42 } as chrome.tabs.Tab)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      func: installFloatingPanel,
    })
  })
})

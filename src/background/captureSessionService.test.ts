import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import {
  CAPTURED_TAB_ID_KEY,
  CAPTURE_STATE_KEY,
  LATEST_SEGMENT_ID_KEY,
  clearCaptureSession,
  loadCaptureSession,
  saveCaptureSession,
} from './captureSessionService'

type StorageGet = (keys: string[]) => Promise<Record<string, unknown>>
type StorageSet = (values: Record<string, unknown>) => Promise<void>
type StorageRemove = (keys: string[]) => Promise<void>

const get = jest.fn<StorageGet>()
const set = jest.fn<StorageSet>()
const remove = jest.fn<StorageRemove>()

function mockChromeStorage(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        session: { get, set, remove },
      },
    },
  })
}

beforeEach(() => {
  get.mockReset()
  set.mockReset()
  remove.mockReset()
  get.mockResolvedValue({})
  set.mockResolvedValue(undefined)
  remove.mockResolvedValue(undefined)
  mockChromeStorage()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'chrome')
})

describe('Given an active tab capture', () => {
  it('When capture starts, Then it persists the active state, tab ID, and latest segment ID', async () => {
    await saveCaptureSession(42, 7)

    expect(set).toHaveBeenCalledWith({
      [CAPTURE_STATE_KEY]: true,
      [CAPTURED_TAB_ID_KEY]: 42,
      [LATEST_SEGMENT_ID_KEY]: 7,
    })
  })

  it('When a service worker restores the capture state, Then it recovers the captured tab ID and latest segment ID', async () => {
    get.mockResolvedValue({
      [CAPTURE_STATE_KEY]: true,
      [CAPTURED_TAB_ID_KEY]: 42,
      [LATEST_SEGMENT_ID_KEY]: 7,
    })

    await expect(loadCaptureSession()).resolves.toEqual({ active: true, tabId: 42, latestSegmentId: 7 })
  })

  it('When an older capture state has no latest segment ID, Then it treats the latest segment as zero', async () => {
    get.mockResolvedValue({
      [CAPTURE_STATE_KEY]: true,
      [CAPTURED_TAB_ID_KEY]: 42,
    })

    await expect(loadCaptureSession()).resolves.toEqual({ active: true, tabId: 42, latestSegmentId: 0 })
  })

  it('When capture stops, Then it clears the active state, tab ID, and latest segment ID', async () => {
    await clearCaptureSession()

    expect(remove).toHaveBeenCalledWith([
      CAPTURE_STATE_KEY,
      CAPTURED_TAB_ID_KEY,
      LATEST_SEGMENT_ID_KEY,
    ])
  })
})

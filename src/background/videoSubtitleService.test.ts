import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import type { TranscriptUpdatePayload } from '../types'
import { installVideoSubtitleOverlay } from '../content/videoSubtitleOverlay'
import {
  disposeVideoSubtitleOverlay,
  ensureVideoSubtitleOverlay,
  updateVideoSubtitles,
} from './videoSubtitleService'

type ExecuteScript = (options: { target: { tabId: number }; func: () => void }) => Promise<unknown>
type SendMessage = (tabId: number, message: unknown) => Promise<unknown>

const executeScript = jest.fn<ExecuteScript>()
const sendMessage = jest.fn<SendMessage>()

function mockChrome(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      scripting: { executeScript },
      tabs: { sendMessage },
    },
  })
}

beforeEach(() => {
  executeScript.mockReset()
  sendMessage.mockReset()
  executeScript.mockResolvedValue([])
  sendMessage.mockResolvedValue(undefined)
  mockChrome()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'chrome')
})

describe('Given the active tab is being translated', () => {
  it('When translation starts, Then it installs the video subtitle overlay in that tab', async () => {
    await ensureVideoSubtitleOverlay(42)

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      func: installVideoSubtitleOverlay,
    })
  })

  it('When a translated transcript arrives, Then it forwards the update to that tab', async () => {
    const transcript: TranscriptUpdatePayload = {
      original: 'Hello world',
      translated: '你好，世界',
    }

    await updateVideoSubtitles(42, transcript)

    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: 'VIDEO_SUBTITLE_UPDATE',
      payload: transcript,
    })
  })

  it('When translation stops, Then it tells that tab to dispose the subtitles', async () => {
    await disposeVideoSubtitleOverlay(42)

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'DISPOSE_VIDEO_SUBTITLE_OVERLAY' })
  })
})

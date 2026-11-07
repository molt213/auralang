import { describe, expect, it } from '@jest/globals'

import {
  BALANCED_TIER,
  DOLPHIN_TIER,
  LIGHT_TIER,
  tierForMode,
} from './registry'

describe('Given the ASR tier registry', () => {
  it('When the user selects Dolphin, Then it resolves to the sherpa-onnx tier', () => {
    const tier = tierForMode('dolphin')

    expect(tier).toBe(DOLPHIN_TIER)
    expect(tier.engine).toBe('sherpa-dolphin')
    expect(DOLPHIN_TIER.approxDownloadMB).toBe(250)
  })

  it('When the user selects a whisper tier, Then it stays on the transformers engine', () => {
    expect(tierForMode('light')).toBe(LIGHT_TIER)
    expect(LIGHT_TIER.engine).toBe('transformers')
    expect(tierForMode('balanced')).toBe(BALANCED_TIER)
    expect(BALANCED_TIER.engine).toBe('transformers')
  })

  it('When the mode is auto on an unknown device, Then it falls back to the light tier', () => {
    expect(tierForMode('auto')).toBe(LIGHT_TIER)
  })
})

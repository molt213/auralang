import { describe, expect, it } from '@jest/globals'

import { upsertTranscriptUpdate } from './transcriptUpdates'
import type { TranscriptUpdatePayload } from '../../types'

describe('Given a live transcript with a newer segment already visible', () => {
  it('When a translation update identifies an earlier segment, Then it updates that matching row without replacing the newer row', () => {
    const current: TranscriptUpdatePayload[] = [
      { segmentId: 11, original: 'First sentence', translated: null },
      { segmentId: 12, original: 'Second sentence', translated: null },
    ]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 11,
      original: 'First sentence',
      translated: '第一句',
    })

    expect(next).toEqual([
      { segmentId: 11, original: 'First sentence', translated: '第一句' },
      { segmentId: 12, original: 'Second sentence', translated: null },
    ])
  })

  it('When an untranslated update arrives after its translated update, Then it keeps the completed translation', () => {
    const current: TranscriptUpdatePayload[] = [
      { segmentId: 11, original: 'First sentence', translated: '第一句' },
    ]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 11,
      original: 'First sentence',
      translated: null,
    })

    expect(next).toEqual(current)
  })
})

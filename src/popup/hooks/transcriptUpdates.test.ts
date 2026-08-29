import { describe, expect, it } from '@jest/globals'

import { shouldSpeakTranslation, upsertTranscriptUpdate } from './transcriptUpdates'
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

  it('When a translation fails after the original line is shown, Then it replaces the pending state with a terminal failure', () => {
    const current: TranscriptUpdatePayload[] = [
      { segmentId: 11, original: 'First sentence', translated: null },
    ]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 11,
      original: 'First sentence',
      translated: null,
      translationStatus: 'failed',
    })

    expect(next).toEqual([{
      segmentId: 11,
      original: 'First sentence',
      translated: null,
      translationStatus: 'failed',
    }])
  })

  it('When a late pending update follows a stopped translation, Then it keeps the terminal state', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 11,
      original: 'First sentence',
      translated: null,
      translationStatus: 'skipped',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 11,
      original: 'First sentence',
      translated: null,
      translationStatus: 'pending',
    })

    expect(next).toEqual(current)
  })

  it('When an older segment is completed after a newer segment is already visible, Then it keeps the transcript in segment order', () => {
    const current: TranscriptUpdatePayload[] = [
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

  it('When an older translation completes after a newer segment is known, Then it keeps that backfill silent', () => {
    expect(shouldSpeakTranslation(
      { segmentId: 11, original: 'First sentence', translated: '第一句' },
      12,
      true,
    )).toBe(false)
    expect(shouldSpeakTranslation(
      { segmentId: 12, original: 'Second sentence', translated: '第二句' },
      12,
      true,
    )).toBe(true)
  })

  it('When the side panel has not learned the current capture state yet, Then it keeps a completed translation silent', () => {
    expect(shouldSpeakTranslation(
      { segmentId: 12, original: 'Second sentence', translated: '第二句' },
      12,
      false,
    )).toBe(false)
  })
})

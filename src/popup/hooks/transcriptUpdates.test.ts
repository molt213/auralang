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

  it('When a translation streams in, Then each partial replaces the previous one', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 11,
      original: 'First sentence',
      translated: null,
      translationStatus: 'pending',
    }]

    const first = upsertTranscriptUpdate(current, {
      segmentId: 11,
      original: 'First sentence',
      translated: '第一',
      translationStatus: 'partial',
    })
    const second = upsertTranscriptUpdate(first, {
      segmentId: 11,
      original: 'First sentence',
      translated: '第一句',
      translationStatus: 'partial',
    })
    const settled = upsertTranscriptUpdate(second, {
      segmentId: 11,
      original: 'First sentence',
      translated: '第一句话',
      translationStatus: 'translated',
    })

    expect(settled).toEqual([{
      segmentId: 11,
      original: 'First sentence',
      translated: '第一句话',
      translationStatus: 'translated',
    }])
  })

  it('When a stale partial arrives after the translation settled, Then it keeps the settled translation', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 11,
      original: 'First sentence',
      translated: '第一句话',
      translationStatus: 'translated',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 11,
      original: 'First sentence',
      translated: '第一句',
      translationStatus: 'partial',
    })

    expect(next).toEqual(current)
  })

  it('When a preview is replaced by the settled caption, Then the row follows the final text', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している',
      translated: '还在说',
      translationStatus: 'preview',
    }]

    const pending = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: null,
      translationStatus: 'pending',
    })
    const settled = upsertTranscriptUpdate(pending, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '话还没说完',
      translationStatus: 'translated',
    })

    expect(settled).toEqual([{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '话还没说完',
      translationStatus: 'translated',
    }])
  })

  it('When a late preview follows the settled caption of the same segment, Then it keeps the settled caption', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'First sentence',
      translated: '第一句话',
      translationStatus: 'translated',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'First sentence',
      translated: '第一',
      translationStatus: 'preview',
    })

    expect(next).toEqual(current)
  })

  it('When a dropped chunk retracts its preview, Then the provisional row disappears', () => {
    const current: TranscriptUpdatePayload[] = [
      { segmentId: 11, original: 'First sentence', translated: '第一句话', translationStatus: 'translated' },
      { segmentId: 12, original: 'Second sentence', translated: '第二句', translationStatus: 'preview' },
    ]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: '',
      translated: null,
      translationStatus: 'cleared',
    })

    expect(next).toEqual([
      { segmentId: 11, original: 'First sentence', translated: '第一句话', translationStatus: 'translated' },
    ])
  })

  it('When a retraction arrives for a segment that never previewed, Then the transcript is untouched', () => {
    const current: TranscriptUpdatePayload[] = [
      { segmentId: 11, original: 'First sentence', translated: '第一句话', translationStatus: 'translated' },
    ]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: '',
      translated: null,
      translationStatus: 'cleared',
    })

    expect(next).toEqual(current)
  })

  it('When the settled caption arrives while the provisional translation is showing, Then it carries that translation over', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している',
      translated: '还在说',
      translationStatus: 'preview',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: null,
      translationStatus: 'pending',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'pending',
    }])
  })

  it('When the provisional translation lands after the caption settled, Then the settled row takes it', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: null,
      translationStatus: 'pending',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している',
      translated: '还在说',
      translationStatus: 'preview',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'pending',
    }])
  })

  it('When the provisional translation grows after the caption settled, Then the pending row follows it', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在',
      translationStatus: 'pending',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している',
      translated: '还在说',
      translationStatus: 'preview',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'pending',
    }])
  })

  it('When the real translation is already streaming, Then a late preview does not overwrite it', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '话还没说完',
      translationStatus: 'partial',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している',
      translated: '还在说',
      translationStatus: 'preview',
    })

    expect(next).toEqual(current)
  })

  it('When the stream starts with a short token, Then the provisional line stays instead of shrinking', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'pending',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还',
      translationStatus: 'partial',
    })

    expect(next).toEqual(current)
  })

  it('When the stream reaches a phrase, Then it replaces the provisional line and keeps streaming', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'pending',
    }]

    const first = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说话呢，',
      translationStatus: 'partial',
    })
    const second = upsertTranscriptUpdate(first, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说话呢，马上',
      translationStatus: 'partial',
    })

    expect(second).toEqual([{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说话呢，马上',
      translationStatus: 'partial',
    }])
  })

  it('When a streaming update arrives without text, Then it does not blank the row', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说话呢',
      translationStatus: 'partial',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '',
      translationStatus: 'partial',
    })

    expect(next).toEqual(current)
  })

  it('When the LLM request fails, Then the provisional translation stays on the row', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'pending',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: null,
      translationStatus: 'failed',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'failed',
    }])
  })

  it('When the LLM request is skipped, Then the provisional translation stays on the row', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'pending',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: null,
      translationStatus: 'skipped',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'skipped',
    }])
  })

  it('When a preview translation lands after a failed row with no text, Then the row shows it without losing the failure', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: null,
      translationStatus: 'failed',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している',
      translated: '还在说',
      translationStatus: 'preview',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'failed',
    }])
  })

  it('When a failure arrives after a completed translation, Then the completed line is kept', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '话还没说完',
      translationStatus: 'translated',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: null,
      translationStatus: 'failed',
    })

    expect(next).toEqual(current)
  })

  it('When the real translation arrives, Then it replaces the carried provisional one', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '还在说',
      translationStatus: 'pending',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '话还没说完',
      translationStatus: 'translated',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: 'まだ話している途中です',
      translated: '话还没说完',
      translationStatus: 'translated',
    }])
  })
})

describe('Given a settled line that the next chunk extends into one sentence', () => {
  const settled: TranscriptUpdatePayload = {
    segmentId: 12,
    original: '告知といいますか事前予告を。',
    translated: '算是通知，或者说提前预告吧。',
    translationStatus: 'translated',
  }

  it('When the continuation arrives, Then the line grows and returns to pending with its translation kept', () => {
    const next = upsertTranscriptUpdate([settled], {
      segmentId: 12,
      original: '告知といいますか事前予告をさせて頂ければと思いました。',
      translated: null,
      translationStatus: 'pending',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: '告知といいますか事前予告をさせて頂ければと思いました。',
      translated: '算是通知，或者说提前预告吧。',
      translationStatus: 'pending',
    }])
  })

  it('When the merged translation streams, Then it replaces the translation of the shorter sentence', () => {
    const amended = upsertTranscriptUpdate([settled], {
      segmentId: 12,
      original: '告知といいますか事前予告をさせて頂ければと思いました。',
      translated: null,
      translationStatus: 'pending',
    })

    const next = upsertTranscriptUpdate(amended, {
      segmentId: 12,
      original: '告知といいますか事前予告をさせて頂ければと思いました。',
      translated: '算是通知吧，我想请您允许我事先预告一下。',
      translationStatus: 'partial',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: '告知といいますか事前予告をさせて頂ければと思いました。',
      translated: '算是通知吧，我想请您允许我事先预告一下。',
      translationStatus: 'partial',
    }])
  })

  it('When a late answer for the shorter text arrives, Then the merged line is kept', () => {
    const amended: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: '告知といいますか事前予告をさせて頂ければと思いました。',
      translated: null,
      translationStatus: 'pending',
    }]

    const next = upsertTranscriptUpdate(amended, {
      segmentId: 12,
      original: '告知といいますか事前予告を。',
      translated: '算是通知，或者说提前预告吧。',
      translationStatus: 'translated',
    })

    expect(next).toEqual(amended)
  })

  it('When a shorter settled caption replaces a longer preview, Then the row follows the settled text', () => {
    const current: TranscriptUpdatePayload[] = [{
      segmentId: 12,
      original: 'まだ話している途中ですね',
      translated: '还在说话呢',
      translationStatus: 'preview',
    }]

    const next = upsertTranscriptUpdate(current, {
      segmentId: 12,
      original: 'まだ話している',
      translated: null,
      translationStatus: 'pending',
    })

    expect(next).toEqual([{
      segmentId: 12,
      original: 'まだ話している',
      translated: '还在说话呢',
      translationStatus: 'pending',
    }])
  })
})

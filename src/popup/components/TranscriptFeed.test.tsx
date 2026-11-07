import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react'

import { TranscriptFeed } from './TranscriptFeed'

describe('Given older and newer live-caption segments awaiting translation', () => {
  it('When both rows have no translation yet, Then both rows clearly show that translation is pending', () => {
    render(
      <TranscriptFeed
        transcripts={[
          { segmentId: 1, original: 'First sentence', translated: null },
          { segmentId: 2, original: 'Second sentence', translated: null },
        ]}
        translatingLabel="Translating"
        translationFailedLabel="Translation unavailable"
        translationSkippedLabel="Translation stopped"
      />,
    )

    expect(screen.getByText('First sentence')).toBeTruthy()
    expect(screen.getByText('Second sentence')).toBeTruthy()
    expect(screen.getAllByText('Translating')).toHaveLength(2)
  })

  it('When a row has a terminal translation status, Then it shows the matching status instead of loading forever', () => {
    render(
      <TranscriptFeed
        transcripts={[
          { segmentId: 1, original: 'Failed sentence', translated: null, translationStatus: 'failed' },
          { segmentId: 2, original: 'Stopped sentence', translated: null, translationStatus: 'skipped' },
        ]}
        translatingLabel="Translating"
        translationFailedLabel="Translation unavailable"
        translationSkippedLabel="Translation stopped"
      />,
    )

    expect(screen.getByText('Translation unavailable')).toBeTruthy()
    expect(screen.getByText('Translation stopped')).toBeTruthy()
    expect(screen.queryByText('Translating')).toBeNull()
  })
})

describe('Given a failed LLM request with a provisional translation', () => {
  it('When the row is rendered, Then it keeps the translation and marks it as failed', () => {
    render(
      <TranscriptFeed
        transcripts={[
          {
            segmentId: 1,
            original: 'まだ話している途中です',
            translated: '还在说',
            translationStatus: 'failed',
          },
        ]}
        translatingLabel="Translating"
        translationFailedLabel="Translation unavailable"
        translationSkippedLabel="Translation stopped"
      />,
    )

    expect(screen.getByText('还在说')).toBeTruthy()
    expect(screen.getByLabelText('Translation unavailable')).toBeTruthy()
  })
})

describe('Given a translation that is still streaming in', () => {
  it('When a partial translation arrives, Then the row grows with the text instead of showing the loading label', () => {
    render(
      <TranscriptFeed
        transcripts={[
          { segmentId: 1, original: 'Hello world', translated: '你好', translationStatus: 'partial' },
        ]}
        translatingLabel="Translating"
        translationFailedLabel="Translation unavailable"
        translationSkippedLabel="Translation stopped"
      />,
    )

    const row = screen.getByText('Hello world').parentElement
    expect(row?.textContent).toContain('你好')
    expect(screen.queryByText('Translating')).toBeNull()
  })
})

describe('Given speech that has not settled yet', () => {
  it('When a preview row is shown, Then it reads as provisional instead of as a final translation', () => {
    render(
      <TranscriptFeed
        transcripts={[
          { segmentId: 1, original: 'まだ話している', translated: '还在说', translationStatus: 'preview' },
        ]}
        translatingLabel="Translating"
        translationFailedLabel="Translation unavailable"
        translationSkippedLabel="Translation stopped"
      />,
    )

    const row = screen.getByText('まだ話している').parentElement
    expect(row?.textContent).toContain('还在说')
    expect(screen.queryByText('Translating')).toBeNull()
  })

  it('When the settled caption still carries the preview translation, Then the row keeps showing it', () => {
    render(
      <TranscriptFeed
        transcripts={[
          {
            segmentId: 1,
            original: 'まだ話している途中です',
            translated: '还在说',
            translationStatus: 'pending',
          },
        ]}
        translatingLabel="Translating"
        translationFailedLabel="Translation unavailable"
        translationSkippedLabel="Translation stopped"
      />,
    )

    const row = screen.getByText('まだ話している途中です').parentElement
    expect(row?.textContent).toContain('还在说')
    expect(screen.queryByText('Translating')).toBeNull()
  })

  it('When a preview has no translation yet, Then the row does not repeat the original as if it were one', () => {
    render(
      <TranscriptFeed
        transcripts={[
          { segmentId: 1, original: 'まだ話している', translated: null, translationStatus: 'preview' },
        ]}
        translatingLabel="Translating"
        translationFailedLabel="Translation unavailable"
        translationSkippedLabel="Translation stopped"
      />,
    )

    const row = screen.getByText('まだ話している').parentElement
    expect(row?.textContent).toBe('まだ話している···')
  })
})

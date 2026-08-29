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
        speakingOriginal={null}
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
        speakingOriginal={null}
      />,
    )

    expect(screen.getByText('Translation unavailable')).toBeTruthy()
    expect(screen.getByText('Translation stopped')).toBeTruthy()
    expect(screen.queryByText('Translating')).toBeNull()
  })
})

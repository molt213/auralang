import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react'

import { TranscriptFeed } from './TranscriptFeed'

describe('Given an older live-caption segment that was superseded by a newer one', () => {
  it('When both rows have no translation yet, Then only the newest row shows that translation is pending', () => {
    render(
      <TranscriptFeed
        transcripts={[
          { segmentId: 1, original: 'First sentence', translated: null },
          { segmentId: 2, original: 'Second sentence', translated: null },
        ]}
        translatingLabel="Translating"
        speakingOriginal={null}
      />,
    )

    expect(screen.getByText('First sentence')).toBeTruthy()
    expect(screen.getByText('Second sentence')).toBeTruthy()
    expect(screen.getAllByText('Translating')).toHaveLength(1)
  })
})

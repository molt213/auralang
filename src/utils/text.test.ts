import {
  collapseRepeats,
  isRepetitionHallucination,
  isSilenceHallucination,
  stripSeamRepeat,
} from './text'

describe('isSilenceHallucination', () => {
  it('matches known fillers regardless of case and punctuation', () => {
    expect(isSilenceHallucination('you')).toBe(true)
    expect(isSilenceHallucination('You.')).toBe(true)
    expect(isSilenceHallucination('Thank you.')).toBe(true)
    expect(isSilenceHallucination('Thanks for watching!')).toBe(true)
  })

  it('never matches real sentences containing those words', () => {
    expect(isSilenceHallucination('you are here')).toBe(false)
    expect(isSilenceHallucination('thank you for the coffee')).toBe(false)
    expect(isSilenceHallucination("I'm gonna go get some of that.")).toBe(false)
  })

  it('does not match empty text', () => {
    expect(isSilenceHallucination('')).toBe(false)
  })
})

describe('stripSeamRepeat', () => {
  it('drops a single word repeated across the seam', () => {
    expect(stripSeamRepeat('creo que sí', 'sí y además')).toBe('y además')
  })

  it('drops a multi-word overlap, longest match first', () => {
    expect(stripSeamRepeat('vamos a ver qué pasa', 'qué pasa con esto')).toBe('con esto')
  })

  it('ignores case and punctuation at the seam', () => {
    expect(stripSeamRepeat('creo que sí.', 'Sí, y además')).toBe('y además')
  })

  it('leaves text untouched when there is no overlap', () => {
    expect(stripSeamRepeat('hola mundo', 'adiós a todos')).toBe('adiós a todos')
  })

  it('returns empty when the whole chunk is a repeat of the tail', () => {
    expect(stripSeamRepeat('gracias por venir tu', 'tu')).toBe('')
  })

  it('passes text through when there is no previous chunk', () => {
    expect(stripSeamRepeat('', 'hola mundo')).toBe('hola mundo')
  })
})

describe('collapseRepeats', () => {
  it('collapses a stutter run of 3+ identical words to one', () => {
    expect(collapseRepeats('tu tu tu tu')).toBe('tu')
    expect(collapseRepeats('gracias por venir tu tu tu')).toBe('gracias por venir tu')
  })

  it('leaves legitimate doubles untouched', () => {
    expect(collapseRepeats('no no puede ser')).toBe('no no puede ser')
    expect(collapseRepeats('muy muy bien')).toBe('muy muy bien')
  })

  it('ignores case and punctuation when matching', () => {
    expect(collapseRepeats('Tu, tu. TU tu')).toBe('Tu,')
  })

  it('collapses only the repeated run, keeping the rest intact', () => {
    expect(collapseRepeats('hola hola hola mundo adiós')).toBe('hola mundo adiós')
  })

  it('returns normal text unchanged', () => {
    expect(collapseRepeats('el código no es perfecto')).toBe('el código no es perfecto')
    expect(collapseRepeats('')).toBe('')
  })
})

describe('isRepetitionHallucination', () => {
  it('Given a Japanese result with one leading phrase followed by a looping suffix, When it is checked, Then it is treated as a hallucination', () => {
    expect(isRepetitionHallucination(`この子供${'の子供'.repeat(80)}`)).toBe(true)
  })

  it('Given a looping Japanese phrase with a partial final repetition, When it is checked, Then it is still treated as a hallucination', () => {
    expect(isRepetitionHallucination(`この子供${'の子供'.repeat(80)}の`)).toBe(true)
  })

  it('Given a short lead-in followed by enough looping Japanese text, When it is checked, Then it is filtered before it grows into a backlog', () => {
    expect(isRepetitionHallucination(`この子供${'の子供'.repeat(8)}`)).toBe(true)
  })

  it('Given an ASR result that moves between repeated Japanese syllable loops, When it is checked, Then it is still treated as a hallucination', () => {
    const text = `さあなこの全ていいねおけるけい${'ろい'.repeat(80)}${'ろいろ'.repeat(40)}${'ろ'.repeat(80)}`

    expect(isRepetitionHallucination(text)).toBe(true)
  })

  it('Given a long normal lead-in followed by a looping syllable run, When it is checked, Then the late loop is still treated as a hallucination', () => {
    const leadIn =
      '今日は新しい動画の内容を確認しながら、配信者が話している設定と進行の流れを一つずつ丁寧に説明しています。視聴者からの質問にも順番に答えて、次の場面へ進む準備をしています。'

    expect(isRepetitionHallucination(`${leadIn}${'ろ'.repeat(24)}`)).toBe(true)
  })

  it('Given normal Japanese speech or a short natural repetition, When it is checked, Then it remains translatable', () => {
    expect(
      isRepetitionHallucination(
        'この子供は昨日、公園で遊んでから家に帰りました。週末は新しい本を読んで、家族と夕食を楽しむ予定です。',
      ),
    ).toBe(false)
    expect(isRepetitionHallucination('はいはい、分かりました。')).toBe(false)
  })
})

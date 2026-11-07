import {
  collapseRepeats,
  hasUnfinishedEnding,
  isPunctuationOnly,
  isRepetitionHallucination,
  isSilenceHallucination,
  isWrongLanguageOutput,
  joinMidSentenceText,
  stripSeamRepeat,
} from './text'

describe('isWrongLanguageOutput', () => {
  it('Given a Japanese stream, When the decode comes out in Hangul, Then it is treated as a language miss', () => {
    expect(isWrongLanguageOutput('다', 'ja')).toBe(true)
    expect(isWrongLanguageOutput('안녕하세요', 'ja')).toBe(true)
    expect(isWrongLanguageOutput('日本語のあとに 다 섞임', 'ja')).toBe(true)
  })

  it('Given a Japanese stream, When the decode is kana or kanji, Then it is kept', () => {
    expect(isWrongLanguageOutput('うちの中学は弁当制で。', 'ja')).toBe(false)
    expect(isWrongLanguageOutput('はい。', 'ja')).toBe(false)
    expect(isWrongLanguageOutput('Hello 世界', 'ja')).toBe(false)
  })

  it('Given a Korean stream, When the decode comes out in kana, Then it is treated as a language miss', () => {
    expect(isWrongLanguageOutput('ありがとう', 'ko')).toBe(true)
    expect(isWrongLanguageOutput('안녕하세요', 'ko')).toBe(false)
  })

  it('Given a Chinese stream, When the decode comes out in kana or Hangul, Then it is treated as a language miss', () => {
    expect(isWrongLanguageOutput('ありがとう', 'zh')).toBe(true)
    expect(isWrongLanguageOutput('감사합니다', 'zh')).toBe(true)
    expect(isWrongLanguageOutput('你好，世界', 'zh')).toBe(false)
  })

  it('Given a Latin-script source language, Then no script check is applied', () => {
    expect(isWrongLanguageOutput('다', 'en')).toBe(false)
    expect(isWrongLanguageOutput('ありがとう', 'es')).toBe(false)
  })
})

describe('isPunctuationOnly', () => {
  it('Given Dolphin decodes a lone sentence-final period, When checked, Then it is dropped', () => {
    expect(isPunctuationOnly('。')).toBe(true)
    expect(isPunctuationOnly('、。')).toBe(true)
    expect(isPunctuationOnly('？！')).toBe(true)
    expect(isPunctuationOnly('...')).toBe(true)
    expect(isPunctuationOnly(', .')).toBe(true)
    expect(isPunctuationOnly('')).toBe(true)
  })

  it('Given real speech in any script, When checked, Then it is kept', () => {
    expect(isPunctuationOnly('はい。')).toBe(false)
    expect(isPunctuationOnly('うちの中学は弁当制で。')).toBe(false)
    expect(isPunctuationOnly('Hello world.')).toBe(false)
    expect(isPunctuationOnly('50 円')).toBe(false)
    // Lone characters that are letters (e.g. the particle "I" in English).
    expect(isPunctuationOnly('a')).toBe(false)
  })
})

describe('isSilenceHallucination', () => {
  it('matches known fillers regardless of case and punctuation', () => {
    expect(isSilenceHallucination('you')).toBe(true)
    expect(isSilenceHallucination('You.')).toBe(true)
    expect(isSilenceHallucination('Thank you.')).toBe(true)
    expect(isSilenceHallucination('Thanks for watching!')).toBe(true)
  })

  it('Given Whisper emits the Japanese outro phrase without matching audio, When the whole result is checked, Then it is treated as a silence hallucination', () => {
    expect(isSilenceHallucination('ご視聴ありがとうございました')).toBe(true)
    expect(isSilenceHallucination('ご視聴ありがとうございました。')).toBe(true)
  })

  it('never matches real sentences containing those words', () => {
    expect(isSilenceHallucination('you are here')).toBe(false)
    expect(isSilenceHallucination('thank you for the coffee')).toBe(false)
    expect(isSilenceHallucination("I'm gonna go get some of that.")).toBe(false)
    expect(isSilenceHallucination('最後までご視聴ありがとうございました。')).toBe(false)
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

  it('Given a Japanese continuation decoded with a run-in, When its start repeats the previous line, Then the overlap is dropped without losing the rest', () => {
    expect(
      stripSeamRepeat('看板もなぎ倒されてしまった', '看板もなぎ倒されてしまったようです。', {
        carriedSeam: true,
      }),
    ).toBe('ようです。')
  })

  it('Given a partial Japanese overlap and punctuation at the seam, When it is stripped, Then the punctuation is left in place', () => {
    expect(
      stripSeamRepeat('傘が風で舞い看板も', '看板も、なぎ倒された。', { carriedSeam: true }),
    ).toBe('なぎ倒された。')
  })

  it('Given the same Japanese repeat without a carried seam, Then it is kept as natural repetition', () => {
    expect(
      stripSeamRepeat('そうですね', 'そうですね、今日は。'),
    ).toBe('そうですね、今日は。')
  })

  it('Given an overlap too short to be a seam, When it is stripped, Then the text is kept', () => {
    expect(stripSeamRepeat('看板も', '看板が落ちた。', { carriedSeam: true })).toBe('看板が落ちた。')
  })

  it('Given a run-in decode that is entirely the previous tail, Then nothing remains', () => {
    expect(stripSeamRepeat('看板もなぎ倒された', '看板もなぎ倒された。', { carriedSeam: true })).toBe('')
  })
})

describe('hasUnfinishedEnding', () => {
  it('Given a Japanese line cut after a binding particle, When it is checked, Then the sentence is unfinished', () => {
    expect(hasUnfinishedEnding('告知といいますか事前予告を。', 'ja')).toBe(true)
    expect(hasUnfinishedEnding('こちらへ', 'ja')).toBe(true)
    expect(hasUnfinishedEnding('そうですね、それで', 'ja')).toBe(true)
  })

  it('Given a Japanese line cut inside a clause, When it is checked, Then the sentence is unfinished', () => {
    expect(hasUnfinishedEnding('たぶん行くけど。', 'ja')).toBe(true)
    expect(hasUnfinishedEnding('見ながら', 'ja')).toBe(true)
    expect(hasUnfinishedEnding('食べて', 'ja')).toBe(true)
  })

  it('Given a Japanese line that can end a sentence, When it is checked, Then the sentence is finished', () => {
    expect(hasUnfinishedEnding('させて頂ければと思いました。', 'ja')).toBe(false)
    expect(hasUnfinishedEnding('そうですね', 'ja')).toBe(false)
    expect(hasUnfinishedEnding('ありがとうございます。', 'ja')).toBe(false)
  })

  it('Given a Kansai-ben sentence ending in や, When it is checked, Then it is treated as finished', () => {
    expect(hasUnfinishedEnding('そうや。', 'ja')).toBe(false)
  })

  it('Given a line in another language, When it is checked, Then it is never treated as unfinished', () => {
    expect(hasUnfinishedEnding('事前予告を', 'zh')).toBe(false)
    expect(hasUnfinishedEnding('and then', 'en')).toBe(false)
  })
})

describe('joinMidSentenceText', () => {
  it('Given two Japanese halves, When they are joined, Then the spurious period is dropped and no space is added', () => {
    expect(joinMidSentenceText('告知といいますか事前予告を。', 'させて頂ければと思いました。'))
      .toBe('告知といいますか事前予告をさせて頂ければと思いました。')
  })

  it('Given two Latin halves, When they are joined, Then they are separated by a space', () => {
    expect(joinMidSentenceText('before the break', 'after the break')).toBe('before the break after the break')
  })

  it('Given a half with nothing left after punctuation is removed, Then only the other half remains', () => {
    expect(joinMidSentenceText('…。', 'させて')).toBe('させて')
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

  it('Given a shorter Japanese phrase loop separated by inconsistent spaces, When it is checked, Then it is still treated as a hallucination', () => {
    expect(
      isRepetitionHallucination('いじっていって行くと 行くと行くと 行くと行くと 行くと 行く'),
    ).toBe(true)
  })

  it('Given six consecutive repetitions of a short Japanese phrase, When it is checked, Then it is treated as a hallucination', () => {
    expect(isRepetitionHallucination('行くと'.repeat(6))).toBe(true)
  })

  it('Given normal Japanese speech or a short natural repetition, When it is checked, Then it remains translatable', () => {
    expect(
      isRepetitionHallucination(
        'この子供は昨日、公園で遊んでから家に帰りました。週末は新しい本を読んで、家族と夕食を楽しむ予定です。',
      ),
    ).toBe(false)
    expect(isRepetitionHallucination('はいはい、分かりました。')).toBe(false)
    expect(isRepetitionHallucination('行くと'.repeat(5))).toBe(false)
  })
})

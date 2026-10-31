// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The selected-words rules both previews share (spec 024 024-FR-004,
 * comments-v2 C-07): collapse with a range, the choice, and finding the
 * words again.
 */
import { describe, expect, it } from 'vitest'
import { isAnchorSelection, SEL_CONTEXT_MAX_CHARS, SEL_EXACT_MAX_CHARS } from './anchorSel'
import { codePointLength } from './format'
import { chooseWords, collapseRange, headOf, locateWords, occurrences, tailOf } from './selectionWords'

describe('collapseRange', () => {
  it('collapses whitespace runs and trims, carrying the range with the text', () => {
    const raw = '  Ship\n\n  by   Friday.\t'
    const start = raw.indexOf('by')
    const end = raw.indexOf('Friday') + 'Friday'.length
    const range = collapseRange(raw, start, end)
    expect(range.text).toBe('Ship by Friday.')
    expect(range.text.slice(range.start, range.end)).toBe('by Friday')
  })

  it('normalises to NFC part by part, so the offsets stay exact', () => {
    const raw = 'café au lait'
    const range = collapseRange(raw, 0, 5)
    expect(range.text).toBe('café au lait')
    expect(range.text.slice(range.start, range.end)).toBe('café')
  })

  it('clamps a range outside the text: an empty range at the end', () => {
    expect(collapseRange('abc', 10, 20)).toEqual({ text: 'abc', start: 3, end: 3 })
    expect(collapseRange('', 0, 0)).toEqual({ text: '', start: 0, end: 0 })
  })
})

/**
 * The collapse as it was before it was made linear (character by character
 * onto one string, asking it `endsWith` each time): the oracle the linear
 * one must equal, output and offsets.
 */
function quadraticCollapseRange(raw: string, start: number, end: number): { text: string; start: number; end: number } {
  const from = Math.max(0, Math.min(start, raw.length))
  const to = Math.max(from, Math.min(end, raw.length))
  let out = ''
  let outStart = -1
  let outEnd = -1
  for (let i = 0; i <= raw.length; i += 1) {
    if (i === from) outStart = out.length
    if (i === to) outEnd = out.length
    if (i === raw.length) break
    const char = raw[i]
    if (/\s/.test(char)) {
      if (out !== '' && !out.endsWith(' ')) out += ' '
    } else out += char
  }
  if (out.endsWith(' ')) out = out.slice(0, -1)
  const clamp = (n: number): number => Math.min(n, out.length)
  const s = clamp(outStart)
  const e = Math.max(s, clamp(outEnd))
  const before = out.slice(0, s).normalize('NFC')
  const words = out.slice(s, e).normalize('NFC')
  const after = out.slice(e).normalize('NFC')
  return { text: before + words + after, start: before.length, end: before.length + words.length }
}

/** A seeded source in [0, 1): the same inputs on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

/** Pieces a target's text is made of: words, every kind of blank, a decomposed accent, an astral character, a lone surrogate. */
const PIECES = ['a', 'Ship', 'é', 'é', '😀', '\uD83D', ' ', '  ', '\n', '\r\n', '\t', ' ', ' ', '　', '.', 'ß']

describe('024-NFR-003 collapseRange stays linear on the long targets the corpus found', () => {
  it('024-NFR-003 the linear collapse equals the old one on varied texts and ranges, the edges included', () => {
    const random = seeded(24_003)
    const pick = (n: number): number => Math.floor(random() * n)
    const texts = ['', ' ', '   ', 'a', ' a ', '\n\na\t\tb\n', 'café au lait', 'é   é']
    for (let n = 0; n < 300; n += 1) texts.push(Array.from({ length: pick(60) }, () => PIECES[pick(PIECES.length)]).join(''))
    for (const raw of texts) {
      const ranges: Array<[number, number]> = [[0, 0], [0, raw.length], [raw.length, raw.length], [-5, 3], [2, -1], [raw.length + 4, raw.length + 9]]
      for (let r = 0; r < 6; r += 1) ranges.push([pick(raw.length + 3) - 1, pick(raw.length + 3) - 1])
      for (const [start, end] of ranges) {
        expect(collapseRange(raw, start, end), JSON.stringify({ raw, start, end })).toEqual(quadraticCollapseRange(raw, start, end))
      }
    }
  })

  it('024-NFR-003 a 2,000,000-character target collapses in well under the 34.6 s an 800,000-character one took', () => {
    const random = seeded(800_000)
    const parts: string[] = []
    let length = 0
    while (length < 2_000_000) {
      const piece = PIECES[Math.floor(random() * PIECES.length)]
      parts.push(piece)
      length += piece.length
    }
    const raw = parts.join('')
    const startedAt = performance.now()
    // No range: one NFC part, so the whole text can be checked against a regular-expression collapse.
    const range = collapseRange(raw, 0, 0)
    const elapsedMs = performance.now() - startedAt
    // A generous bound: the linear pass takes tens of milliseconds; the old one took minutes at this size.
    expect(elapsedMs).toBeLessThan(5_000)
    expect(range).toEqual({ text: raw.replace(/\s+/g, ' ').trim().normalize('NFC'), start: 0, end: 0 })
  })
})

describe('chooseWords', () => {
  const text = 'We ship the beta to ten customers. The target is to ship by Friday.'
  const at = (words: string) => ({ text, start: text.indexOf(words), end: text.indexOf(words) + words.length })

  it('no range, or the whole text, is a comment on the whole target', () => {
    expect(chooseWords({ text, start: 4, end: 4 })).toEqual({ kind: 'whole' })
    expect(chooseWords({ text, start: 0, end: text.length })).toEqual({ kind: 'whole' })
  })

  it('a range of only spaces is refused', () => {
    expect(chooseWords({ text: 'a   b', start: 1, end: 2 })).toEqual({ kind: 'blank' })
  })

  it('trims the words and stores up to 32 code points of context each side', () => {
    const choice = chooseWords({ text, start: text.indexOf(' ship by') , end: text.indexOf('Friday') + 6 })
    expect(choice).toMatchObject({ kind: 'words', cut: false })
    if (choice.kind !== 'words') return
    expect(choice.sel.exact).toBe('ship by Friday')
    expect(choice.sel.suffix).toBe('.')
    expect(codePointLength(choice.sel.prefix)).toBe(SEL_CONTEXT_MAX_CHARS)
    expect(text.slice(0, choice.start).endsWith(choice.sel.prefix)).toBe(true)
    expect(isAnchorSelection(choice.sel)).toBe(true)
  })

  it('cuts words longer than 200 code points at 200, on a grapheme boundary, and says so', () => {
    const long = `${'word '.repeat(60)}end`
    const choice = chooseWords({ text: `Start. ${long} Tail.`, start: 7, end: 7 + long.length })
    expect(choice.kind).toBe('words')
    if (choice.kind !== 'words') return
    expect(choice.cut).toBe(true)
    expect(codePointLength(choice.sel.exact)).toBeLessThanOrEqual(SEL_EXACT_MAX_CHARS)
    const emoji = '👍🏽'.repeat(120)
    const cut = chooseWords({ text: `x ${emoji} y`, start: 2, end: 2 + emoji.length })
    expect(cut.kind === 'words' && cut.cut && [...new Intl.Segmenter().segment(cut.sel.exact)].every(s => s.segment === '👍🏽')).toBe(true)
  })

  it('the same words twice are told apart by their context', () => {
    const twice = 'Ship by Friday. Then ship by Monday.'
    const choice = chooseWords({ text: twice, start: twice.lastIndexOf('ship'), end: twice.lastIndexOf('ship') + 4 })
    expect(choice).toMatchObject({ kind: 'words', sel: { exact: 'ship' } })
  })

  it('a tie – the same words with the same 32-character context – cannot be found again', () => {
    const block = `${'x'.repeat(40)} the ${'y'.repeat(40)}`
    const tied = `${block} ${block}`
    const start = tied.indexOf(' the ') + 1
    expect(chooseWords({ text: tied, start, end: start + 3 })).toEqual({ kind: 'tie' })
  })

  it('a word inside the text is not the whole text', () => {
    expect(chooseWords(at('beta'))).toMatchObject({ kind: 'words', sel: { exact: 'beta' } })
  })
})

describe('locateWords and the context helpers', () => {
  it('finds stored words in context first, else their one occurrence, else nothing', () => {
    const text = 'Ship by Friday. Then ship by Monday.'
    expect(locateWords(text, { exact: 'by', prefix: 'Then ship ', suffix: ' Monday.' })).toEqual({ start: 26, end: 28 })
    expect(locateWords(text, { exact: 'Monday', prefix: 'gone ', suffix: '' })).toEqual({ start: 29, end: 35 })
    expect(locateWords(text, { exact: 'by', prefix: 'gone ', suffix: '' })).toBeNull()
    expect(locateWords(text, { exact: 'Tuesday', prefix: '', suffix: '' })).toBeNull()
  })

  it('tailOf and headOf count code points and never split a grapheme', () => {
    expect(tailOf('abcdef', 3)).toBe('def')
    expect(headOf('abcdef', 3)).toBe('abc')
    expect(tailOf('a👍🏽', 1)).toBe('')
    expect(headOf('👍🏽b', 2)).toBe('👍🏽')
    expect(occurrences('aaa', 'aa')).toEqual([0, 1])
    expect(occurrences('aaa', '')).toEqual([])
  })
})

describe('locateWords after the selected copy was edited', () => {
  it('024-FR-004 the words do not jump to another copy that kept neither side of their context', () => {
    const sel = { exact: 'colour', prefix: 'The ', suffix: ' of the sky' }
    const before = 'The colour of the sky and the colour of the sea.'
    expect(locateWords(before, sel)).toEqual({ start: 4, end: 10 })
    // The selected copy was edited; the other copy has neither "The " before nor " of the sky" after.
    expect(locateWords('The color of the sky and the colour of the sea.', sel)).toBeNull()
  })

  it('024-FR-004 the one remaining copy that kept one side is still found', () => {
    const sel = { exact: 'colour', prefix: 'The ', suffix: ' of the sky' }
    expect(locateWords('The colour of the sea.', sel)).toEqual({ start: 4, end: 10 })
  })
})

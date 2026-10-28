// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the linear CSS `url()` scanner (issue #124, security audit): it
 * finds exactly what the extractor's former regex captured – checked case by
 * case, on every short string over the characters that matter, and on seeded
 * random ones – and stays linear where the regex was quadratic.
 */
import { describe, expect, it } from 'vitest'
import { referenceCssUrlTargets } from './__test-helpers__/linkExtractTreeReference'
import { cssUrlTargets } from './cssUrlTargets'

/** The pieces a `url()` reference is made of, and some that only look like one. */
const PIECES = ['url(', 'URL(', "'", '"', ')', ' ', 'a', '\u00a0'] as const

/** Every sequence of `length` pieces. */
function* sequences(length: number): Generator<string> {
  if (length === 0) {
    yield ''
    return
  }
  for (const head of sequences(length - 1)) {
    for (const piece of PIECES) yield head + piece
  }
}

/** A small seeded generator (mulberry32), so a failure replays. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Wall-clock ceiling for one flood below. The scanner takes milliseconds on
 * each. The former regex is quadratic in them: 160 KB of `url(` took it 6.2 s
 * on the emulated Windows box, so the 400 KB here would take some 40 s.
 */
const FLOOD_BUDGET_MS = 3_000
/** 400 KB of `url(`. */
const FLOOD_OPENINGS = 100_000

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now()
  const value = run()
  return { value, ms: performance.now() - start }
}

describe('cssUrlTargets', () => {
  it.each([
    ['unquoted', 'a{background:url(one.png)}', ['one.png']],
    ['double-quoted', 'a{background:url("two.png")}', ['two.png']],
    ['single-quoted', "a{background:url('three.png')}", ['three.png']],
    ['spaced', "url(  'a.png'  ) url( b.png )", ['a.png', 'b.png ']],
    ['any letter case', 'URL(a.png) Url(b.png)', ['a.png', 'b.png']],
    ['empty', "url() url('')", ['', '']],
    ['several in order', 'url(a) url("b") url(\'c\')', ['a', 'b', 'c']],
    ['a quote with no ")" after it', "url('a.png' x) url(b.png)", ['b.png']],
    ['an unclosed quote', "url('a.png) url(b.png)", ['b.png']],
    ['a quote inside an unquoted target', "url(a'b) url(c)", ['c']],
    ['no closing parenthesis', 'url(a.png', []],
    ['nested openings', 'url(url(a.png))', ['url(a.png']],
    ['Unicode whitespace around a quoted target', "url(\u00a0'a.png'\u2028)", ['a.png']],
    ['a comma-separated list', 'background:url(a.png),url("b.png")', ['a.png', 'b.png']]
  ])('reads %s references', (_label, css, expected) => {
    expect(cssUrlTargets(css)).toEqual(expected)
    expect(referenceCssUrlTargets(css)).toEqual(expected)
  })

  it('agrees with the former regex on every string of up to five pieces', () => {
    let checked = 0
    for (let length = 0; length <= 5; length += 1) {
      for (const css of sequences(length)) {
        expect(cssUrlTargets(css), JSON.stringify(css)).toEqual(referenceCssUrlTargets(css))
        checked += 1
      }
    }
    expect(checked).toBe(37_449)
  })

  it('agrees with the former regex on seeded random stylesheets', () => {
    const random = seededRandom(124)
    for (let run = 0; run < 2_000; run += 1) {
      const pieceCount = 10 + Math.floor(random() * 40)
      let css = ''
      for (let index = 0; index < pieceCount; index += 1) {
        css += PIECES[Math.floor(random() * PIECES.length)]
      }
      expect(cssUrlTargets(css), JSON.stringify(css)).toEqual(referenceCssUrlTargets(css))
    }
  })

  // Each flood ends at a `"`, so none of its openings closes – the case that
  // sent the regex to the end of the text from every one of them.
  it.each([
    ['openings that nothing closes', 'url('.repeat(FLOOD_OPENINGS)],
    ['the same behind an unclosed quote', `url('${'url('.repeat(FLOOD_OPENINGS)}`],
    ['openings padded with whitespace', 'url(  '.repeat(FLOOD_OPENINGS)]
  ])('stays linear on %s', (_label, flood) => {
    const { value, ms } = timed(() => cssUrlTargets(`${flood}" url(tail.png)`))
    expect(value).toEqual(['tail.png'])
    expect(ms).toBeLessThan(FLOOD_BUDGET_MS)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { cutAtCodeUnits, cutAtGraphemes, graphemeCount } from './textCut'

const THUMBS = '\u{1F44D}\u{1F3FD}' // thumbs up, medium skin tone: 4 code units, 1 character
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}' // ZWJ sequence: 8 code units, 1 character

describe('cutAtCodeUnits (T18 boundaries)', () => {
  it('keeps text at exactly the limit and cuts one code unit over it', () => {
    const exact = 'a'.repeat(20_000)
    expect(cutAtCodeUnits(exact, 20_000)).toBe(exact)
    expect(cutAtCodeUnits(`${exact}b`, 20_000)).toBe(exact)
  })

  it('never splits a surrogate pair or an emoji sequence at the limit', () => {
    const text = `${'a'.repeat(19_999)}${THUMBS}tail`
    expect(cutAtCodeUnits(text, 20_000)).toBe('a'.repeat(19_999))
    const fam = `${'a'.repeat(19_995)}${FAMILY}`
    expect(cutAtCodeUnits(fam, 20_000)).toBe('a'.repeat(19_995))
    expect(cutAtCodeUnits(`ab${THUMBS}`, 6)).toBe(`ab${THUMBS}`)
  })

  it('returns nothing when the first character alone is longer than the limit', () => {
    expect(cutAtCodeUnits(FAMILY, 3)).toBe('')
    expect(cutAtCodeUnits('abc', 0)).toBe('')
  })

  it('falls back to a code-point boundary inside a pathological cluster', () => {
    const marks = `a${'́'.repeat(2000)}`
    const cut = cutAtCodeUnits(marks, 1000)
    expect(cut.length).toBeLessThanOrEqual(1000)
    expect(cut.length).toBeGreaterThan(0)
    const lone = `${'́'.repeat(600)}\u{1F44D}`
    expect(cutAtCodeUnits(lone, 601)).toBe('́'.repeat(600))
  })
})

describe('cutAtGraphemes', () => {
  it('counts and cuts by user-perceived characters', () => {
    expect(graphemeCount(`ab${FAMILY}`)).toBe(3)
    expect(cutAtGraphemes(`ab${FAMILY}cd`, 3)).toBe(`ab${FAMILY}`)
    expect(cutAtGraphemes('abc', 3)).toBe('abc')
    expect(cutAtGraphemes('abc', 0)).toBe('')
  })
})

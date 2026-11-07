// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { PAGE_TITLE_MAX_CODE_UNITS, sanitizePageText } from './pageText'

describe('sanitizePageText (S10)', () => {
  it('replaces C0, DEL, C1 and line separators with one space', () => {
    expect(sanitizePageText('a\u0000b\tc\nd\u007fe\u0085f g h')).toBe('a b c d e f g h')
    expect(sanitizePageText('  two\r\n\r\nlines  ')).toBe('two lines')
  })

  it('removes bidi embeddings, overrides, isolates and marks', () => {
    const spoof = 'invoice‮txt.exe'
    expect(sanitizePageText(spoof)).toBe('invoicetxt.exe')
    for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c]) {
      expect(sanitizePageText(`a${String.fromCodePoint(cp)}b`)).toBe('ab')
    }
  })

  it('removes invisible characters but keeps emoji joiners and variation selectors', () => {
    expect(sanitizePageText('pay​pal­⁠\u{E0041}')).toBe('paypal')
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'
    expect(sanitizePageText(family)).toBe(family)
    expect(sanitizePageText('❤️')).toBe('❤️')
    expect(sanitizePageText('a‍b')).toBe('ab')
  })

  it('drops unpaired surrogates and keeps pairs', () => {
    expect(sanitizePageText('a\uD800b\uDC00c')).toBe('abc')
    expect(sanitizePageText('\u{1F600}')).toBe('\u{1F600}')
  })

  it('caps the length at a whole-character boundary (200 vs 201)', () => {
    expect(sanitizePageText('x'.repeat(200))).toHaveLength(200)
    expect(sanitizePageText('x'.repeat(201))).toHaveLength(PAGE_TITLE_MAX_CODE_UNITS)
    expect(sanitizePageText(`${'x'.repeat(199)}\u{1F600}`)).toBe('x'.repeat(199))
    expect(sanitizePageText('word '.repeat(10), 12)).toBe('word word wo')
  })
})

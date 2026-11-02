// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  COMMENT_MAX_CHARS,
  ancestorTag,
  countCharacters,
  counterState,
  elementLabel,
  formatCommentTime,
  hasForbiddenIdentityCharacter,
  isInvisibleControl,
  isStrippedControl,
  plural,
  sanitizeMessage,
  splitVisibleControls,
  visibleString
} from './commentFormat'

// Built from code points: a literal control character in source is exactly
// what these rules exist to catch, and editors hide it.
const cp = (n: number): string => String.fromCodePoint(n)
const RLO = cp(0x202e)
const ZWSP = cp(0x200b)
const BOM = cp(0xfeff)
const ALM = cp(0x061c)
const LRI = cp(0x2066)

describe('commentFormat', () => {
  describe('invisible and stripped controls', () => {
    it.each([0x061c, 0x200b, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff])(
      'treats U+%s as an invisible control',
      code => {
        expect(isInvisibleControl(code)).toBe(true)
      }
    )

    it.each([0x41, 0x2010, 0x2070, 0x061b, 0x2029])('lets U+%s through', code => {
      expect(isInvisibleControl(code)).toBe(false)
    })

    it('strips C0/C1 controls except tab, newline and carriage return', () => {
      expect(isStrippedControl(0x00)).toBe(true)
      expect(isStrippedControl(0x1b)).toBe(true)
      expect(isStrippedControl(0x7f)).toBe(true)
      expect(isStrippedControl(0x9f)).toBe(true)
      expect(isStrippedControl(0x09)).toBe(false)
      expect(isStrippedControl(0x0a)).toBe(false)
      expect(isStrippedControl(0x0d)).toBe(false)
      expect(isStrippedControl(0x41)).toBe(false)
    })
  })

  describe('SEC-18 bidi/control characters in author or email', () => {
    it('flags direction-changing and invisible characters in an identity value', () => {
      expect(hasForbiddenIdentityCharacter(`Ada${RLO}ecalevol`)).toBe(true)
      expect(hasForbiddenIdentityCharacter(`Ada${ZWSP}`)).toBe(true)
      expect(hasForbiddenIdentityCharacter(`${BOM}Ada`)).toBe(true)
      expect(hasForbiddenIdentityCharacter(`Ada${ALM}`)).toBe(true)
      expect(hasForbiddenIdentityCharacter(`Ada${cp(0x07)}`)).toBe(true)
      expect(hasForbiddenIdentityCharacter(`Ada${cp(0x85)}`)).toBe(true)
      // A newline in a one-line name is a control too.
      expect(hasForbiddenIdentityCharacter('Ada\nLovelace')).toBe(true)
    })

    it('accepts ordinary names in any script', () => {
      expect(hasForbiddenIdentityCharacter('Ada Lovelace')).toBe(false)
      expect(hasForbiddenIdentityCharacter('Zażółć Gęślą')).toBe(false)
      expect(hasForbiddenIdentityCharacter('מרים כהן')).toBe(false)
      expect(hasForbiddenIdentityCharacter('ada@example.com')).toBe(false)
    })
  })

  describe('sanitizeMessage', () => {
    it('normalises line endings, strips C0/C1 controls and trims', () => {
      expect(sanitizeMessage(`  a\r\nb\rc${cp(0x00)}${cp(0x1b)}d\te  `)).toBe('a\nb\ncd\te')
    })

    it('keeps bidi controls in a message (they are shown, not removed)', () => {
      expect(sanitizeMessage(`a${RLO}b`)).toBe(`a${RLO}b`)
    })

    it('returns empty text for whitespace only', () => {
      expect(sanitizeMessage(' \n\t ')).toBe('')
    })
  })

  describe('counting', () => {
    it('counts code points, not UTF-16 units', () => {
      expect(countCharacters('😀😀')).toBe(2)
      expect(countCharacters('abc')).toBe(3)
    })

    it('warns from 3,600 and refuses over 4,000', () => {
      expect(counterState(0)).toBe('ok')
      expect(counterState(3_599)).toBe('ok')
      expect(counterState(3_600)).toBe('near')
      expect(counterState(COMMENT_MAX_CHARS)).toBe('near')
      expect(counterState(COMMENT_MAX_CHARS + 1)).toBe('over')
    })
  })

  describe('R-017 bidi tokens', () => {
    it('splits invisible controls out as visible U+ tokens', () => {
      expect(splitVisibleControls(`ab${RLO}cd${LRI}`)).toEqual([
        { kind: 'text', text: 'ab' },
        { kind: 'control', code: 'U+202E' },
        { kind: 'text', text: 'cd' },
        { kind: 'control', code: 'U+2066' }
      ])
    })

    it('pads a short code point to four digits', () => {
      expect(splitVisibleControls(ALM)).toEqual([{ kind: 'control', code: 'U+061C' }])
    })

    it('returns no segments for empty text and one for plain text', () => {
      expect(splitVisibleControls('')).toEqual([])
      expect(splitVisibleControls('plain')).toEqual([{ kind: 'text', text: 'plain' }])
    })

    it('M9 spells controls as tokens for attribute values', () => {
      expect(visibleString(`ab${RLO}cd`)).toBe('ab⟨U+202E⟩cd')
      expect(visibleString('plain')).toBe('plain')
      expect(visibleString('')).toBe('')
    })
  })

  describe('labels', () => {
    it('builds tag#id.class with at most two classes', () => {
      expect(elementLabel({ tag: 'BUTTON', elementId: 'buy', classes: ['cta', 'primary'] })).toBe(
        'button#buy.cta.primary'
      )
      expect(elementLabel({ tag: 'div', classes: ['a', 'b', 'c'] })).toBe('div.a.b…')
      expect(elementLabel({ tag: 'p' })).toBe('p')
    })

    it('cuts a label at 40 characters with an ellipsis', () => {
      const label = elementLabel({ tag: 'section', elementId: 'x'.repeat(60) })
      expect(countCharacters(label)).toBe(40)
      expect(label.endsWith('…')).toBe(true)
    })

    it('names the in-file ancestor of a script-built element', () => {
      expect(ancestorTag({ tag: 'UL', elementId: 'list' })).toBe('<ul id="list">')
      expect(ancestorTag({ tag: 'ul', classes: ['a', 'b', 'c'] })).toBe('<ul class="a b">')
      expect(ancestorTag({ tag: 'ul' })).toBe('<ul>')
    })

    it('pluralises', () => {
      expect(plural(1, 'reply', 'replies')).toBe('1 reply')
      expect(plural(0, 'reply', 'replies')).toBe('0 replies')
      expect(plural(3, 'reply', 'replies')).toBe('3 replies')
    })
  })

  describe('R-016 time formatting with an injected clock and locale', () => {
    const now = new Date(2026, 9, 26, 15, 30)

    it('says Today for the same local day', () => {
      expect(formatCommentTime(new Date(2026, 9, 26, 9, 5), now, 'en-GB')).toBe('Today, 09:05')
    })

    it('says Yesterday for the previous local day', () => {
      expect(formatCommentTime(new Date(2026, 9, 25, 23, 59), now, 'en-GB')).toBe(
        'Yesterday, 23:59'
      )
    })

    it('drops the year inside this year', () => {
      expect(formatCommentTime(new Date(2026, 2, 3, 8, 0), now, 'en-GB')).toBe('3 Mar, 08:00')
    })

    it('keeps the year for another year', () => {
      expect(formatCommentTime(new Date(2025, 11, 31, 8, 0), now, 'en-GB')).toBe(
        '31 Dec 2025, 08:00'
      )
    })

    it('follows the locale', () => {
      expect(formatCommentTime(new Date(2026, 2, 3, 8, 0), now, 'en-US')).toBe('Mar 3, 08:00')
    })

    it('accepts an ISO string and shows an unreadable one as it is', () => {
      const iso = new Date(2026, 9, 26, 9, 5).toISOString()
      expect(formatCommentTime(iso, now, 'en-GB')).toBe('Today, 09:05')
      expect(formatCommentTime('not a date', now, 'en-GB')).toBe('not a date')
      expect(formatCommentTime(new Date(Number.NaN), now, 'en-GB')).toBe('')
    })
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared agent-note-line encoder and the hint lines (spec 024, 024-FR-008,
 * architecture note 001 § 8 C1; design `markdown-format.md` § 6).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { HOSTILE_PIECES, PROPERTY_TIMEOUT_MS, fcParams, hostileText } from './__fixtures__/arbitraries'
import { LINE_SEP, LONE_HIGH, NUL, RLO, ZWJ, ZWSP, ch, makeComment, uEsc } from './__fixtures__/commentTestData'
import { codePointLength, isSafeNoteLine } from './format'
import {
  TARGET_HINT_LEAD,
  WORDS_HINT_LEAD,
  cutOnGrapheme,
  encodeNoteText,
  markdownTargetHint,
  selectionHints,
  wordsHint
} from './noteLines'

const FAMILY = `${ch(0x1f469)}${ZWJ}${ch(0x1f469)}${ZWJ}${ch(0x1f467)}`

describe('cutOnGrapheme', () => {
  it('keeps text at or under the limit, empty text included', () => {
    expect(cutOnGrapheme('', 5)).toBe('')
    expect(cutOnGrapheme('abcde', 5)).toBe('abcde')
    // Five code points in ten UTF-16 units: under the limit, not cut.
    expect(cutOnGrapheme(ch(0x1f600).repeat(5), 5)).toBe(ch(0x1f600).repeat(5))
  })

  it('cuts to max code points, the … included, on a grapheme boundary', () => {
    expect(cutOnGrapheme('abcdef', 5)).toBe('abcd…')
    expect(cutOnGrapheme('abcdef', 1)).toBe('…')
    // e + combining acute is one grapheme: never split.
    expect(cutOnGrapheme(`abce${unitAcute()}f`, 5)).toBe('abc…')
    // A five-code-point emoji sequence that does not fit whole is dropped whole.
    expect(cutOnGrapheme(`ab${FAMILY}cd`, 6)).toBe('ab…')
    expect(cutOnGrapheme(`ab${FAMILY}cd`, 8)).toBe(`ab${FAMILY}…`)
  })

  it('never returns more than max code points', () => {
    fc.assert(
      fc.property(hostileText(0, 40, 120), fc.integer({ min: 1, max: 80 }), (text, max) => {
        const cut = cutOnGrapheme(text, max)
        expect(codePointLength(cut)).toBeLessThanOrEqual(max)
        if (codePointLength(text) <= max) expect(cut).toBe(text)
        else expect(cut.endsWith('…') && text.startsWith(cut.slice(0, -1))).toBe(true)
      }),
      fcParams()
    )
  }, PROPERTY_TIMEOUT_MS)
})

function unitAcute(): string {
  return String.fromCharCode(0x301)
}

describe('encodeNoteText (C1)', () => {
  it('folds line breaks to a space', () => {
    expect(encodeNoteText('a\nb\r\nc\rd', 50)).toBe('a b c d')
    expect(encodeNoteText('one\nstatus: open', 50)).toBe('one status: open')
  })

  it('escapes the quote and the backslash, then shows hidden characters as \\uXXXX', () => {
    expect(encodeNoteText('say "hi" in C:\\dir', 50)).toBe('say \\"hi\\" in C:\\\\dir')
    expect(encodeNoteText(`a${RLO}b${ZWSP}c${NUL}d${LINE_SEP}e\tf`, 50)).toBe(
      `a${uEsc(0x202e)}b${uEsc(0x200b)}c${uEsc(0)}d${uEsc(0x2028)}e${uEsc(9)}f`
    )
    expect(encodeNoteText(`lone ${LONE_HIGH}`, 50)).toBe(`lone ${uEsc(0xd83d)}`)
  })

  it('breaks every -- as -\\-, so --> cannot appear', () => {
    expect(encodeNoteText('a --> b ---', 50)).toBe('a -\\-> b -\\-\\-')
  })

  it('cuts before escaping: the limit counts characters, not escapes', () => {
    expect(encodeNoteText('""""""', 4)).toBe('\\"\\"\\"…')
    expect(encodeNoteText(`${RLO}${RLO}${RLO}`, 3)).toBe(uEsc(0x202e).repeat(3))
  })
})

describe('hint lines', () => {
  it('words hint: the lead, then the quoted words cut at 200 code points', () => {
    expect(wordsHint('ship by Friday')).toBe('comment is about the words (when commented): "ship by Friday"')
    const long = wordsHint('x'.repeat(250))
    expect(long).toBe(`${WORDS_HINT_LEAD}"${'x'.repeat(199)}…"`)
  })

  it('Markdown target hint: the target name, then the quoted source start cut at 60 code points', () => {
    expect(markdownTargetHint('item 2 of the list', '- Run the load test against staging.')).toBe(
      'target in Markdown (when commented): item 2 of the list starting "- Run the load test against staging."'
    )
    expect(markdownTargetHint('paragraph', 'y'.repeat(61))).toBe(`${TARGET_HINT_LEAD}paragraph starting "${'y'.repeat(59)}…"`)
    expect(markdownTargetHint('divider', '---')).toBe(`${TARGET_HINT_LEAD}divider starting "-\\-\\-"`)
  })

  it('selectionHints: the words hint for a valid anchor.sel, none for none or an invalid one', () => {
    const anchor = makeComment().anchor
    expect(selectionHints(makeComment())).toEqual([])
    const valid = makeComment({ anchor: { ...anchor, sel: { exact: 'Buy', prefix: '', suffix: ' now' } } })
    expect(selectionHints(valid)).toEqual([wordsHint('Buy')])
    for (const sel of [{ exact: '' }, 'Buy', { exact: 'Buy', prefix: '', suffix: 'a  b' }, null]) {
      expect(selectionHints(makeComment({ anchor: { ...anchor, sel } }))).toEqual([])
    }
  })

  it('024-FR-008 hostile words and source text: every hint is one safe note line', () => {
    const hostile = fc.oneof(hostileText(0, 40, 400), fc.constantFrom(...HOSTILE_PIECES))
    fc.assert(
      fc.property(hostile, hostile, hostile, (words, target, text) => {
        for (const line of [wordsHint(words), markdownTargetHint(target, text)]) {
          expect(isSafeNoteLine(line), line).toBe(true)
          expect(line).not.toMatch(/[\r\n]/)
        }
      }),
      fcParams()
    )
  }, PROPERTY_TIMEOUT_MS)
})

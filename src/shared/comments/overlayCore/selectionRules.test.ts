// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { SELECTION_BUTTON_FLIP_PX, buttonGoesBelow, lastLineInView, markKeyOf, outsideButtonTops, parseMarkKey, pointerOnLines } from './selectionRules'

const VIEW = { left: 0, top: 100, right: 500, bottom: 400 }
const line = (top: number): { left: number; top: number; right: number; bottom: number } => ({ left: 10, top, right: 200, bottom: top + 20 })

describe('overlayCore selectionRules', () => {
  it('I-12 no line: nothing in view', () => {
    expect(lastLineInView([], VIEW)).toBeNull()
  })

  it('I-12 one line: in view, touching an edge from outside, or off', () => {
    expect(lastLineInView([line(200)], VIEW)).toEqual(line(200))
    expect(lastLineInView([line(80)], VIEW)).toBeNull()
    expect(lastLineInView([line(400)], VIEW)).toBeNull()
    expect(lastLineInView([{ ...line(200), left: 500, right: 600 }], VIEW)).toBeNull()
  })

  it('I-12 many lines: the last that shows, so the button stays with a long selection scrolled part way', () => {
    expect(lastLineInView([line(90), line(120), line(140), line(900)], VIEW)).toEqual(line(140))
  })

  it('I-10 the button flips below only within its distance of the view top', () => {
    expect(buttonGoesBelow(100 + SELECTION_BUTTON_FLIP_PX - 1, 100)).toBe(true)
    expect(buttonGoesBelow(100 + SELECTION_BUTTON_FLIP_PX, 100)).toBe(false)
  })

  it('I-13 a mark key goes there and back, whatever the pin key holds; a pin key is no mark key', () => {
    expect(parseMarkKey(markKeyOf('p-1', 0))).toEqual({ pin: 'p-1', word: 0 })
    expect(parseMarkKey(markKeyOf('p1', 19))).toEqual({ pin: 'p1', word: 19 })
    expect(parseMarkKey('p1')).toBeNull()
    expect(parseMarkKey('-w1')).toBeNull()
  })

  it('I-22 the pointer is on the selection only inside one of its lines; the far edges are out', () => {
    const lines = [line(100), line(120)]
    expect(pointerOnLines(lines, { x: 10, y: 125 })).toBe(true)
    expect(pointerOnLines(lines, { x: 200, y: 125 })).toBe(false)
    expect(pointerOnLines(lines, { x: 50, y: 140 })).toBe(false)
    expect(pointerOnLines([], { x: 50, y: 125 })).toBe(false)
  })
})

describe('outsideButtonTops (differences table D-10)', () => {
  const VIEW = { left: 0, top: 0, right: 800, bottom: 600 }
  const line = (top: number): { left: number; top: number; right: number; bottom: number } => ({ left: 100, top, right: 300, bottom: top + 20 })

  it('above, then below', () => {
    expect(outsideButtonTops(line(100), 28, 8, VIEW)).toEqual([64, 128])
  })

  it('near the view’s top: below only, as in comment mode', () => {
    expect(outsideButtonTops(line(SELECTION_BUTTON_FLIP_PX - 1), 28, 8, VIEW)).toEqual([SELECTION_BUTTON_FLIP_PX - 1 + 28])
  })

  it('near the view’s bottom: above only', () => {
    expect(outsideButtonTops(line(570), 28, 8, VIEW)).toEqual([534])
  })

  it('no room at all: nowhere', () => {
    expect(outsideButtonTops(line(20), 28, 8, { ...VIEW, bottom: 60 })).toEqual([])
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment marks and overlay hits (spec 024 C-12, C-16, C-17): the marks of
 * each pin's words, found again only after the page changed, capped per
 * render; what a hit on each overlay part stands for; and the parts of a pick
 * and of main's state that carry words.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { MarkResolver, MAX_MARK_BOXES } from './marks'
import { elementOfHit, hitAt } from './overlayHits'
import { stackPart, wordsPart } from './picks'
import { COMMENT_PICK_STACK_MAX } from '../../shared/ipc/preview-comment-page-schema'
import { parseCommentState, type IconState } from './state'
import { rangeOfWords } from './words'
import { drawPin, pinName, placePins } from './pins'
import { PIN_STACK_KEYS_MAX, PIN_WORDS_MAX } from './constants'
import { token } from './__test-helpers__/harness'

const realRects = Range.prototype.getClientRects
const VIEWPORT = { width: 800, height: 600 }

afterEach(() => {
  Range.prototype.getClientRects = realRects
  document.body.innerHTML = ''
})

/** Every range is drawn as `lines` lines of 10 × 10, down the page (`step` apart). */
function drawRanges(lines: number, step = 10): void {
  Range.prototype.getClientRects = function getClientRects() {
    return Array.from({ length: lines }, (_, i) => ({ left: 10, top: i * step, width: 10, height: 10, right: 20, bottom: i * step + 10 })) as unknown as DOMRectList
  }
}

const words = { exact: 'beta', prefix: 'the ', suffix: '' }

describe('C-12 (HTML) MarkResolver', () => {
  it('C-12 (HTML) marks each line of a visible pin\'s words; nothing for a hidden one or one without words', () => {
    document.body.innerHTML = '<p id="p">the beta</p>'
    const element = document.getElementById('p')!
    drawRanges(2)
    const icon: IconState = { key: 'k', token: token(1), count: 1, status: 'open', words: [words] }
    const plain: IconState = { key: 'j', token: token(2), count: 1, status: 'open' }
    const marks = new MarkResolver(() => 1).place(
      [
        { icon, element, visible: true },
        { icon, element, visible: false },
        { icon: plain, element, visible: true },
        { icon, element: undefined, visible: true }
      ],
      VIEWPORT
    )
    expect(marks.map(m => [m.key, m.box.top])).toEqual([
      ['k', 0],
      ['k', 10]
    ])
  })

  it('C-12 (HTML) finds the words again only after the page changed, and stops at the cap', () => {
    document.body.innerHTML = '<p id="p">the beta</p>'
    const element = document.getElementById('p')!
    let version = 1
    const resolver = new MarkResolver(() => version)
    const icon: IconState = { key: 'k', token: token(1), count: 1, status: 'open', words: [words] }
    drawRanges(1)
    expect(resolver.place([{ icon, element, visible: true }], VIEWPORT)).toHaveLength(1)
    // The text changed but the page version did not: the cached range is drawn.
    element.textContent = 'gone'
    expect(resolver.place([{ icon, element, visible: true }], VIEWPORT)).toHaveLength(1)
    version = 2
    expect(resolver.place([{ icon, element, visible: true }], VIEWPORT)).toHaveLength(0)
    element.textContent = 'the beta'
    version = 3
    // Lines drawn on top of each other, so every one is inside the viewport.
    drawRanges(MAX_MARK_BOXES + 5, 0)
    expect(resolver.place([{ icon, element, visible: true }], VIEWPORT)).toHaveLength(MAX_MARK_BOXES)
  })

  it('a line off screen gets no mark', () => {
    document.body.innerHTML = '<p id="p">the beta</p>'
    Range.prototype.getClientRects = function getClientRects() {
      return [{ left: 10, top: 900, width: 10, height: 10, right: 20, bottom: 910 }] as unknown as DOMRectList
    }
    const icon: IconState = { key: 'k', token: token(1), count: 1, status: 'open', words: [words] }
    expect(new MarkResolver(() => 1).place([{ icon, element: document.getElementById('p')!, visible: true }], VIEWPORT)).toEqual([])
  })

  it('a text longer than the overlay reads has no mark', () => {
    document.body.innerHTML = `<p id="p">beta ${'x'.repeat(200_001)}</p>`
    expect(rangeOfWords(document.getElementById('p')!, words)).toBeNull()
  })
})

describe('C-16 and C-17 (HTML) overlay hits', () => {
  it('C-17 (HTML) the button is on top, then pins, then marks, then shields – each standing for its element', () => {
    document.body.innerHTML = '<p id="p">x</p><iframe id="f"></iframe>'
    const p = document.getElementById('p')!
    const frame = document.getElementById('f') as HTMLIFrameElement
    const box = { left: 0, top: 0, width: 50, height: 50 }
    const pin = { key: 'k', count: 1, status: 'open' as const, element: p, content: 'lines' as const, box }
    const mark = { key: 'k', element: p, box }
    const boxes = { button: { words: { target: p }, box }, pins: [pin], marks: [mark], shields: [{ frame, box }] }
    const at = { x: 5, y: 5 }
    expect(hitAt(boxes, at)?.kind).toBe('button')
    expect(hitAt({ ...boxes, button: null }, at)?.kind).toBe('pin')
    expect(hitAt({ ...boxes, button: null, pins: [] }, at)?.kind).toBe('mark')
    expect(hitAt({ ...boxes, button: null, pins: [], marks: [] }, at)?.kind).toBe('shield')
    expect(hitAt({ button: null, pins: [], marks: [], shields: [] }, at)).toBeNull()
    for (const hit of [
      hitAt(boxes, at),
      hitAt({ ...boxes, button: null }, at),
      hitAt({ ...boxes, button: null, pins: [] }, at)
    ]) {
      expect(elementOfHit(hit!)).toBe(p)
    }
    expect(elementOfHit(hitAt({ ...boxes, button: null, pins: [], marks: [] }, at)!)).toBe(frame)
  })
})

describe('C-06 (HTML) pin', () => {
  it('C-06 (HTML) pin: main says changed, the pin is notched and its name says so; a stack is not notched', () => {
    const icon = (extra: Record<string, unknown>) => ({ key: 'k', token: token(1), count: 1, status: 'open', ...extra })
    const parsed = (changed: unknown) => parseCommentState({ mode: false, commentable: true, icons: [icon({ changed })] })?.icons[0]
    expect(parsed(true)?.changed).toBe(true)
    expect(parsed('yes')).not.toHaveProperty('changed')
    document.body.innerHTML = '<p id="p">x</p>'
    const element = document.getElementById('p')!
    const box = { left: 100, top: 100, width: 50, height: 20 }
    const [pin] = placePins([{ key: 'k', count: 1, status: 'open', changed: true, element, box }], VIEWPORT)
    expect(drawPin(document, undefined, pin, { label: 'p', selected: false }).classList.contains('erf-hpc-pin--changed')).toBe(true)
    expect(pinName(pin, 'p')).toBe('1 comment on p, changed. Open.')
    const crowd = placePins(Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, count: 1, status: 'open' as const, changed: true as const, element, box })), VIEWPORT)
    expect(drawPin(document, undefined, crowd[3], { label: 'p', selected: false }).classList.contains('erf-hpc-pin--changed')).toBe(false)
  })
})

describe('024-AC-004 (preload) the parts that carry words', () => {
  it('C-17 (HTML) a stack pin click names the keys after the first, capped as main accepts them', () => {
    expect(PIN_STACK_KEYS_MAX).toBe(COMMENT_PICK_STACK_MAX)
    const keys = Array.from({ length: PIN_STACK_KEYS_MAX + 5 }, (_, i) => ({ key: `p${i}` }))
    expect(stackPart(keys).stack).toEqual(keys.slice(1, PIN_STACK_KEYS_MAX + 1).map(k => k.key))
    expect(stackPart([{ key: 'p0' }])).toEqual({})
    expect(stackPart(undefined)).toEqual({})
  })

  it('024-AC-004 a pick carries words only on a tokened element, with long and crossed when they apply', () => {
    const target = document.createElement('p')
    const sel = { exact: 'beta', prefix: '', suffix: '' }
    expect(wordsPart({ target, sel, long: true, crossed: true }, { token: token(1) })).toEqual({ sel, long: true, crossed: true })
    expect(wordsPart({ target, sel }, { token: token(1) })).toEqual({ sel })
    expect(wordsPart({ target, sel }, {})).toEqual({})
    expect(wordsPart({ target }, { token: token(1) })).toEqual({})
    expect(wordsPart(null, { token: token(1) })).toEqual({})
  })

  it('C-12 (HTML) main\'s state brings each pin\'s words, at most the cap, well formed or left out', () => {
    const good = { exact: 'beta', prefix: 'the ', suffix: '' }
    const icon = (extra: Record<string, unknown>) => ({ key: 'k', token: token(1), count: 1, status: 'open', ...extra })
    const parsed = (value: unknown) => parseCommentState({ mode: false, commentable: true, icons: [icon({ words: value })] })?.icons[0]
    expect(parsed([good])?.words).toEqual([good])
    expect(parsed('nope')?.words).toBeUndefined()
    expect(parsed([]) ).not.toHaveProperty('words')
    expect(
      parsed([
        null,
        { ...good, exact: '' },
        { ...good, exact: 'x'.repeat(401) },
        { ...good, prefix: 'y'.repeat(65) },
        { ...good, suffix: 3 },
        good
      ])?.words
    ).toEqual([good])
    expect(parsed(Array.from({ length: PIN_WORDS_MAX + 3 }, () => good))?.words).toHaveLength(PIN_WORDS_MAX)
  })
})

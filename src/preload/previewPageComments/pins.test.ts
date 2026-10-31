// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pin placement and drawing (docs/designs/comments/html-preview-comments.md §10.5,
 * decisions 20 and 33; J-005, J-014).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PIN_BODY_MIDDLE_Y, PIN_EDGE_INSET_PX, PIN_PATH, PIN_ROW_CAP, PIN_STEP_PX } from './constants'
import { overlaps } from './geometry'
import { drawPin, pinContent, pinName, pinTooltip, placePins, type PinInput } from './pins'

const VIEWPORT = { width: 800, height: 600 }

function input(element: Element, box: PinInput['box'], extra: Partial<PinInput> = {}): PinInput {
  return { key: `k-${element.id}`, count: 1, status: 'open', element, box, ...extra }
}

function elements(...ids: string[]): HTMLElement[] {
  document.body.innerHTML = ids.map(id => `<div id="${id}"></div>`).join('')
  return ids.map(id => document.getElementById(id) as HTMLElement)
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('placePins (J-005)', () => {
  it('puts the tail tip 4 px outward from the top-right corner', () => {
    const [a] = elements('a')
    const [pin] = placePins([input(a, { left: 100, top: 200, width: 50, height: 30 })], VIEWPORT)
    // Tip at (154, 196); the tip sits at (2, 22) inside the 24 px box.
    expect(pin.box).toEqual({ left: 152, top: 174, width: 24, height: 24 })
    expect(pin.content).toBe('lines')
  })

  it('shows a number for 2–9 threads, 9+ from 10, ! for a damaged block, nothing for 0', () => {
    expect(pinContent(1, 'open')).toBe('lines')
    expect(pinContent(2, 'open')).toBe('2')
    expect(pinContent(9, 'open')).toBe('9')
    expect(pinContent(10, 'open')).toBe('9+')
    expect(pinContent(0, 'open')).toBeNull()
    expect(pinContent(0, 'damaged')).toBe('!')
  })

  it('draws nothing for resolved-only (count 0) and off-screen elements', () => {
    const [a, b] = elements('a', 'b')
    const pins = placePins(
      [input(a, { left: 10, top: 50, width: 10, height: 10 }, { count: 0 }), input(b, { left: 10, top: 900, width: 10, height: 10 })],
      VIEWPORT
    )
    expect(pins).toEqual([])
  })

  it('clamps to the visible part of the element and to the viewport, 4 px inside its edges', () => {
    const [a] = elements('a')
    // A huge element whose top-right is off screen: the pin stays at the
    // viewport's top-right corner, fully visible, PIN_EDGE_INSET_PX in from
    // the right and the top (§19 Rev 4 "pins at the right edge").
    const [pin] = placePins([input(a, { left: -50, top: -100, width: 2000, height: 3000 })], VIEWPORT)
    expect(PIN_EDGE_INSET_PX).toBe(4)
    expect(pin.box).toEqual({ left: 800 - 24 - 4, top: 4, width: 24, height: 24 })
  })

  it('C-17 (HTML) moves an overlapping pin left in 26 px steps (24 + 2); the ancestor keeps the corner', () => {
    document.body.innerHTML = '<section id="outer"><p id="inner"></p></section>'
    const outer = document.getElementById('outer') as HTMLElement
    const inner = document.getElementById('inner') as HTMLElement
    const box = { left: 100, top: 200, width: 300, height: 50 }
    // Given descendant first: document order still places the ancestor first.
    const pins = placePins([input(inner, box), input(outer, box)], VIEWPORT)
    expect(pins.map(p => [p.key, p.box.left])).toEqual([
      ['k-outer', 402],
      ['k-inner', 376]
    ])
  })

  it('stops stepping at the left inset', () => {
    const [a, b] = elements('a', 'b')
    const box = { left: 0, top: 200, width: 1, height: 50 }
    const pins = placePins([input(a, box), input(b, box)], VIEWPORT)
    // The tip would put the box at 3: the left inset holds it at 4, and a step
    // of 22 would cross the inset, so the second pin stays put.
    expect(pins.map(p => p.box.left)).toEqual([4, 4])
  })

  it(`L9 C-17 (HTML) a crowded spot keeps ${PIN_ROW_CAP} pins and merges the rest into one stack pin; other rows are not moved`, () => {
    const ids = Array.from({ length: 40 }, (_, i) => `p${i}`)
    const els = elements(...ids)
    const box = { left: 600, top: 200, width: 100, height: 50 }
    const pins = placePins(els.map(el => input(el, box)), VIEWPORT)
    expect(pins.map(p => [p.key, p.box.left, p.content])).toEqual([
      ['k-p0', 702, 'lines'],
      ['k-p1', 702 - PIN_STEP_PX, 'lines'],
      ['k-p2', 702 - 2 * PIN_STEP_PX, 'lines'],
      ['k-p3', 702 - PIN_ROW_CAP * PIN_STEP_PX, '+37']
    ])
    const stack = pins[3]
    expect(stack.members?.map(m => m.key)).toEqual(ids.slice(3).map(id => `k-${id}`))
    expect(pinName(stack, 'p')).toBe('37 more commented elements here. Open.')
    expect(pinTooltip(stack)).toBe('37 more commented elements – click to open')
    const drawn = drawPin(document, undefined, stack, { label: 'p', selected: false })
    expect(drawn.classList.contains('erf-hpc-pin--stack')).toBe(true)
    // A damaged pin merged in makes the stack damaged; a stack shows at most +99.
    const many = elements(...Array.from({ length: 110 }, (_, i) => `q${i}`))
    const crowded = placePins(
      many.map((el, i) => input(el, box, i === 50 ? { status: 'damaged' } : {})),
      VIEWPORT
    )
    expect([crowded[3].content, crowded[3].status]).toEqual(['+99', 'damaged'])
    // A pin in another row is not moved by this crowd.
    const [other] = elements('other')
    const [crowd, below] = placePins([input(els[0], box), input(other, { ...box, top: 400 })], VIEWPORT)
    expect(below.box.left).toBe(crowd.box.left)
  })

  it('scales the box and tip with the theme’s pin size', () => {
    const [a] = elements('a')
    const [pin] = placePins([input(a, { left: 100, top: 200, width: 50, height: 30 })], VIEWPORT, 48)
    expect(pin.box).toEqual({ left: 150, top: 152, width: 48, height: 48 })
  })

  it('places two pins on one element side by side', () => {
    const [a] = elements('a')
    const box = { left: 100, top: 200, width: 50, height: 30 }
    const pins = placePins([input(a, box), input(a, box, { key: 'k-a2' })], VIEWPORT)
    expect(pins.map(p => p.box.left)).toEqual([152, 126])
  })
})

describe('placePins at the edges of the visible viewport (§19 Rev 4 "pins at the right edge")', () => {
  // An 800 × 600 window less 15 px classic scrollbars, as `viewportOf`
  // measures it: the pin must stay left of the vertical one, above the other.
  const VISIBLE = { width: 785, height: 585 }
  const RIGHT_MOST = VISIBLE.width - 24 - PIN_EDGE_INSET_PX
  type PinBox = PinInput['box']
  const inside = (box: PinBox): boolean =>
    box.left >= PIN_EDGE_INSET_PX &&
    box.top >= PIN_EDGE_INSET_PX &&
    box.left + box.width <= VISIBLE.width - PIN_EDGE_INSET_PX &&
    box.top + box.height <= VISIBLE.height - PIN_EDGE_INSET_PX
  /** The drawn bubble: the 20 px body inside the 24 px hit box, which collisions are judged on. */
  const bubble = (box: PinBox): PinBox => ({ left: box.left + 2, top: box.top + 2, width: 20, height: 20 })

  it('keeps a full-width element’s pin inside the visible width, clear of the scrollbar', () => {
    const [doc] = elements('doc')
    // The owner's div.doc: it spans the page, its right edge on the scrollbar's left edge.
    const [pin] = placePins([input(doc, { left: 0, top: 120, width: 785, height: 900 })], VISIBLE)
    expect(pin.box).toEqual({ left: RIGHT_MOST, top: 94, width: 24, height: 24 })
    expect(inside(pin.box)).toBe(true)
  })

  it('clips an element that reaches under the scrollbar (width: 100vw) to the visible width first', () => {
    const [doc] = elements('doc')
    const [pin] = placePins([input(doc, { left: 0, top: 120, width: 800, height: 900 })], VISIBLE)
    expect(pin.box.left).toBe(RIGHT_MOST)
  })

  it('leaves a narrow element in the middle where it was', () => {
    const [a] = elements('a')
    const box = { left: 300, top: 200, width: 120, height: 40 }
    const [withScrollbar] = placePins([input(a, box)], VISIBLE)
    const [without] = placePins([input(a, box)], VIEWPORT)
    expect(withScrollbar.box).toEqual({ left: 422, top: 174, width: 24, height: 24 })
    expect(without.box).toEqual(withScrollbar.box)
  })

  it('gives two stacked full-width elements separate pins', () => {
    const [first, second] = elements('first', 'second')
    // Rows apart: each keeps the clamped corner.
    const apart = placePins(
      [input(first, { left: 0, top: 100, width: 785, height: 60 }), input(second, { left: 0, top: 160, width: 785, height: 400 })],
      VISIBLE
    )
    expect(apart.map(p => [p.box.left, p.box.top])).toEqual([
      [RIGHT_MOST, 74],
      [RIGHT_MOST, 134]
    ])
    // One row (a 10 px band above a section): both clamp to the same spot, so
    // the second steps left of the first – the clamp never makes them overlap.
    const close = placePins(
      [input(first, { left: 0, top: 100, width: 785, height: 10 }), input(second, { left: 0, top: 110, width: 785, height: 400 })],
      VISIBLE
    )
    expect(close.map(p => [p.box.left, p.box.top])).toEqual([
      [RIGHT_MOST, 74],
      [RIGHT_MOST - PIN_STEP_PX, 84]
    ])
    expect(overlaps(bubble(close[0].box), bubble(close[1].box))).toBe(false)
    expect(close.every(p => inside(p.box))).toBe(true)
  })

  it('clamps at the left edge: an element scrolled off sideways keeps its pin 4 px in', () => {
    const [a] = elements('a')
    // Only its last pixel shows: the tip would put the box at 3.
    const [pin] = placePins([input(a, { left: -299, top: 200, width: 300, height: 50 })], VISIBLE)
    expect(pin.box).toEqual({ left: PIN_EDGE_INSET_PX, top: 174, width: 24, height: 24 })
  })

  it('keeps the bottom above a horizontal scrollbar, and draws nothing for an element only under it', () => {
    const [a, b] = elements('a', 'b')
    // Its visible part starts 1 px above the scrollbar: the box stops 4 px above it.
    const [low] = placePins([input(a, { left: 100, top: 584, width: 50, height: 30 })], VISIBLE)
    expect(low.box.top).toBe(VISIBLE.height - 24 - PIN_EDGE_INSET_PX)
    // Behind the scrollbar strip only (585–600 of the 600 px window): not on screen, no pin.
    expect(placePins([input(b, { left: 100, top: 586, width: 50, height: 10 })], VISIBLE)).toEqual([])
  })
})

describe('drawPin (J-014)', () => {
  const pinOf = (count: number, status: 'open' | 'damaged' = 'open') => {
    const [a] = elements('a')
    return placePins([input(a, { left: 100, top: 200, width: 50, height: 30 }, { count, status })], VIEWPORT)[0]
  }

  it('J-014 draws the speech bubble with exactly M2 2H22V17H7L2 22Z', () => {
    const el = drawPin(document, undefined, pinOf(1), { label: 'div#a', selected: false })
    expect(el.querySelector('path')?.getAttribute('d')).toBe(PIN_PATH)
    expect(PIN_PATH).toBe('M2 2H22V17H7L2 22Z')
    expect(el.querySelectorAll('rect')).toHaveLength(2)
    // C-11 (HTML): visual only – no role, no tab stop, no accessible name; the name is kept as data.
    expect(el.getAttribute('role')).toBeNull()
    expect(el.hasAttribute('tabindex')).toBe(false)
    expect(el.getAttribute('aria-label')).toBeNull()
    expect(el.dataset.name).toBe('1 comment on div#a. Open.')
    expect(el.title).toBe('1 comment – click to open')
    expect(el.style.left).toBe('152px')
    expect(el.style.top).toBe('174px')
  })

  it('shows the count, the damaged state and the selected state', () => {
    const many = drawPin(document, undefined, pinOf(12), { label: 'div#a', selected: true })
    const count = many.querySelector('.erf-hpc-pin__count')
    expect(count?.getAttribute('data-text')).toBe('9+')
    expect(count?.classList.contains('erf-hpc-text')).toBe(true)
    expect(count?.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
    // Generated content, never a text node: Find in page would count it (E-022).
    expect(many.textContent).toBe('')
    // A box over the bubble's body (y 2 to 17), so the number sits on its middle, not the whole box's.
    const box = count?.parentElement
    expect(box?.localName).toBe('foreignObject')
    const [y, height] = ['y', 'height'].map(name => Number(box?.getAttribute(name)))
    expect([y, height]).toEqual([2, 15])
    expect(y + height / 2).toBe(PIN_BODY_MIDDLE_Y)
    expect(PIN_BODY_MIDDLE_Y).toBe(9.5)
    expect(many.className).toBe('erf-hpc-pin erf-hpc-pin--selected')
    expect(pinName(pinOf(12), 'div#a')).toBe('12 comments on div#a. Open.')
    expect(pinTooltip(pinOf(3))).toBe('3 comments – click to open')

    const damaged = drawPin(document, undefined, pinOf(0, 'damaged'), { label: 'div#a', selected: false })
    expect(damaged.querySelector('.erf-hpc-pin__count')?.getAttribute('data-text')).toBe('!')
    expect(damaged.className).toBe('erf-hpc-pin erf-hpc-pin--damaged')
    expect(damaged.dataset.name).toBe('Damaged comment on div#a. Open.')
    expect(damaged.title).toBe('Damaged comment – click to open')
  })

  it('rebuilds the glyph only when the content changes', () => {
    const el = drawPin(document, undefined, pinOf(2), { label: 'div#a', selected: false })
    const svg = el.firstElementChild
    expect(drawPin(document, el, pinOf(2), { label: 'div#a', selected: false }).firstElementChild).toBe(svg)
    expect(drawPin(document, el, pinOf(3), { label: 'div#a', selected: false }).firstElementChild).not.toBe(svg)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pin placement and drawing (docs/designs/html-preview-comments.md §10.5,
 * decisions 20 and 33; J-005, J-014).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PIN_MAX_STEPS, PIN_PATH, PIN_STEP_PX } from './constants'
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

  it('clamps to the visible part of the element and to the viewport', () => {
    const [a] = elements('a')
    // A huge element whose top-right is off screen: the pin stays at the
    // viewport's top-right corner, fully visible.
    const [pin] = placePins([input(a, { left: -50, top: -100, width: 2000, height: 3000 })], VIEWPORT)
    expect(pin.box).toEqual({ left: 776, top: 0, width: 24, height: 24 })
  })

  it('moves an overlapping pin left in 22 px steps; the ancestor keeps the corner', () => {
    document.body.innerHTML = '<section id="outer"><p id="inner"></p></section>'
    const outer = document.getElementById('outer') as HTMLElement
    const inner = document.getElementById('inner') as HTMLElement
    const box = { left: 100, top: 200, width: 300, height: 50 }
    // Given descendant first: document order still places the ancestor first.
    const pins = placePins([input(inner, box), input(outer, box)], VIEWPORT)
    expect(pins.map(p => [p.key, p.box.left])).toEqual([
      ['k-outer', 402],
      ['k-inner', 380]
    ])
  })

  it('stops stepping at the left edge', () => {
    const [a, b] = elements('a', 'b')
    const box = { left: 0, top: 200, width: 1, height: 50 }
    const pins = placePins([input(a, box), input(b, box)], VIEWPORT)
    expect(pins.map(p => p.box.left)).toEqual([3, 3])
  })

  it(`L9 keeps the collision search bounded: at most ${PIN_MAX_STEPS} steps, against its own row only`, () => {
    const ids = Array.from({ length: 40 }, (_, i) => `p${i}`)
    const els = elements(...ids)
    const box = { left: 600, top: 200, width: 100, height: 50 }
    const pins = placePins(els.map(el => input(el, box)), VIEWPORT)
    const lefts = pins.map(p => p.box.left)
    // The first steps left; from the ninth on they stay put, overlapping.
    expect(Math.min(...lefts)).toBe(702 - PIN_MAX_STEPS * PIN_STEP_PX)
    expect(lefts.filter(left => left === 702 - PIN_MAX_STEPS * PIN_STEP_PX).length).toBe(40 - PIN_MAX_STEPS)
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
    expect(pins.map(p => p.box.left)).toEqual([152, 130])
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
    expect(el.getAttribute('role')).toBe('button')
    expect(el.tabIndex).toBe(-1)
    expect(el.getAttribute('aria-label')).toBe('1 comment on div#a. Open.')
    expect(el.title).toBe('1 comment – click to open')
    expect(el.style.left).toBe('152px')
    expect(el.style.top).toBe('174px')
  })

  it('shows the count, the damaged state and the selected state', () => {
    const many = drawPin(document, undefined, pinOf(12), { label: 'div#a', selected: true })
    expect(many.querySelector('text')?.textContent).toBe('9+')
    // Centred on the bubble's body (y 2 to 17), not on the whole box with its tail.
    expect(many.querySelector('text')?.getAttribute('y')).toBe('9.5')
    expect(many.className).toBe('erf-hpc-pin erf-hpc-pin--selected')
    expect(pinName(pinOf(12), 'div#a')).toBe('12 comments on div#a. Open.')
    expect(pinTooltip(pinOf(3))).toBe('3 comments – click to open')

    const damaged = drawPin(document, undefined, pinOf(0, 'damaged'), { label: 'div#a', selected: false })
    expect(damaged.querySelector('text')?.textContent).toBe('!')
    expect(damaged.className).toBe('erf-hpc-pin erf-hpc-pin--damaged')
    expect(damaged.getAttribute('aria-label')).toBe('Damaged comment on div#a. Open.')
    expect(damaged.title).toBe('Damaged comment – click to open')
  })

  it('rebuilds the glyph only when the content changes', () => {
    const el = drawPin(document, undefined, pinOf(2), { label: 'div#a', selected: false })
    const svg = el.firstElementChild
    expect(drawPin(document, el, pinOf(2), { label: 'div#a', selected: false }).firstElementChild).toBe(svg)
    expect(drawPin(document, el, pinOf(3), { label: 'div#a', selected: false }).firstElementChild).not.toBe(svg)
  })
})

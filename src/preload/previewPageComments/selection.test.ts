// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Selection comments through the controller and the guards (spec 024
 * 024-FR-004, 024-AC-004 preload half; OD-01; comments-v2 C-11, C-12, C-16,
 * C-17): the right-click outside comment mode, the drag that selects and its
 * Comment button, the comment marks and their clicks, and pins that are
 * visual only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMENT_PICK_CHANNEL, TOKEN_ATTRIBUTE } from './constants'
import { COMMENT_BUTTON_TEXT } from './overlayView'
import { byId, createHarness, drawnText, microtasks, mount, token, userKey, userMouse, type Harness } from './__test-helpers__/harness'

const T = TOKEN_ATTRIBUTE
const PAGE =
  `<main id="main" ${T}="${token(1)}">` +
  `<p id="ship" ${T}="${token(2)}">We ship the beta to ten customers by Friday.</p>` +
  `<p id="other" ${T}="${token(3)}">Other text</p>` +
  '</main>'
const BOXES = {
  main: { left: 0, top: 0, width: 800, height: 600 },
  ship: { left: 0, top: 100, width: 600, height: 20 },
  other: { left: 0, top: 200, width: 600, height: 20 }
}
const WORDS = { exact: 'ten customers', prefix: 'We ship the beta to ', suffix: ' by Friday.' }
/** Where the selection's (and a mark's) one line is drawn. */
const LINE = { left: 160, top: 100, width: 104, height: 20 }

let h: Harness
const realRects = Range.prototype.getClientRects

beforeEach(async () => {
  h = createHarness()
  mount(PAGE, BOXES, h.doubles)
  await microtasks()
  h.controller.documentReady()
  // jsdom lays nothing out: every range is drawn as one line.
  Range.prototype.getClientRects = function getClientRects() {
    const rect = { ...LINE, x: LINE.left, y: LINE.top, right: LINE.left + LINE.width, bottom: LINE.top + LINE.height }
    return [{ ...rect, toJSON: () => rect }] as unknown as DOMRectList
  }
})

afterEach(() => {
  Range.prototype.getClientRects = realRects
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
  h.dispose()
})

const picks = (): Array<Record<string, unknown>> =>
  (h.sent(COMMENT_PICK_CHANNEL) as Array<Record<string, unknown>>).filter(p => p.kind !== 'step')

/** Select the words "ten customers" in #ship. */
function selectWords(): void {
  const node = byId('ship').firstChild as Text
  const range = document.createRange()
  range.setStart(node, 20)
  range.setEnd(node, 33)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
}

const overlay = (selector: string): HTMLElement[] => [...(h.root()?.querySelectorAll<HTMLElement>(selector) ?? [])]

describe('OD-01 the right-click outside comment mode', () => {
  it('OD-01 024-AC-004 (a) on selected words: after the page had its say, a context pick with the words on their paragraph', async () => {
    h.state({ mode: false })
    selectWords()
    const event = userMouse(byId('ship'), 'contextmenu', { x: 170, y: 105, button: 2 })
    // Nothing is sent while the event is still the page's.
    expect(picks()).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    await vi.waitFor(() => expect(picks()).toHaveLength(1))
    expect(picks()[0]).toMatchObject({ kind: 'context', via: 'pointer', token: token(2), tag: 'p', sel: WORDS })
  })

  it('OD-01 with no selection: a context pick on the element under the pointer, with no words', async () => {
    h.state({ mode: false })
    userMouse(byId('other'), 'contextmenu', { x: 10, y: 205, button: 2 })
    await vi.waitFor(() => expect(picks()).toHaveLength(1))
    expect(picks()[0]).toMatchObject({ kind: 'context', token: token(3) })
    expect(picks()[0]).not.toHaveProperty('sel')
  })

  it('OD-01 a page that cancels its own right-click keeps it: nothing is sent', async () => {
    h.state({ mode: false })
    const cancel = (event: Event): void => event.preventDefault()
    window.addEventListener('contextmenu', cancel)
    userMouse(byId('other'), 'contextmenu', { x: 10, y: 205, button: 2 })
    window.removeEventListener('contextmenu', cancel)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(picks()).toEqual([])
  })

  it('OD-01 a forged right-click, or one in a page main cannot comment in, sends nothing', async () => {
    h.state({ mode: false })
    byId('other').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    h.state({ mode: false, commentable: false })
    userMouse(byId('other'), 'contextmenu', { x: 10, y: 205, button: 2 })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(picks()).toEqual([])
  })
})

describe('024-AC-004 (b) comment mode: a drag selects, a click picks (C-16)', () => {
  it('024-AC-004 (b) C-16 (HTML) a drag that selects shows the Comment button; its click opens the window on the words', () => {
    h.state({ mode: true })
    userMouse(byId('ship'), 'mousedown', { x: 160, y: 110 })
    selectWords()
    userMouse(byId('ship'), 'click', { x: 264, y: 110 })
    expect(picks()).toEqual([])
    h.controller.renderNow()
    const [button] = overlay('.erf-hpc-button')
    expect(button.classList.contains('erf-hpc-hidden')).toBe(false)
    expect(button.localName).toBe('button')
    expect(button.tabIndex).toBe(-1)
    expect(drawnText(button)).toBe(COMMENT_BUTTON_TEXT)
    // Above the end of the selection's last line, inside the viewport.
    expect(Number.parseFloat(button.style.top)).toBeLessThan(LINE.top)
    const box = { x: Number.parseFloat(button.style.left) + 4, y: Number.parseFloat(button.style.top) + 4 }
    // Only a primary click acts: pressing it alone sends nothing.
    userMouse(h.host()!, 'mousedown', box)
    expect(picks()).toEqual([])
    userMouse(h.host()!, 'click', box)
    expect(picks()).toEqual([expect.objectContaining({ kind: 'open', token: token(2), sel: WORDS })])
  })

  it('024-AC-004 (c) a click with no selection still picks the element, with no words', () => {
    h.state({ mode: true })
    userMouse(byId('other'), 'mousedown', { x: 10, y: 205 })
    userMouse(byId('other'), 'click', { x: 11, y: 205 })
    expect(picks()).toEqual([expect.objectContaining({ kind: 'open', token: token(3) })])
    expect(picks()[0]).not.toHaveProperty('sel')
  })

  it('C-16 (HTML) Enter, and the menu, act on the words while the Comment button shows', () => {
    h.state({ mode: true })
    userMouse(byId('ship'), 'mousedown', { x: 160, y: 110 })
    selectWords()
    userMouse(byId('ship'), 'click', { x: 264, y: 110 })
    userKey({ key: 'Enter', code: 'Enter' })
    expect(picks().at(-1)).toMatchObject({ kind: 'open', via: 'keyboard', sel: WORDS })
  })

  it('024-AC-004 (a) a right-click on selected words in comment mode is the selection menu', () => {
    h.state({ mode: true })
    selectWords()
    userMouse(byId('ship'), 'contextmenu', { x: 170, y: 105, button: 2 })
    expect(picks()).toEqual([expect.objectContaining({ kind: 'menu', token: token(2), sel: WORDS })])
  })

  it('C-16 (HTML) turning the mode on with words selected only turns it on, around them, with the Comment button', () => {
    selectWords()
    h.state({ mode: true })
    expect(picks()).toEqual([])
    h.controller.renderNow()
    expect(overlay('.erf-hpc-button')[0].classList.contains('erf-hpc-hidden')).toBe(false)
    // The button goes once the selection does, and with the mode.
    window.getSelection()!.removeAllRanges()
    h.controller.renderNow()
    expect(overlay('.erf-hpc-button')[0].classList.contains('erf-hpc-hidden')).toBe(true)
  })
})

describe('C-12, C-17 and C-11 (HTML) marks and pins', () => {
  const withWords = { key: 'p1', token: token(2), count: 1, status: 'open', words: [WORDS] }

  it('C-12 (HTML) the words of an open thread are marked in the overlay, never in the page', () => {
    const before = byId('ship').outerHTML
    h.state({ showIcons: true, icons: [withWords] })
    const marks = overlay('.erf-hpc-mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].style.left).toBe(`${LINE.left}px`)
    expect(marks[0].parentElement?.getAttribute('aria-hidden')).toBe('true')
    expect(byId('ship').outerHTML).toBe(before)
    // Pins and marks hidden together (the icons toggle).
    h.state({ showIcons: false, icons: [withWords] })
    expect(overlay('.erf-hpc-mark')).toHaveLength(0)
  })

  it('C-17 (HTML) in comment mode a click on a mark opens its threads like the pin; outside it the page keeps the click', () => {
    h.state({ mode: true, showIcons: true, icons: [withWords] })
    userMouse(h.host()!, 'click', { x: LINE.left + 10, y: LINE.top + 10 })
    expect(picks()).toEqual([expect.objectContaining({ kind: 'icon', key: 'p1' })])
    expect(overlay('.erf-hpc-marks--clickable')).toHaveLength(1)
    h.state({ mode: false, showIcons: true, icons: [withWords] })
    expect(overlay('.erf-hpc-marks--clickable')).toHaveLength(0)
    expect(h.controller.overlayHit({ x: LINE.left + 10, y: LINE.top + 10 })).toBeNull()
  })

  it('C-17 (HTML) a click on a stack pin in comment mode names every pin merged into it', () => {
    const icons = Array.from({ length: 5 }, (_, i) => ({ key: `p${i}`, token: token(2), count: 1, status: 'open' }))
    h.state({ mode: true, showIcons: true, icons })
    const [stack] = overlay('.erf-hpc-pin--stack')
    expect(stack.dataset.name).toBe('2 more commented elements here. Open.')
    userMouse(h.host()!, 'click', { x: Number.parseFloat(stack.style.left) + 5, y: Number.parseFloat(stack.style.top) + 5 })
    expect(picks()).toEqual([expect.objectContaining({ kind: 'icon', key: 'p3', stack: ['p4'] })])
  })

  it('C-11 (HTML) pins are visual only: no role, name or tab stop, in an aria-hidden layer', () => {
    h.state({ showIcons: true, icons: [withWords] })
    const [pin] = overlay('.erf-hpc-pin')
    expect(pin.getAttribute('role')).toBeNull()
    expect(pin.getAttribute('aria-label')).toBeNull()
    expect(pin.hasAttribute('tabindex')).toBe(false)
    expect(pin.parentElement?.getAttribute('aria-hidden')).toBe('true')
    expect(h.root()?.querySelector('[role="button"]')).toBeNull()
  })
})

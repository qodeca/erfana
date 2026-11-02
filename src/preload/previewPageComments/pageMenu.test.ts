// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard's menu outside comment mode (K-1, I-18; menu matrix § 4). No
 * mouse anywhere here: the page handles the key itself, because macOS fires no
 * `contextmenu` for it, and a window's real events are what these press.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMENT_PICK_CHANNEL, TOKEN_ATTRIBUTE } from './constants'
import { byId, createHarness, microtasks, mount, token, userKey, userMouse, type Harness } from './__test-helpers__/harness'

const T = TOKEN_ATTRIBUTE
const PAGE =
  `<main id="main" ${T}="${token(1)}">` +
  `<p id="ship" ${T}="${token(2)}">We ship the beta to ten customers by Friday.</p>` +
  `<button id="buy" ${T}="${token(3)}">Buy now</button>` +
  '</main>'
const BOXES = {
  main: { left: 0, top: 0, width: 800, height: 600 },
  ship: { left: 0, top: 100, width: 600, height: 20 },
  buy: { left: 10, top: 300, width: 100, height: 30 }
}
const SHIFT_F10 = { key: 'F10', code: 'F10', shiftKey: true }
const MENU_KEY = { key: 'ContextMenu', code: 'ContextMenu' }
const WORDS = { exact: 'ten customers', prefix: 'We ship the beta to ', suffix: ' by Friday.' }
/** Where the selection's one line is drawn. */
const LINE = { left: 160, top: 100, width: 104, height: 20 }

let h: Harness
const realRects = Range.prototype.getClientRects

beforeEach(async () => {
  h = createHarness()
  mount(PAGE, BOXES, h.doubles)
  await microtasks()
  h.controller.documentReady()
  h.state({ mode: false })
  Range.prototype.getClientRects = function getClientRects() {
    const rect = { ...LINE, x: LINE.left, y: LINE.top, right: LINE.left + LINE.width, bottom: LINE.top + LINE.height }
    return [{ ...rect, toJSON: () => rect }] as unknown as DOMRectList
  }
})

afterEach(() => {
  Range.prototype.getClientRects = realRects
  window.getSelection()?.removeAllRanges()
  ;(document.activeElement as HTMLElement | null)?.blur()
  vi.restoreAllMocks()
  h.dispose()
})

const picks = (): Array<Record<string, unknown>> =>
  (h.sent(COMMENT_PICK_CHANNEL) as Array<Record<string, unknown>>).filter(p => p.kind !== 'step')

/** The page has had its say: the pick goes out, if it goes, after the dispatch. */
const afterDispatch = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('K-1 the menu key outside comment mode', () => {
  it.each([
    ['Shift+F10', SHIFT_F10],
    ['the Menu key', MENU_KEY]
  ])('K-1 I-18 %s with nothing focused: a keyboard pick on the element at the viewport centre', async (_name, key) => {
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => byId('ship'))
    userKey(key)
    await afterDispatch()
    expect(picks()).toEqual([expect.objectContaining({ kind: 'context', via: 'keyboard', token: token(2), tag: 'p' })])
    expect(picks()[0].screen).toBeUndefined()
    expect(document.elementFromPoint).toHaveBeenCalledWith(window.innerWidth / 2, window.innerHeight / 2)
  })

  it('I-18 the pointer is not the start: it may be anywhere, a keyboard menu is about the viewport centre', async () => {
    h.controller.pointerAt({ x: 5, y: 310 })
    const under = vi.spyOn(document, 'elementFromPoint').mockImplementation((x, y) => (x === 5 && y === 310 ? byId('buy') : byId('ship')))
    userKey(SHIFT_F10)
    await afterDispatch()
    expect(under).toHaveBeenCalledTimes(1)
    expect(picks()[0]).toMatchObject({ kind: 'context', via: 'keyboard', token: token(2) })
  })

  it('I-18 the focused element is the target, and the menu opens at it', async () => {
    byId('buy').focus()
    userKey(SHIFT_F10, byId('buy'))
    await afterDispatch()
    expect(picks()).toEqual([expect.objectContaining({ kind: 'context', via: 'keyboard', token: token(3), tag: 'button', point: { x: 14, y: 304 } })])
  })

  it('I-18 the bare margin at the centre is no target: the first element, as the picker starts', async () => {
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => document.body)
    userKey(SHIFT_F10)
    await afterDispatch()
    expect(picks()[0]).toMatchObject({ kind: 'context', via: 'keyboard', token: token(1) })
  })

  it('K-1 with words selected the menu is about them, at their last line', async () => {
    const node = byId('ship').firstChild as Text
    const range = document.createRange()
    range.setStart(node, 20)
    range.setEnd(node, 33)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    userKey(SHIFT_F10)
    await afterDispatch()
    expect(picks()).toEqual([expect.objectContaining({ kind: 'context', via: 'keyboard', token: token(2), sel: WORDS, point: { x: 160, y: 120 } })])
  })

  it('OD-01 a page that cancels the key keeps it: no menu', async () => {
    window.addEventListener('keydown', cancel)
    userKey(SHIFT_F10)
    await afterDispatch()
    window.removeEventListener('keydown', cancel)
    expect(picks()).toEqual([])
  })

  it('OD-01 a page that cancels the contextmenu the key also fires keeps it: no menu', async () => {
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => byId('ship'))
    window.addEventListener('contextmenu', cancel)
    userKey(SHIFT_F10)
    userMouse(byId('ship'), 'contextmenu', { button: 0 })
    await afterDispatch()
    window.removeEventListener('contextmenu', cancel)
    expect(picks()).toEqual([])
  })

  it('K-1 the contextmenu the key also fires is the same press: one menu, on the keyboard route', async () => {
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => byId('ship'))
    userKey(SHIFT_F10)
    userMouse(byId('ship'), 'contextmenu', { button: 0 })
    await afterDispatch()
    h.clock.now += 100
    userMouse(byId('ship'), 'contextmenu', { button: 0 })
    await afterDispatch()
    expect(picks()).toEqual([expect.objectContaining({ kind: 'context', via: 'keyboard' })])
  })

  it('K-1 a right-click a moment later is a right-click again', async () => {
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => byId('ship'))
    userKey(SHIFT_F10)
    await afterDispatch()
    h.clock.now += 2_000
    userMouse(byId('buy'), 'contextmenu', { x: 20, y: 310, button: 2 })
    await afterDispatch()
    expect(picks().map(p => p.via)).toEqual(['keyboard', 'pointer'])
  })

  it('SEC-03 a key the page made itself sends nothing', async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { ...SHIFT_F10, bubbles: true, cancelable: true }))
    await afterDispatch()
    expect(picks()).toEqual([])
  })

  it('M-09 nothing is sent for a frame that cannot hold comments, and any other key is the page\'s', async () => {
    userKey({ key: 'F10', code: 'F10' })
    userKey({ ...MENU_KEY, altKey: true })
    h.state({ mode: false, commentable: false })
    userKey(SHIFT_F10)
    await afterDispatch()
    expect(picks()).toEqual([])
  })

  it('SEC-02 the key stays the page\'s: it is neither stopped nor cancelled', async () => {
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    const event = userKey(SHIFT_F10)
    document.removeEventListener('keydown', seen)
    await afterDispatch()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })
})

function cancel(event: Event): void {
  event.preventDefault()
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard picker and the hover label (docs/designs/comments/html-preview-comments.md
 * §10.2, §10.8, §10.10; J-001, J-002, J-010).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMENT_PICK_CHANNEL, TOKEN_ATTRIBUTE } from './constants'
import { byId, createHarness, dispatchTrusted, drawnText, lastStep, microtasks, mount, token, userKey, userMouse, userMove, type Harness } from './__test-helpers__/harness'

const T = TOKEN_ATTRIBUTE
const PAGE = [
  `<main id="main" ${T}="${token(1)}">`,
  `<h1 id="title" ${T}="${token(2)}">Title</h1>`,
  `<ul id="list" ${T}="${token(3)}"><li id="one" ${T}="${token(4)}">one</li><li id="two" ${T}="${token(5)}">two</li></ul>`,
  `<script id="js">1</script>`,
  `<p id="last" ${T}="${token(6)}">last</p>`,
  '</main>',
  `<footer id="foot" ${T}="${token(7)}">foot</footer>`
].join('')
const BOXES = {
  main: { left: 0, top: 0, width: 800, height: 500 },
  title: { left: 0, top: 0, width: 800, height: 40 },
  list: { left: 0, top: 50, width: 800, height: 80 },
  one: { left: 0, top: 50, width: 800, height: 40 },
  two: { left: 0, top: 90, width: 800, height: 40 },
  last: { left: 0, top: 300, width: 800, height: 40 },
  foot: { left: 0, top: 520, width: 800, height: 40 }
}

let h: Harness

beforeEach(async () => {
  h = createHarness()
  mount(PAGE, BOXES, h.doubles)
  h.doubles.setBox(document.body, { left: 0, top: 0, width: 800, height: 600 })
  await microtasks()
  h.controller.documentReady()
  h.state({ mode: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  h.dispose()
})

const label = (): string | undefined => drawnText(h.root()?.querySelector('.erf-hpc-label'))
/** What the window's live region is told to say, through main – the page holds no screen-reader text. */
const spoken = (): string | undefined => lastStep(h, COMMENT_PICK_CHANNEL)
const picks = (): Array<Record<string, unknown>> =>
  (h.sent(COMMENT_PICK_CHANNEL) as Array<Record<string, unknown>>).filter(p => p.kind !== 'step')

describe('hover label (J-001)', () => {
  it('J-001 outlines the element under the pointer and labels it with its size', () => {
    userMove(10, 60)
    h.controller.renderNow()
    expect(label()).toBe('li#one800×40')
    const outline = h.root()?.querySelector('.erf-hpc-outline') as HTMLElement
    expect(outline.style.left).toBe('0px')
    expect(outline.style.top).toBe('50px')
    expect(outline.style.width).toBe('800px')
  })

  it('J-001 adds “ · script” for a JS-built element and the comment count of its pin', () => {
    const built = document.createElement('span')
    built.id = 'built'
    byId('last').append(built)
    h.doubles.setBox(built, { left: 10, top: 305, width: 50, height: 20 })
    userMove(20, 310)
    h.controller.renderNow()
    expect(label()).toBe('span#built · script50×20')

    h.state({ mode: true, showIcons: true, icons: [{ key: 'k', token: token(4), count: 2, status: 'open' }] })
    userMove(10, 60)
    h.controller.renderNow()
    expect(label()).toBe('li#one · 2 comments800×40')
  })

  it('places the label above the element, below it at the viewport top, and inside a huge one', () => {
    userMove(10, 310)
    h.controller.renderNow()
    const el = h.root()?.querySelector('.erf-hpc-label') as HTMLElement
    const height = 11 * 1.4 + 2
    expect(el.style.top).toBe(`${300 - height - 2}px`)
    userMove(10, 10)
    h.controller.renderNow()
    expect(el.style.top).toBe('42px')
    h.doubles.setBox(byId('main'), { left: 0, top: -50, width: 800, height: 5000 })
    userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    expect(el.style.top).toBe('2px')
  })
})

describe('Alt+↑ / Alt+↓ (J-002)', () => {
  it('J-002 Alt+↑ goes to the parent, Alt+↓ back down the remembered path', () => {
    userMove(10, 100) // li#two
    userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    expect(spoken()).toBe('showing ul#list')
    userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    expect(spoken()).toBe('showing main#main')
    userKey({ key: 'ArrowDown', code: 'ArrowDown', altKey: true })
    expect(spoken()).toBe('showing ul#list')
    userKey({ key: 'ArrowDown', code: 'ArrowDown', altKey: true })
    expect(spoken()).toBe('showing li#two')
    // Off the remembered path: the first child.
    userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    userKey({ key: 'Tab' })
    expect(spoken()).toBe('showing footer#foot')
  })

  it('J-002 stops at a leaf (“No child elements”) and at <body> (“Top of page”)', () => {
    userMove(10, 305)
    userKey({ key: 'ArrowDown', code: 'ArrowDown', altKey: true })
    expect(spoken()).toBe('no-child')
    userMove(10, 60)
    for (let i = 0; i < 4; i += 1) userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    expect(spoken()).toBe('top')
    expect(picks()).toEqual([])
  })

  it('in a frame, Alt+↑ from <body> asks main to move to the <iframe> in the parent', async () => {
    h.dispose()
    h = createHarness({ isTop: false })
    mount(PAGE, BOXES, h.doubles)
    h.doubles.setBox(document.body, { left: 0, top: 0, width: 800, height: 600 })
    await microtasks()
    h.controller.documentReady()
    h.state({ mode: true })
    userMove(10, 60)
    for (let i = 0; i < 4; i += 1) userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    expect(picks()).toEqual([{ kind: 'parent', via: 'keyboard', view: expect.any(Object) }])
  })
})

describe('keyboard picker (J-010)', () => {
  it('J-010 starts on the hovered element, else at the viewport centre, and Tab walks the level', () => {
    // No pointer yet: the element at the centre of the 1024 × 768 test viewport.
    vi.spyOn(document, 'elementFromPoint').mockImplementationOnce(() => byId('title'))
    userKey({ key: 'Tab' })
    expect(spoken()).toBe('showing ul#list')
    userKey({ key: 'Tab' })
    // <script> is skipped.
    expect(spoken()).toBe('showing p#last')
    userKey({ key: 'Tab' })
    expect(spoken()).toBe('showing footer#foot')
    userKey({ key: 'Tab', shiftKey: true })
    expect(spoken()).toBe('showing main#main')
    // Each move scrolls the element into view.
    expect(h.doubles.scrolledIntoView.at(-1)).toEqual({
      element: byId('main'),
      options: { block: 'nearest', inline: 'nearest' }
    })
  })

  it('J-010 Tab at the end of a level climbs to the parent’s next sibling, and stops at the last one', () => {
    userMove(10, 100) // li#two, the last item
    userKey({ key: 'Tab' })
    expect(spoken()).toBe('showing p#last')
    userMove(10, 530)
    userKey({ key: 'Tab' })
    expect(spoken()).toBe('showing p#last')
  })

  it('J-010 Enter opens, Shift+F10 and the Menu key open the menu – keyboard picks at the element + 4 px', () => {
    userMove(10, 60)
    userKey({ key: 'Enter' })
    userKey({ key: 'F10', shiftKey: true })
    userKey({ key: 'ContextMenu' })
    expect(picks()).toEqual([
      expect.objectContaining({ kind: 'open', via: 'keyboard', token: token(4), point: { x: 4, y: 54 } }),
      expect.objectContaining({ kind: 'menu', via: 'keyboard', token: token(4), point: { x: 4, y: 54 } }),
      expect.objectContaining({ kind: 'menu', via: 'keyboard', token: token(4), point: { x: 4, y: 54 } })
    ])
    expect(picks().every(p => p.screen === undefined)).toBe(true)
    // The contextmenu event the Menu key also fires does not pick a second time.
    h.clock.now += 100
    userMouse(byId('one'), 'contextmenu', { button: 0 })
    expect(picks()).toHaveLength(3)
    h.clock.now += 2_000
    userMouse(byId('one'), 'contextmenu', { button: 2 })
    expect(picks()).toHaveLength(4)
  })

  it('paints the picked element selected before the pick goes out (the fresh still, R3-6)', () => {
    userMove(10, 60)
    let selectedWhenSent: boolean | undefined
    h.send.mockImplementation(() => {
      selectedWhenSent = h.root()?.querySelector('.erf-hpc-outline')?.classList.contains('erf-hpc-outline--selected')
    })
    userKey({ key: 'Enter' })
    expect(selectedWhenSent).toBe(true)
    // The next pointer move ends the selection.
    userMove(10, 100)
    h.controller.renderNow()
    expect(h.root()?.querySelector('.erf-hpc-outline')?.classList.contains('erf-hpc-outline--selected')).toBe(false)
  })

  it('does nothing when there is nowhere to start', () => {
    const empty = vi.spyOn(document, 'elementFromPoint').mockReturnValue(null)
    Object.defineProperty(document, 'body', { configurable: true, get: () => null })
    try {
      userKey({ key: 'Tab' }, document.documentElement)
      expect(picks()).toEqual([])
    } finally {
      delete (document as unknown as Record<string, unknown>).body
      empty.mockRestore()
    }
  })
})

describe('picker edges', () => {
  it('Alt+↓ with no remembered path goes to the first child that can be shown', () => {
    vi.spyOn(document, 'elementFromPoint').mockImplementationOnce(() => byId('title'))
    userKey({ key: 'Tab' })
    expect(spoken()).toBe('showing ul#list')
    userKey({ key: 'ArrowDown', code: 'ArrowDown', altKey: true })
    expect(spoken()).toBe('showing li#one')
    // A hidden first child is passed over (the pointer starts a fresh path).
    h.doubles.setVisible(byId('title'), false)
    userMove(10, 200) // main itself
    userKey({ key: 'ArrowDown', code: 'ArrowDown', altKey: true })
    expect(spoken()).toBe('showing ul#list')
  })

  it('Shift+Tab passes over what cannot be shown, too', () => {
    userMove(10, 305) // p#last
    userKey({ key: 'Tab', shiftKey: true })
    expect(spoken()).toBe('showing ul#list')
  })

  it('keeps the keyboard’s element when the pointer leaves the frame, and drops a hovered one', () => {
    userMove(10, 60)
    userKey({ key: 'Tab' })
    dispatchTrusted(document, new MouseEvent('pointerout', { bubbles: true, relatedTarget: null }))
    h.controller.renderNow()
    expect(label()).toBe('li#two800×40')

    userMove(10, 305)
    dispatchTrusted(document, new MouseEvent('pointerout', { bubbles: true, relatedTarget: null }))
    h.controller.renderNow()
    expect(h.root()?.querySelector('.erf-hpc-label')?.classList.contains('erf-hpc-hidden')).toBe(true)
  })

  it('a pin under the pointer stands for its element', () => {
    h.state({ mode: true, showIcons: true, icons: [{ key: 'k', token: token(6), count: 1, status: 'open' }] })
    const pin = h.root()?.querySelector('.erf-hpc-pin') as HTMLElement
    userMove(Number.parseFloat(pin.style.left) + 12, Number.parseFloat(pin.style.top) + 12, h.host() as HTMLElement)
    h.controller.renderNow()
    expect(label()).toBe('p#last · 1 comment800×40')
  })

  it('starts at the viewport centre when nothing is under the pointer', () => {
    const at = vi.spyOn(document, 'elementFromPoint')
    at.mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValueOnce(byId('title'))
    userMove(10, 60)
    userKey({ key: 'Tab' })
    expect(spoken()).toBe('showing ul#list')
  })

  it('works in a document without a <body>', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.documentElement)
    Object.defineProperty(document, 'body', { configurable: true, get: () => null })
    try {
      userKey({ key: 'Tab' }, document.documentElement)
      userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true }, document.documentElement)
      expect(spoken()).toBe('top')
    } finally {
      delete (document as unknown as Record<string, unknown>).body
    }
  })

  it('picks nothing in a frame that cannot take comments, and at most 5 per second elsewhere', () => {
    h.controller.applyState({ mode: true })
    userMove(10, 60)
    userKey({ key: 'Enter' })
    expect(picks()).toEqual([])

    h.state({ mode: true })
    userMove(10, 60)
    for (let i = 0; i < 8; i += 1) userKey({ key: 'Enter' })
    expect(picks()).toHaveLength(5)
    h.clock.now += 1_000
    userKey({ key: 'Enter' })
    expect(picks()).toHaveLength(6)
  })

  it('ignores a pointer move the page made', () => {
    userMove(10, 60)
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 305 }))
    h.controller.renderNow()
    expect(label()).toBe('li#one800×40')
  })
})

describe('a pick’s menu or window holds the picker on its element (macOS: the view hides under the pointer)', () => {
  /** A leave with no `relatedTarget`: the pointer left the page – or the view hid under it. */
  const leave = (): void => dispatchTrusted(document, new MouseEvent('pointerout', { bubbles: true, relatedTarget: null }))
  /** The view hidden behind its still frame, or shown again, as Chromium reports it to the page. */
  const pageHidden = (hidden: boolean): void => {
    if (hidden) Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    else delete (document as unknown as Record<string, unknown>).visibilityState
    dispatchTrusted(document, new Event('visibilitychange'))
  }
  const outlineGone = (): boolean => h.root()?.querySelector('.erf-hpc-label')?.classList.contains('erf-hpc-hidden') === true
  const altUp = (): void => void userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).visibilityState
  })

  it.each([
    ['Enter', () => void userKey({ key: 'Enter' })],
    ['a click', () => void userMouse(byId('one'), 'click', { x: 10, y: 60, button: 0 })],
    ['a right-click', () => void userMouse(byId('one'), 'contextmenu', { x: 10, y: 60, button: 2 })]
  ])('hover → %s → window open → the leave on hide → window closed: Alt+↑ starts from the pick’s parent', (_, pick) => {
    userMove(10, 60) // li#one
    pick()
    expect(picks()).toHaveLength(1)
    pageHidden(true)
    leave()
    h.controller.renderNow()
    expect(label()).toBe('li#one800×40')
    pageHidden(false)
    altUp()
    expect(spoken()).toBe('showing ul#list')
  })

  it('holds it when the leave comes before the page is hidden, and through a move that lands while it is', () => {
    userMove(10, 60)
    userKey({ key: 'Enter' })
    leave()
    pageHidden(true)
    userMove(10, 60)
    leave()
    pageHidden(false)
    h.controller.renderNow()
    expect(label()).toBe('li#one800×40')
    altUp()
    expect(spoken()).toBe('showing ul#list')
  })

  it('lets go at the first move on the shown page: a normal leave clears the outline again', () => {
    userMove(10, 60)
    userKey({ key: 'Enter' })
    // The pointer was not over the view when it hid: no leave, only the hide.
    pageHidden(true)
    pageHidden(false)
    userMove(12, 62) // still li#one
    leave()
    h.controller.renderNow()
    expect(outlineGone()).toBe(true)
  })

  it('a leave while the page is hidden is not a leave, with no pick too (a dialog or another tab over the page)', () => {
    userMove(10, 60)
    pageHidden(true)
    leave()
    pageHidden(false)
    h.controller.renderNow()
    expect(label()).toBe('li#one800×40')
    altUp()
    expect(spoken()).toBe('showing ul#list')
  })

  it('a page’s own visibilitychange moves nothing', () => {
    userMove(10, 60)
    userKey({ key: 'Enter' })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    delete (document as unknown as Record<string, unknown>).visibilityState
    // Had the forged hide counted, this move would end the hold and the leave clear the outline.
    userMove(12, 62)
    leave()
    h.controller.renderNow()
    expect(label()).toBe('li#one800×40')
  })
})

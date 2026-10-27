// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pins, visibility reports, reveal and restore through the controller
 * (docs/designs/html-preview-comments.md §6 status, §7.5 step 6, §7.10,
 * §10.5, decisions 20 and 30, §19 R3-7; J-005, J-006, J-016).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANCHOR_CHECK_MIN_MS,
  COMMENT_ANCHORS_CHANNEL,
  COMMENT_HELLO_CHANNEL,
  COMMENT_PICK_CHANNEL,
  PIN_EDGE_INSET_PX,
  RENDER_FALLBACK_MS,
  REVEAL_FLASH_MS,
  TOKEN_ATTRIBUTE
} from './constants'
import { MODE_TAB_TEXT } from './overlayView'
import { DEFAULT_THEME } from './state'
import { byId, createHarness, drawnText, microtasks, mount, token, userMove, type Harness } from './__test-helpers__/harness'

const T = TOKEN_ATTRIBUTE
const PAGE = [
  `<section id="deck" ${T}="${token(1)}">`,
  `<div id="s1" class="slide" ${T}="${token(2)}">One</div>`,
  `<div id="s2" class="slide" ${T}="${token(3)}">Two</div>`,
  `<ul id="list" ${T}="${token(4)}"></ul>`,
  '</section>'
].join('')
const BOXES = {
  deck: { left: 0, top: 0, width: 800, height: 600 },
  s1: { left: 0, top: 0, width: 400, height: 300 },
  s2: { left: 0, top: 300, width: 400, height: 300 },
  list: { left: 400, top: 0, width: 400, height: 300 }
}
const icon = (key: string, n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  key,
  token: token(n),
  count: 1,
  status: 'open',
  ...extra
})

let h: Harness

beforeEach(async () => {
  h = createHarness()
  mount(PAGE, BOXES, h.doubles)
  await microtasks()
  h.controller.documentReady()
})

afterEach(() => {
  vi.useRealTimers()
  h.dispose()
})

const pins = (): HTMLElement[] => [...(h.root()?.querySelectorAll<HTMLElement>('.erf-hpc-pin') ?? [])]
const reports = (): unknown[] => h.sent(COMMENT_ANCHORS_CHANNEL)

describe('pins (J-005)', () => {
  it('draws one pin per element, outside comment mode too', () => {
    h.state({ showIcons: true, icons: [icon('a', 2), icon('b', 3, { count: 4 })] })
    expect(pins().map(p => p.getAttribute('aria-label'))).toEqual([
      '1 comment on div#s1.slide. Open.',
      '4 comments on div#s2.slide. Open.'
    ])
    expect(h.host()).not.toBeNull()
  })

  it('J-005 the toggle hides every pin, and a resolved-only element (count 0) has none', () => {
    h.state({ showIcons: true, icons: [icon('a', 2), icon('b', 3, { count: 0 })] })
    expect(pins()).toHaveLength(1)
    h.state({ showIcons: false, icons: [icon('a', 2)] })
    expect(pins()).toHaveLength(0)
  })

  it('draws nothing and adds no host when there is nothing to draw', () => {
    h.state({ showIcons: true, icons: [] })
    expect(h.host()).toBeNull()
  })

  it('resolves a JS-built pin target through its runtime path, and hides it when the tag differs', () => {
    const li = document.createElement('li')
    byId('list').append(li)
    h.doubles.setBox(li, { left: 400, top: 0, width: 100, height: 20 })
    h.state({
      showIcons: true,
      icons: [
        icon('built', 4, { runtime: { path: 'li:nth-of-type(1)', tag: 'li' } }),
        icon('wrong', 4, { runtime: { path: 'li:nth-of-type(1)', tag: 'p' } })
      ]
    })
    expect(pins()).toHaveLength(1)
    expect(reports().at(-1)).toEqual({ visible: ['built'], hidden: ['wrong'] })
  })
})

describe('visibility reports (J-006)', () => {
  it('J-006 a hidden slide is reported hidden; its pin appears when it becomes visible', async () => {
    vi.useFakeTimers()
    h.doubles.setVisible(byId('s2'), false)
    h.state({ showIcons: true, icons: [icon('one', 2), icon('two', 3)] })
    expect(reports()).toEqual([{ visible: ['one'], hidden: ['two'] }])
    expect(pins()).toHaveLength(1)
    expect(h.doubles.visibilityOptions[0]).toEqual({ opacityProperty: true, visibilityProperty: true })

    // The deck shows slide 2: a class change re-checks, at most every 250 ms.
    h.doubles.setVisible(byId('s1'), false)
    h.doubles.setVisible(byId('s2'), true)
    byId('s2').classList.add('active')
    await microtasks()
    await vi.advanceTimersByTimeAsync(ANCHOR_CHECK_MIN_MS + RENDER_FALLBACK_MS)
    expect(reports().at(-1)).toEqual({ visible: ['two'], hidden: ['one'] })
    expect(pins().map(p => p.getAttribute('aria-label'))).toEqual(['1 comment on div#s2.slide.active. Open.'])
  })

  it('J-006 a 0×0 element is not visible now, though checkVisibility passes it', () => {
    h.doubles.setBox(byId('s1'), { left: 10, top: 10, width: 0, height: 0 })
    h.state({ showIcons: true, icons: [icon('zero', 2)] })
    expect(reports()).toEqual([{ visible: [], hidden: ['zero'] }])
    expect(pins()).toHaveLength(0)
  })

  it('reports an unknown or voided token as hidden – orphaned is main’s call', () => {
    h.state({ showIcons: true, icons: [icon('ghost', 77)] })
    expect(reports()).toEqual([{ visible: [], hidden: ['ghost'] }])
  })

  it('sends only changes, at most every 250 ms, with the latest split', async () => {
    vi.useFakeTimers()
    h.state({ showIcons: true, icons: [icon('one', 2)] })
    h.state({ showIcons: true, icons: [icon('one', 2)] })
    expect(reports()).toHaveLength(1)
    h.doubles.setVisible(byId('s1'), false)
    h.controller.renderNow()
    h.doubles.setVisible(byId('s1'), true)
    h.controller.renderNow()
    h.doubles.setVisible(byId('s1'), false)
    h.controller.renderNow()
    expect(reports()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(ANCHOR_CHECK_MIN_MS)
    expect(reports()).toEqual([
      { visible: ['one'], hidden: [] },
      { visible: [], hidden: ['one'] }
    ])
  })

  it('reports nothing from a frame main cannot map', () => {
    h.controller.applyState({ mode: true, icons: [icon('one', 2)] })
    expect(reports()).toEqual([])
  })

  it('re-checks when a pinned element changes size, and redraws on scroll', async () => {
    vi.useFakeTimers()
    h.state({ showIcons: true, icons: [icon('one', 2)] })
    expect(h.doubles.resizeObserved).toEqual(new Set([byId('s1')]))
    h.doubles.setBox(byId('s1'), { left: 0, top: 0, width: 0, height: 0 })
    h.doubles.fireResize()
    await vi.advanceTimersByTimeAsync(ANCHOR_CHECK_MIN_MS + RENDER_FALLBACK_MS)
    expect(reports().at(-1)).toEqual({ visible: [], hidden: ['one'] })

    h.doubles.setBox(byId('s1'), { left: 0, top: 100, width: 400, height: 300 })
    window.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(RENDER_FALLBACK_MS)
    expect(pins()[0].style.top).toBe('74px')
    // Leaving every pin: the observers stop.
    h.state({ showIcons: true, icons: [] })
    expect(h.doubles.resizeObserved.size).toBe(0)
  })

  it('ignores its own host coming and going', async () => {
    vi.useFakeTimers()
    h.state({ showIcons: true, icons: [icon('one', 2)] })
    const sent = h.send.mock.calls.length
    h.host()?.remove()
    await microtasks()
    await vi.advanceTimersByTimeAsync(ANCHOR_CHECK_MIN_MS + RENDER_FALLBACK_MS)
    expect(h.send.mock.calls.length).toBe(sent)
  })

  it('says the overlay is unavailable once the page outlasts the repair budget', async () => {
    h.state({ showIcons: true, icons: [icon('one', 2)] })
    for (let i = 0; i < 10; i += 1) {
      h.host()?.remove()
      await microtasks()
    }
    expect(reports().at(-1)).toEqual({ visible: ['one'], hidden: [], overlay: 'unavailable', reason: 'overlay-removed' })
    h.controller.renderNow()
    expect(h.host()).toBeNull()
  })
})

describe('mode, reveal, restore', () => {
  it('turns the mode on with the frame and the tab, and off again – saying nothing in the page', () => {
    h.state({ mode: true })
    const root = h.root() as ShadowRoot
    expect(drawnText(root.querySelector('.erf-hpc-tab'))).toBe(MODE_TAB_TEXT)
    expect(root.querySelector('.erf-hpc-frame')?.classList.contains('erf-hpc-hidden')).toBe(false)
    // The comment window says the mode change (`commentModeChanged`); the page has no live region (E-022).
    expect(root.querySelector('[aria-live]')).toBeNull()
    expect(document.adoptedStyleSheets).toHaveLength(1)
    // The tab moves to the bottom while the pointer is near the top.
    userMove(400, 20)
    h.controller.renderNow()
    expect(root.querySelector('.erf-hpc-tab')?.classList.contains('erf-hpc-tab--bottom')).toBe(true)
    h.state({ mode: false })
    expect(root.querySelector('.erf-hpc-frame')?.classList.contains('erf-hpc-hidden')).toBe(true)
    expect(document.adoptedStyleSheets).toHaveLength(0)
  })

  it('draws no mode indicator and says nothing in a sub-frame', async () => {
    h.dispose()
    h = createHarness({ isTop: false })
    h.state({ mode: true })
    expect(h.root()?.querySelector('.erf-hpc-frame')?.classList.contains('erf-hpc-hidden')).toBe(true)
    expect(h.sent(COMMENT_PICK_CHANNEL)).toEqual([])
    await microtasks()
  })

  it('reveals a pin’s element: scrolls it to the centre and highlights it for 1.5 s', async () => {
    vi.useFakeTimers()
    h.state({ showIcons: true, icons: [icon('two', 3)], reveal: 'two' })
    expect(h.doubles.scrolledIntoView.at(-1)).toEqual({ element: byId('s2'), options: { block: 'center' } })
    const flash = h.root()?.querySelector('.erf-hpc-flash') as HTMLElement
    expect(flash.classList.contains('erf-hpc-hidden')).toBe(false)
    expect(flash.style.top).toBe('300px')
    // A second reveal restarts the highlight.
    h.state({ showIcons: true, icons: [icon('two', 3)], reveal: 'two' })
    h.clock.now += REVEAL_FLASH_MS
    await vi.advanceTimersByTimeAsync(REVEAL_FLASH_MS + RENDER_FALLBACK_MS)
    expect(flash.classList.contains('erf-hpc-hidden')).toBe(true)
    // An unknown key reveals nothing.
    h.state({ showIcons: true, icons: [icon('two', 3)], reveal: 'nope' })
    expect(h.doubles.scrolledIntoView).toHaveLength(2)
  })

  it('J-016 restores the frame’s scroll from commentState.restore, retrying while the page grows', () => {
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => frames.push(cb))
    const saved = {
      scrollTo: Object.getOwnPropertyDescriptor(window, 'scrollTo'),
      scrollY: Object.getOwnPropertyDescriptor(window, 'scrollY')
    }
    let y = 0
    let tallest = 400
    const scrollTo = vi.fn((_x: number, target: number) => {
      y = Math.min(target, tallest)
    })
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollTo })
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
    try {
      h.state({ restore: { x: 0, y: 1_000 } })
      expect(scrollTo).toHaveBeenCalledWith(0, 1_000)
      expect(y).toBe(400)
      tallest = 800
      frames.shift()?.(0)
      expect(y).toBe(800)
      tallest = 2_000
      frames.shift()?.(0)
      expect(y).toBe(1_000)
      expect(frames).toHaveLength(0)

      // The user takes over: the restore stops.
      h.state({ restore: { x: 0, y: 5_000 } })
      h.controller.userInput()
      const calls = scrollTo.mock.calls.length
      frames.shift()?.(0)
      expect(scrollTo.mock.calls.length).toBe(calls)

      // A target the page never reaches stops after the budget.
      h.state({ restore: { x: 0, y: 99_999 } })
      h.clock.now += 2_000
      frames.shift()?.(0)
      expect(frames).toHaveLength(0)
    } finally {
      raf.mockRestore()
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor === undefined) delete (window as unknown as Record<string, unknown>)[key]
        else Object.defineProperty(window, key, descriptor)
      }
    }
  })

  it('applies a new theme to the overlay’s sheet', () => {
    h.state({ mode: true })
    const root = h.root() as ShadowRoot
    expect(h.doubles.sheetText(root.adoptedStyleSheets[0])).toContain(DEFAULT_THEME.accent)
    h.state({ mode: true, theme: { accent: '#123456' } })
    expect(h.doubles.sheetText(root.adoptedStyleSheets[0])).toContain('#123456')
  })

  it('says hello once at DOMContentLoaded', () => {
    h.controller.documentReady()
    expect(h.sent(COMMENT_HELLO_CHANNEL)).toEqual([{}])
  })

  it('renders on the next animation frame, or on the fallback timer when frames do not run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    h.state({ showIcons: true, icons: [icon('one', 2)] })
    h.doubles.setBox(byId('s1'), { left: 0, top: 100, width: 400, height: 300 })
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    await vi.advanceTimersByTimeAsync(20)
    expect(pins()[0].style.top).toBe('74px')
  })
})

describe('a classic scrollbar (§19 Rev 4 "pins at the right edge")', () => {
  const SCROLLBAR_PX = 15
  let restoreLayout: (() => void) | null = null

  /**
   * jsdom has no layout, so its root reports a 0 client size and the overlay
   * falls back to the inner size. Here the root reports the inner size less a
   * 15 px vertical scrollbar, and the label measures `labelWidth`.
   */
  function withScrollbar(labelWidth = 0): number {
    const root = document.documentElement
    const visible = window.innerWidth - SCROLLBAR_PX
    Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => visible })
    Object.defineProperty(root, 'clientHeight', { configurable: true, get: () => window.innerHeight })
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('erf-hpc-label') ? labelWidth : 0
      }
    })
    restoreLayout = () => {
      delete (root as unknown as Record<string, unknown>).clientWidth
      delete (root as unknown as Record<string, unknown>).clientHeight
      if (offsetWidth !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth)
    }
    return visible
  }

  afterEach(() => {
    restoreLayout?.()
    restoreLayout = null
  })

  const px = (value: string): number => Number.parseFloat(value)

  it('draws a full-width element’s pin inside the visible width, not under the scrollbar', () => {
    const visible = withScrollbar()
    expect(visible).toBeLessThan(window.innerWidth)
    // The owner's div.doc: the whole page width, one element reaching under the scrollbar.
    h.doubles.setBox(byId('deck'), { left: 0, top: 120, width: visible, height: 2_000 })
    h.doubles.setBox(byId('list'), { left: 0, top: 60, width: window.innerWidth, height: 20 })
    h.state({ showIcons: true, icons: [icon('deck', 1), icon('list', 4)] })
    const drawn = pins()
    expect(drawn).toHaveLength(2)
    for (const pin of drawn) {
      expect(px(pin.style.left)).toBe(visible - 24 - PIN_EDGE_INSET_PX)
      expect(px(pin.style.left) + px(pin.style.width)).toBeLessThanOrEqual(visible - PIN_EDGE_INSET_PX)
    }
  })

  it('leaves a narrow element’s pin where it was', () => {
    h.doubles.setBox(byId('s1'), { left: 300, top: 200, width: 120, height: 40 })
    h.state({ showIcons: true, icons: [icon('s1', 2)] })
    const without = [pins()[0].style.left, pins()[0].style.top]
    withScrollbar()
    h.controller.renderNow()
    expect([pins()[0].style.left, pins()[0].style.top]).toEqual(without)
    expect(without).toEqual(['422px', '174px'])
  })

  it('clips the outline and clamps the label to the visible width too', () => {
    const visible = withScrollbar(120)
    // An element at the right edge, reaching under the scrollbar.
    h.doubles.setBox(byId('list'), { left: visible - 19, top: 320, width: 34, height: 60 })
    h.state({ mode: true })
    userMove(visible - 9, 350)
    h.controller.renderNow()
    const root = h.root() as ShadowRoot
    const outline = root.querySelector('.erf-hpc-outline') as HTMLElement
    const label = root.querySelector('.erf-hpc-label') as HTMLElement
    expect(outline.classList.contains('erf-hpc-hidden')).toBe(false)
    expect(px(outline.style.left) + px(outline.style.width)).toBe(visible)
    expect(px(label.style.left)).toBe(visible - 120)
  })
})

describe('controller edges', () => {
  it('hides the outline of an element scrolled out of the viewport', () => {
    h.state({ mode: true })
    userMove(10, 10)
    h.controller.renderNow()
    const outline = h.root()?.querySelector('.erf-hpc-outline') as HTMLElement
    expect(outline.classList.contains('erf-hpc-hidden')).toBe(false)
    h.doubles.setBox(byId('s1'), { left: 0, top: -900, width: 400, height: 300 })
    h.controller.renderNow()
    expect(outline.classList.contains('erf-hpc-hidden')).toBe(true)
  })

  it('draws nothing while the page has removed <html>', () => {
    const html = document.documentElement
    document.removeChild(html)
    try {
      h.state({ mode: true, showIcons: true, icons: [icon('one', 2)] })
      expect(reports()).toEqual([])
    } finally {
      document.append(html)
    }
  })

  it('dispose cancels a running reveal highlight', () => {
    vi.useFakeTimers()
    h.state({ showIcons: true, icons: [icon('two', 3)], reveal: 'two' })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    h.controller.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})

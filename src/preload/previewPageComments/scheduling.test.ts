// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * When the overlay redraws, and the comment-mode cursor
 * (docs/designs/html-preview-comments.md §6 status, §10.1, §10.2).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ANCHOR_CHECK_MIN_MS, RENDER_FALLBACK_MS } from './constants'
import { CROSSHAIR_CSS } from './overlayStyles'
import { CursorSheet, PageWatch, RenderScheduler } from './scheduling'
import { installBrowserDoubles, type BrowserDoubles } from './__test-helpers__/browserDoubles'
import { microtasks } from './__test-helpers__/harness'

describe('RenderScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders once per animation frame, however often it is asked', () => {
    const run = vi.fn()
    const scheduler = new RenderScheduler(window, run)
    scheduler.soon()
    scheduler.soon()
    vi.advanceTimersToNextFrame()
    expect(run).toHaveBeenCalledTimes(1)
    // The fallback timer of that request was cancelled with it.
    vi.advanceTimersByTime(RENDER_FALLBACK_MS)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('cancel drops a queued render', () => {
    const run = vi.fn()
    const scheduler = new RenderScheduler(window, run)
    scheduler.soon()
    scheduler.cancel()
    scheduler.cancel()
    vi.advanceTimersByTime(RENDER_FALLBACK_MS * 2)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('PageWatch', () => {
  let doubles: BrowserDoubles
  let clock: { now: number }
  let onChange: Mock<() => void>
  let host: HTMLElement
  let watch: PageWatch

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    doubles = installBrowserDoubles()
    clock = { now: 50_000 }
    onChange = vi.fn<() => void>()
    host = document.createElement('div')
    watch = new PageWatch({ win: window, doc: document, now: () => clock.now }, node => node === host, onChange)
  })

  afterEach(() => {
    watch.set(false)
    host.remove()
    document.body.innerHTML = ''
    doubles.restore()
    vi.useRealTimers()
  })

  function wait(ms: number): void {
    clock.now += ms
    vi.advanceTimersByTime(ms)
  }

  it('redraws at once on scroll and resize, and only while on', () => {
    watch.set(true)
    watch.set(true)
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    expect(onChange).toHaveBeenCalledTimes(2)
    watch.set(false)
    window.dispatchEvent(new Event('scroll'))
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it(`re-checks after a load, an animation or a DOM change – at most once per ${ANCHOR_CHECK_MIN_MS} ms`, async () => {
    watch.set(true)
    window.dispatchEvent(new Event('load'))
    window.dispatchEvent(new Event('transitionend'))
    document.body.append(document.createElement('p'))
    await microtasks()
    wait(0)
    expect(onChange).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('animationend'))
    wait(ANCHOR_CHECK_MIN_MS - 1)
    expect(onChange).toHaveBeenCalledTimes(1)
    wait(1)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('ignores mutations of Erfana’s own host', async () => {
    watch.set(true)
    document.documentElement.append(host)
    host.setAttribute('popover', 'manual')
    await microtasks()
    wait(ANCHOR_CHECK_MIN_MS)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('drops a pending re-check when turned off', async () => {
    watch.set(true)
    document.body.append(document.createElement('p'))
    await microtasks()
    watch.set(false)
    wait(ANCHOR_CHECK_MIN_MS)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('watches the size of the pinned elements only, and re-checks when one changes', () => {
    const a = document.createElement('p')
    const b = document.createElement('p')
    watch.observeSizes([a])
    expect(doubles.resizeObserved.size).toBe(0)
    watch.set(true)
    watch.observeSizes([a, b])
    watch.observeSizes([b])
    expect([...doubles.resizeObserved]).toEqual([b])
    doubles.fireResize()
    wait(0)
    expect(onChange).toHaveBeenCalledTimes(1)
    watch.set(false)
    expect(doubles.resizeObserved.size).toBe(0)
  })

  it('L9 counts the page’s DOM changes in its version – not Erfana’s own, and not while off', async () => {
    const start = watch.version
    watch.set(true)
    const on = watch.version
    expect(on).toBeGreaterThan(start)
    document.documentElement.append(host)
    host.setAttribute('popover', 'manual')
    await microtasks()
    expect(watch.version).toBe(on)
    document.body.append(document.createElement('p'))
    await microtasks()
    expect(watch.version).toBe(on + 1)
    watch.set(false)
    const off = watch.version
    document.body.append(document.createElement('p'))
    await microtasks()
    expect(watch.version).toBe(off)
    // Turning on again is a change too: nothing watched the page meanwhile.
    watch.set(true)
    expect(watch.version).toBeGreaterThan(off)
  })

  it('M1 puts its window listeners back after document.open() erased them, only while on', () => {
    const added = vi.spyOn(window, 'addEventListener')
    watch.reattach()
    expect(added).not.toHaveBeenCalled()
    watch.set(true)
    added.mockClear()
    watch.reattach()
    expect(added.mock.calls.map(([type]) => type)).toEqual(['scroll', 'resize', 'transitionend', 'animationend', 'load'])
    added.mockRestore()
    // Idempotent: one scroll still redraws once.
    window.dispatchEvent(new Event('scroll'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('CursorSheet', () => {
  let doubles: BrowserDoubles

  beforeEach(() => {
    doubles = installBrowserDoubles()
  })

  afterEach(() => {
    doubles.restore()
  })

  it('adopts the crosshair sheet beside the page’s own sheets, and removes only it', () => {
    const pageSheet = new CSSStyleSheet()
    document.adoptedStyleSheets = [pageSheet]
    const cursor = new CursorSheet(document)
    cursor.set(true)
    cursor.set(true)
    expect(document.adoptedStyleSheets).toHaveLength(2)
    expect(doubles.sheetText(document.adoptedStyleSheets[1])).toBe(CROSSHAIR_CSS)
    cursor.set(false)
    cursor.set(false)
    expect(document.adoptedStyleSheets).toEqual([pageSheet])
    document.adoptedStyleSheets = []
  })

  it('does nothing in a document without a window', () => {
    const windowless = document.implementation.createHTMLDocument('x')
    const cursor = new CursorSheet(windowless)
    cursor.set(true)
    cursor.set(false)
    cursor.reassert()
    expect(windowless.defaultView).toBeNull()
  })

  it('M1 adds the sheet back when the document lost it, and nothing while off or present', () => {
    const cursor = new CursorSheet(document)
    cursor.reassert()
    expect(document.adoptedStyleSheets).toEqual([])
    cursor.set(true)
    const [sheet] = document.adoptedStyleSheets
    cursor.reassert()
    expect(document.adoptedStyleSheets).toEqual([sheet])
    document.adoptedStyleSheets = []
    cursor.reassert()
    expect(document.adoptedStyleSheets).toEqual([sheet])
    cursor.set(false)
    expect(document.adoptedStyleSheets).toEqual([])
  })
})

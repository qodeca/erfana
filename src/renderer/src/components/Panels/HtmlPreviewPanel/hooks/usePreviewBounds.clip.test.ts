// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewBounds – a placeholder clipped away by an ancestor (issue #124,
 * part 1 §1.4, C2).
 *
 * With the terminal expanded over the editor, dockview keeps the editor group at
 * its 100 px floor inside a 0-wide area: the placeholder measures a valid box
 * that paints nowhere. The hook intersects it with every clipping ancestor; an
 * empty result is never sent, is logged once as R7, withdraws the published rect
 * and – once a rect has gone out – raises the collapsed flag the overlay guard
 * hides on. On the way back: one forced push, then the flag clears, then the
 * guard shows.
 *
 * jsdom has no layout, so rects are stubbed per element, and so are the
 * computed styles that make an ancestor clip. The real overlay guard singleton
 * runs, so a hide or show is what main would receive.
 *
 * Split from `usePreviewBounds.test.ts`, which sits near the 500-line cap.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePreviewBounds, type UsePreviewBoundsOptions } from './usePreviewBounds'
import { clipsDescendants, intersectRects, visibleArea } from '../previewClip'
import { usePreviewViewportStore } from '../../../../stores/usePreviewViewportStore'
import { usePreviewStore } from '../../../../stores/usePreviewStore'
import { usePreviewCollapsedStore } from '../../../../stores/usePreviewCollapsedStore'
import { getOverlayGuard, resetOverlayGuard } from '../../../../services/preview/OverlayGuardService'
import { BOUNDS_DROP_MESSAGE } from '../../../../../../shared/dropReporter'
import { stablePathDigest } from '../../../../../../shared/stablePathDigest'

/** The renderer logger, where the hook's drop reporter writes. */
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../../../utils/logger', () => ({ logger: log }))

const PANEL_ID = 'preview-panel-1'

/** The editor centre at its 400 px minimum. */
const LAID_OUT = { left: 477, top: 41, width: 400, height: 827 }
/** The placeholder once the terminal expands (the e2e's numbers). */
const CLIPPED_STRIP = { left: 48, top: 82, width: 100, height: 786 }
/** The centre the terminal expand hid: 0 wide. */
const COLLAPSED_CENTRE = { ...LAID_OUT, width: 0 }
const NO_BOX = { left: 0, top: 0, width: 0, height: 0 }

type Rect = typeof LAID_OUT

let rafQueue: FrameRequestCallback[] = []
let setBounds: ReturnType<typeof vi.fn>
let setVisibility: ReturnType<typeof vi.fn>
/** Computed-style overrides per element; any other element gets jsdom's own. */
const styleOverrides = new Map<Element, Record<string, string>>()

function frame(): void {
  const due = rafQueue
  rafQueue = []
  for (const cb of due) cb(0)
}

/** An element whose measured rect is swappable, standing in for layout. */
function makeBox(initial: Rect): { el: HTMLElement; layout: (rect: Rect) => void } {
  const el = document.createElement('div')
  let rect = initial
  el.getBoundingClientRect = (): DOMRect =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect
  return { el, layout: (next) => { rect = next } }
}

/** Makes `el` compute `overflow: hidden`. */
function clips(el: HTMLElement): void {
  styleOverrides.set(el, { overflowX: 'hidden', overflowY: 'hidden' })
}

/** The editor centre (clipping, on the page) holding the placeholder. */
function makeLayout(centreRect: Rect = LAID_OUT) {
  const centre = makeBox(centreRect)
  clips(centre.el)
  const placeholder = makeBox(LAID_OUT)
  centre.el.appendChild(placeholder.el)
  document.body.appendChild(centre.el)
  return { centre, placeholder }
}

/**
 * Mounts the hook with every gate open; `initialProps` overrides any of them.
 * One ref for the whole mount, as the panel's `useRef` gives: a fresh ref per
 * render would re-create the hook's callbacks and add pushes of its own.
 */
function mountHook(el: HTMLElement, initialProps: Partial<UsePreviewBoundsOptions> = {}) {
  const placeholderRef = { current: el }
  return renderHook(
    (props: Partial<UsePreviewBoundsOptions>) =>
      usePreviewBounds({ placeholderRef, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false, ...props }),
    { initialProps }
  )
}

/** A live preview that the real overlay guard shows as the active tab. */
function showLivePreview(): void {
  usePreviewStore.getState().setLoadState(PANEL_ID, 'ready')
  getOverlayGuard().sync(PANEL_ID)
}

/** Terminal expand: the centre goes 0 wide, the placeholder keeps a 100 px box. */
function expandTerminal(layout: ReturnType<typeof makeLayout>): void {
  layout.placeholder.layout(CLIPPED_STRIP)
  layout.centre.layout(COLLAPSED_CENTRE)
  frame()
}

/** The structured context of every drop line with this reason. */
const dropLines = (reason: string): unknown[] =>
  log.info.mock.calls
    .filter(([message, context]) => message === BOUNDS_DROP_MESSAGE && (context as { reason: string }).reason === reason)
    .map(([, context]) => context)

const isCollapsed = (): boolean => usePreviewCollapsedStore.getState().isCollapsed(PANEL_ID)

beforeEach(() => {
  rafQueue = []
  for (const fn of Object.values(log)) fn.mockClear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => rafQueue.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((elt, pseudo) => {
    const style = real(elt, pseudo)
    const overrides = styleOverrides.get(elt)
    if (overrides === undefined) return style
    return new Proxy(style, {
      get(target, prop) {
        if (typeof prop === 'string' && prop in overrides) return overrides[prop]
        const value: unknown = Reflect.get(target, prop, target)
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
      }
    })
  })
  setBounds = vi.fn()
  setVisibility = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { preview: { setBounds, setVisibility, onVisibilityApplied: () => () => {} } }
  })
})

afterEach(() => {
  resetOverlayGuard()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  styleOverrides.clear()
  document.body.replaceChildren()
  usePreviewViewportStore.setState({ rects: new Map() })
  usePreviewStore.setState({ panels: new Map() })
  usePreviewCollapsedStore.setState({ collapsed: new Set() })
})

describe('intersectRects', () => {
  const R = { left: 10, top: 20, width: 100, height: 50 }
  it.each([
    ['no clip', R, [], R],
    ['a clip that holds it', R, [{ left: 0, top: 0, width: 500, height: 500 }], R],
    ['partial', R, [{ left: 60, top: 0, width: 500, height: 40 }], { left: 60, top: 20, width: 50, height: 20 }],
    ['full – disjoint', R, [{ left: 200, top: 20, width: 100, height: 50 }], null],
    ['full – a 0-wide clip', CLIPPED_STRIP, [COLLAPSED_CENTRE], null],
    ['edges that only touch', R, [{ left: 110, top: 20, width: 10, height: 50 }], null],
    ['a 0×0 rect', NO_BOX, [], null],
    ['several clips, nested', R, [{ left: 0, top: 0, width: 80, height: 500 }, { left: 30, top: 0, width: 500, height: 500 }], { left: 30, top: 20, width: 50, height: 50 }]
  ])('%s', (_name, rect, clipRects, expected) => {
    expect(intersectRects(rect, clipRects)).toEqual(expected)
  })
})

describe('clipsDescendants', () => {
  it.each([
    ['visible', 'visible', '', false],
    ['', '', undefined, false],
    ['hidden', 'visible', '', true],
    ['visible', 'auto', '', true],
    ['scroll', 'scroll', '', true],
    ['clip', 'visible', '', true],
    ['visible', 'visible', 'layout paint', true],
    ['visible', 'visible', 'strict', true],
    ['visible', 'visible', 'content', true],
    ['visible', 'visible', 'layout', false],
    ['visible', 'visible', 'size style', false]
  ])('overflow %j / %j, contain %j → %s', (overflowX, overflowY, contain, expected) => {
    const style = { overflowX, overflowY, contain } as unknown as CSSStyleDeclaration
    expect(clipsDescendants(style)).toBe(expected)
  })
})

describe('visibleArea', () => {
  it('leaves the rect whole with no clipping ancestor, attached or not', () => {
    const outer = makeBox(COLLAPSED_CENTRE)
    const inner = makeBox(LAID_OUT)
    outer.el.appendChild(inner.el)
    expect(visibleArea(inner.el, LAID_OUT)).toEqual(LAID_OUT)
    document.body.appendChild(outer.el)
    // A 0-wide ancestor that does not clip lets its overflow paint.
    expect(visibleArea(inner.el, LAID_OUT)).toEqual(LAID_OUT)
  })

  it('clips by every clipping ancestor, overflow and paint containment alike', () => {
    const overlay = makeBox({ ...LAID_OUT, left: 500 })
    styleOverrides.set(overlay.el, { contain: 'layout paint' })
    const scroller = makeBox({ ...LAID_OUT, top: 100 })
    styleOverrides.set(scroller.el, { overflowY: 'auto' })
    const placeholder = makeBox(LAID_OUT)
    scroller.el.appendChild(placeholder.el)
    overlay.el.appendChild(scroller.el)
    document.body.appendChild(overlay.el)

    expect(visibleArea(placeholder.el, LAID_OUT)).toEqual({ left: 500, top: 100, width: 377, height: 768 })
  })

  it('is empty inside a 0-wide clipping ancestor', () => {
    const { placeholder } = makeLayout(COLLAPSED_CENTRE)
    expect(visibleArea(placeholder.el, CLIPPED_STRIP)).toBeNull()
  })
})

describe('usePreviewBounds – a clipped placeholder (#124 C2)', () => {
  it('sends nothing, logs one R7 line with the measured rect, and withdraws the published rect', () => {
    const layout = makeLayout()
    showLivePreview()
    mountHook(layout.placeholder.el)
    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(true)

    expandTerminal(layout)
    for (let i = 0; i < 30; i += 1) frame()

    expect(setBounds).toHaveBeenCalledTimes(1)
    expect(dropLines('clipped-away')).toEqual([
      { source: 'renderer', reason: 'clipped-away', panelId: stablePathDigest(PANEL_ID), lastSeq: 0, rect: { x: 48, y: 82, w: 100, h: 786 } }
    ])
    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(false)
  })

  it('hides the page through the guard, with the reason `collapsed`', () => {
    const layout = makeLayout()
    showLivePreview()
    mountHook(layout.placeholder.el)

    expandTerminal(layout)

    expect(isCollapsed()).toBe(true)
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL_ID, false, 'collapsed')
  })

  it('collapses nothing before the first send, so an opening preview never flaps', () => {
    const layout = makeLayout(COLLAPSED_CENTRE)
    showLivePreview()
    mountHook(layout.placeholder.el)
    for (let i = 0; i < 5; i += 1) frame()

    expect(setBounds).not.toHaveBeenCalled()
    expect(dropLines('clipped-away')).toHaveLength(1)
    expect(isCollapsed()).toBe(false)
    expect(setVisibility).toHaveBeenCalledTimes(1)
  })

  it('on the way back sends one forced push first, then clears the flag, then the guard shows', () => {
    // Only the centre changes, so the rect sent back is the one sent before.
    const layout = makeLayout()
    showLivePreview()
    mountHook(layout.placeholder.el)
    layout.centre.layout(COLLAPSED_CENTRE)
    frame()
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL_ID, false, 'collapsed')
    const flagAtPush: boolean[] = []
    setBounds.mockImplementation(() => flagAtPush.push(isCollapsed()))

    layout.centre.layout(LAID_OUT)
    frame()

    expect(setBounds).toHaveBeenCalledTimes(2)
    expect(setBounds.mock.calls[1]?.[1]).toEqual(setBounds.mock.calls[0]?.[1])
    expect(flagAtPush).toEqual([true])
    expect(isCollapsed()).toBe(false)
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL_ID, true, 'active-tab')
    const showOrder = setVisibility.mock.invocationCallOrder.at(-1) ?? 0
    expect(setBounds.mock.invocationCallOrder[1]).toBeLessThan(showOrder)
  })

  it('sends a partly clipped placeholder whole and leaves the page shown', () => {
    const layout = makeLayout({ ...LAID_OUT, width: 200 })
    showLivePreview()
    mountHook(layout.placeholder.el)

    expect(setBounds).toHaveBeenLastCalledWith(PANEL_ID, { x: 477, y: 41, width: 400, height: 827 }, 0)
    expect(isCollapsed()).toBe(false)
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL_ID, true, 'active-tab')
  })

  it('treats a 0×0 placeholder after a send as the empty case: R3, not R7, and the page hides', () => {
    const layout = makeLayout()
    showLivePreview()
    mountHook(layout.placeholder.el)

    layout.placeholder.layout(NO_BOX)
    frame()

    expect(dropLines('degenerate-rect')).toHaveLength(1)
    expect(dropLines('clipped-away')).toEqual([])
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL_ID, false, 'collapsed')
  })

  it('never collapses a background tab – the guard already hides it', () => {
    const layout = makeLayout()
    const { rerender } = mountHook(layout.placeholder.el)
    rerender({ isVisible: false })

    layout.centre.layout(COLLAPSED_CENTRE)
    window.dispatchEvent(new Event('resize'))

    expect(dropLines('clipped-away')).toHaveLength(1)
    expect(isCollapsed()).toBe(false)
  })

  it('keeps the flag across a tab switch and clears it with a push on the way back', () => {
    const layout = makeLayout()
    showLivePreview()
    const { rerender } = mountHook(layout.placeholder.el)
    expandTerminal(layout)

    rerender({ isVisible: false })
    expect(isCollapsed()).toBe(true)
    layout.placeholder.layout(LAID_OUT)
    layout.centre.layout(LAID_OUT)
    rerender({ isVisible: true })

    expect(setBounds).toHaveBeenCalledTimes(2)
    expect(isCollapsed()).toBe(false)
  })

  it('clears the flag when the view stops being live, and on unmount', () => {
    const layout = makeLayout()
    const { rerender, unmount } = mountHook(layout.placeholder.el)
    expandTerminal(layout)
    expect(isCollapsed()).toBe(true)

    rerender({ isLive: false })
    expect(isCollapsed()).toBe(false)

    // Live again: the new view's opening push counts, so a clip collapses again.
    layout.placeholder.layout(LAID_OUT)
    layout.centre.layout(LAID_OUT)
    rerender({ isLive: true })
    expandTerminal(layout)
    expect(isCollapsed()).toBe(true)

    unmount()
    expect(isCollapsed()).toBe(false)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewBounds – the per-frame measure loop (issue #124, part 1 §1.4, C1).
 *
 * While the tab is visible and its view live, the hook measures the placeholder
 * every animation frame and sends only on a change. That is what catches a panel
 * that slides without resizing (the observer watches size only) and a window
 * resize measured before dockview's deferred layout lands. P1-AC5 bounds it: no
 * send while still, and at most one message per frame while moving.
 *
 * Split from `usePreviewBounds.test.ts`, which sits near the 500-line cap. The
 * reproduction tests that went red on the pre-fix code are in
 * `usePreviewBounds.repro.test.ts`.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SEARCH_BAR_INSET_PX, usePreviewBounds, type UsePreviewBoundsOptions } from './usePreviewBounds'
import { usePreviewViewportStore } from '../../../../stores/usePreviewViewportStore'
import { BOUNDS_DROP_MESSAGE } from '../../../../../../shared/dropReporter'

/** The renderer logger, where the hook's drop reporter writes. */
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../../../utils/logger', () => ({ logger: log }))

const PANEL_ID = 'preview-panel-1'

/** The editor centre at its 400 px minimum. */
const LAID_OUT = { left: 477, top: 41, width: 400, height: 827 }

type Rect = typeof LAID_OUT

/** Pending animation-frame callbacks by id, flushed explicitly by `frame()`. */
let rafQueue = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
let setBounds: ReturnType<typeof vi.fn>

/** Run every currently-queued animation frame once. */
function frame(): void {
  const due = [...rafQueue.values()]
  rafQueue = new Map()
  for (const cb of due) cb(0)
}

/** A placeholder whose measured rect is swappable, standing in for layout. */
function makePlaceholder(initial: Rect): { el: HTMLElement; layout: (rect: Rect) => void } {
  const el = document.createElement('div')
  let rect = initial
  el.getBoundingClientRect = (): DOMRect =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect
  return { el, layout: (next) => { rect = next } }
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

/** The setup's `MockResizeObserver` watching `el`: deliver it one resize. */
function resizeObserved(el: HTMLElement): void {
  const observers = (globalThis.ResizeObserver as unknown as {
    instances: Array<{ observed: unknown[]; trigger: () => void }>
  }).instances
  for (const o of observers.filter((o) => o.observed.includes(el))) o.trigger()
}

/** The rect of every `setBounds` call so far. */
const sent = (): unknown[] => setBounds.mock.calls.map((call) => call[1])

beforeEach(() => {
  rafQueue = new Map()
  nextFrameId = 1
  for (const fn of Object.values(log)) fn.mockClear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = nextFrameId++
    rafQueue.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQueue.delete(id)
  })
  setBounds = vi.fn()
  Object.defineProperty(window, 'api', { configurable: true, value: { preview: { setBounds } } })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  usePreviewViewportStore.setState({ rects: new Map() })
})

describe('usePreviewBounds – the measure loop (#124 C1)', () => {
  it('sends nothing while the panel is still, and logs nothing either', () => {
    const { el } = makePlaceholder(LAID_OUT)
    mountHook(el)

    for (let i = 0; i < 60; i += 1) frame()

    // The opening push, then a second of still frames: nothing more.
    expect(setBounds).toHaveBeenCalledTimes(1)
    expect(log.info).not.toHaveBeenCalled()
    // Still measuring, though: the next move is caught on its first frame.
    expect(rafQueue.size).toBe(1)
  })

  it('sends one message per frame while the panel moves, and none once it stops', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    mountHook(el)

    for (let step = 1; step <= 5; step += 1) {
      layout({ ...LAID_OUT, left: LAID_OUT.left - step * 10 })
      frame()
      expect(setBounds).toHaveBeenCalledTimes(1 + step)
    }
    frame()
    frame()

    expect(setBounds).toHaveBeenCalledTimes(6)
    expect(sent().at(-1)).toEqual({ x: 427, y: 41, width: 400, height: 827 })
  })

  it('does not send twice when the observer has already sent the frame’s rect', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    mountHook(el)

    layout({ ...LAID_OUT, width: 380 })
    resizeObserved(el)
    frame()

    expect(sent()).toEqual([
      { x: 477, y: 41, width: 400, height: 827 },
      { x: 477, y: 41, width: 380, height: 827 }
    ])
  })

  it('sends a window resize that already measures the new layout at once', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    mountHook(el)

    layout({ ...LAID_OUT, left: 300 })
    window.dispatchEvent(new Event('resize'))

    expect(sent().at(-1)).toEqual({ x: 300, y: 41, width: 400, height: 827 })
  })

  it('stamps every send with the next seq', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    mountHook(el)
    layout({ ...LAID_OUT, left: 400 })
    frame()

    expect(setBounds.mock.calls.map((call) => call[2])).toEqual([0, 1])
  })

  it('stops measuring when the tab is hidden, even for a frame already queued', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    const { rerender } = mountHook(el)
    // A frame the browser has already dequeued still runs after cleanup.
    const queued = [...rafQueue.values()]

    rerender({ isVisible: false })
    layout({ ...LAID_OUT, left: 300 })
    for (const cb of queued) cb(0)
    frame()

    expect(setBounds).toHaveBeenCalledTimes(1)
    expect(rafQueue.size).toBe(0)
  })

  it('stops measuring on unmount', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    const { unmount } = mountHook(el)

    unmount()
    layout({ ...LAID_OUT, left: 300 })
    frame()

    expect(setBounds).toHaveBeenCalledTimes(1)
    expect(rafQueue.size).toBe(0)
  })

  it('re-sends an unchanged rect when the view goes live – main has no rect for a new view', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    const { rerender } = mountHook(el, { isLive: false })
    // The observer runs before the view exists; main drops what it sends.
    layout({ ...LAID_OUT, width: 380 })
    resizeObserved(el)
    expect(setBounds).toHaveBeenCalledTimes(1)

    rerender({ isLive: true })

    expect(setBounds).toHaveBeenCalledTimes(2)
    expect(sent()[1]).toEqual(sent()[0])
  })

  it('re-sends an unchanged rect when the tab is activated again', () => {
    const { el } = makePlaceholder(LAID_OUT)
    const { rerender } = mountHook(el)

    rerender({ isVisible: false })
    rerender({ isVisible: true })

    expect(sent()).toEqual([LAID_OUT, LAID_OUT].map(({ left, top, width, height }) => ({ x: left, y: top, width, height })))
  })

  it('keeps pushBounds a forced push that sends an unchanged rect', () => {
    const { el } = makePlaceholder(LAID_OUT)
    const { result } = mountHook(el)

    expect(result.current.pushBounds()).toBe(true)
    expect(setBounds).toHaveBeenCalledTimes(2)
  })

  it('sends one rect for a find-bar toggle, and nothing more on the next frame', () => {
    const { el } = makePlaceholder(LAID_OUT)
    const { rerender } = mountHook(el)

    rerender({ searchOpen: true })
    frame()

    expect(sent()).toEqual([
      { x: 477, y: 41, width: 400, height: 827 },
      { x: 477, y: 41 + SEARCH_BAR_INSET_PX, width: 400, height: 827 - SEARCH_BAR_INSET_PX }
    ])
  })

  it('logs a drop once per change, not once per frame', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    mountHook(el)

    layout({ left: 0, top: 0, width: 0, height: 0 })
    for (let i = 0; i < 30; i += 1) frame()

    const drops = log.info.mock.calls.filter(([message]) => message === BOUNDS_DROP_MESSAGE)
    expect(drops).toHaveLength(1)
  })

  it('measures without a placeholder once per change: one R2 line and no rect published', () => {
    const { result } = renderHook(() =>
      usePreviewBounds({ placeholderRef: { current: null }, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false })
    )
    for (let i = 0; i < 5; i += 1) frame()
    expect(result.current.pushBounds()).toBe(false)

    // The mount's line; the forced push's repeat falls inside the reporter's cap.
    const drops = log.info.mock.calls.filter(([message]) => message === BOUNDS_DROP_MESSAGE)
    expect(drops).toHaveLength(1)
    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(false)
  })
})

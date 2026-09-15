// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewBounds — the first rect after open (issue #74 follow-up).
 *
 * THE BUG THIS PINS. `openFileInPanel` calls dockview's `addPanel` and only then
 * `setActive`, so this hook first runs while the panel is still an INACTIVE tab,
 * whose box is 0×0. `deriveBounds` refuses a degenerate rect, so nothing was
 * sent, and the native `WebContentsView` kept the 1×1 fallback rect that
 * `preview:open` was called with — a view too small to see over a brand-black
 * placeholder. The user saw a black panel until an unrelated event (a tab switch
 * or a window resize) finally pushed a rect.
 *
 * AND THE SECOND RACE. `preview:open` is still in flight while this hook mounts,
 * and `PreviewViewService.setBounds` silently DROPS a rect for a panel it has no
 * view for. A rect sent that early looks like success in the renderer and
 * vanishes main-side, so the measure loop must push again once the view is live.
 *
 * The `ResizeObserver` is deliberately inert in these tests (the renderer test
 * setup's `MockResizeObserver` never invokes its callback). That is not a
 * convenience: dockview re-parents an `always`-rendered panel rather than
 * resizing it in place, so the 0×0 → laid-out transition need not produce a
 * resize callback at all. The loop has to hold on its own.
 *
 * The last block pins drop-point logging (issue #124, P1-AC1). The loop itself
 * (#124 C1) is pinned in `usePreviewBounds.loop.test.ts`, the clip check (C2) in
 * `usePreviewBounds.clip.test.ts`.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePreviewBounds, SEARCH_BAR_INSET_PX, type UsePreviewBoundsOptions } from './usePreviewBounds'
import { usePreviewViewportStore } from '../../../../stores/usePreviewViewportStore'
import { BOUNDS_DROP_MESSAGE } from '../../../../../../shared/dropReporter'
import { stablePathDigest } from '../../../../../../shared/stablePathDigest'
import { PREVIEW_LIMITS } from '../../../../../../shared/preview-limits'

/** The renderer logger, where the hook's drop reporter writes. */
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../../../../utils/logger', () => ({ logger: log }))

const PANEL_ID = 'preview-panel-1'

/** A laid-out placeholder rect, matching what dockview gives an active tab. */
const LAID_OUT = { left: 477, top: 41, width: 400, height: 827 }
/** What an inactive dockview tab measures: no box at all. */
const NO_BOX = { left: 0, top: 0, width: 0, height: 0 }

/** Queue of pending animation-frame callbacks, flushed explicitly by `frame()`. */
let rafQueue: FrameRequestCallback[] = []
let setBounds: ReturnType<typeof vi.fn>
/** What `performance.now()` returns – the drop reporter's clock. */
let clock = 0

/** Run every currently-queued animation frame once. */
function frame(): void {
  const due = rafQueue
  rafQueue = []
  for (const cb of due) cb(0)
}

/**
 * A placeholder element whose measured rect is swappable, so a test can model
 * "inactive tab, then laid out" without a real layout engine.
 */
function makePlaceholder(initial: typeof NO_BOX): {
  ref: React.RefObject<HTMLElement>
  layout: (rect: typeof NO_BOX) => void
} {
  const el = document.createElement('div')
  let rect = initial
  el.getBoundingClientRect = (): DOMRect => ({ ...rect, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  return { ref: { current: el }, layout: (next) => { rect = next } }
}

beforeEach(() => {
  rafQueue = []
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  for (const fn of Object.values(log)) fn.mockClear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    rafQueue.push(cb)
    return rafQueue.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  setBounds = vi.fn()
  vi.stubGlobal('window', window)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { preview: { setBounds } }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  usePreviewViewportStore.setState({ rects: new Map() })
})

describe('usePreviewBounds — first rect after open', () => {
  it('keeps measuring until the panel is laid out, then pushes that rect', () => {
    const { ref, layout } = makePlaceholder(NO_BOX)

    renderHook(() =>
      usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false })
    )

    // Mount happened while the tab was still inactive: nothing to send yet.
    expect(setBounds).not.toHaveBeenCalled()

    // Dockview activates the panel a moment later. No resize callback arrives.
    frame()
    layout(LAID_OUT)
    frame()

    expect(setBounds).toHaveBeenCalledWith(
      PANEL_ID,
      { x: 477, y: 41, width: 400, height: 827 },
      expect.any(Number)
    )
  })

  it('adds no inset of its own when the find bar is closed', () => {
    // The chrome strip's room is no longer reserved here. It used to be:
    // PREVIEW_CHROME_INSET_PX added 22px and duplicated the strip's CSS `height`,
    // which is two numbers one comment kept in step. The strip is now a flow
    // sibling ABOVE `.html-preview-page-area`, so the placeholder this hook
    // measures already excludes it, at whatever height it happens to be.
    //
    // The security property did not weaken, it moved: it is now a DOM-order
    // invariant asserted in HtmlPreviewPanel.test.tsx ("the page area cannot
    // overlap the strip"), which is stronger than an arithmetic one because a
    // strip that grows can no longer outgrow its own reservation.
    const { ref } = makePlaceholder(LAID_OUT)

    renderHook(() =>
      usePreviewBounds({
        placeholderRef: ref,
        panelId: PANEL_ID,
        enabled: true,
        isVisible: true,
        isLive: true,
        searchOpen: false
      })
    )

    const [, bounds] = setBounds.mock.calls[0] as [string, { y: number; height: number }]
    expect(bounds.y).toBe(LAID_OUT.top)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(LAID_OUT.top + LAID_OUT.height)
  })

  it('sends nothing more once a real rect has gone out and the panel is still', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    renderHook(() =>
      usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false })
    )

    expect(setBounds).toHaveBeenCalledTimes(1)
    // The loop keeps measuring (#124 C1), but an unchanged rect is not re-sent.
    frame()
    frame()
    expect(setBounds).toHaveBeenCalledTimes(1)
  })

  it('keeps measuring a panel that never gets a box, and sends nothing', () => {
    const { ref } = makePlaceholder(NO_BOX)

    renderHook(() =>
      usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false })
    )

    for (let i = 0; i < 200; i += 1) frame()

    expect(setBounds).not.toHaveBeenCalled()
    // No budget to spend: the loop stays armed while the tab is visible and live.
    expect(rafQueue).toHaveLength(1)
  })

  it('does not pump for a background tab', () => {
    const { ref, layout } = makePlaceholder(NO_BOX)

    renderHook(() =>
      usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: true, isVisible: false, isLive: true, searchOpen: false })
    )

    layout(LAID_OUT)
    frame()

    // An inactive tab is sized by the observer when it is activated, not by a
    // pump burning frames behind the scenes.
    expect(setBounds).not.toHaveBeenCalled()
  })

  it('pumps again when a suspended background tab becomes visible', () => {
    const { ref, layout } = makePlaceholder(NO_BOX)

    const { rerender } = renderHook(
      ({ isVisible }) =>
        usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: true, isVisible, isLive: true, searchOpen: false }),
      { initialProps: { isVisible: false } }
    )

    rerender({ isVisible: true })
    frame()
    layout(LAID_OUT)
    frame()

    expect(setBounds).toHaveBeenCalledWith(PANEL_ID, expect.objectContaining({ width: 400 }), expect.any(Number))
  })

  it('applies the find-bar inset to the pushed rect', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    renderHook(() =>
      usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: true })
    )
    // The pump's own push already carries the inset, so no toggle is needed.

    expect(setBounds).toHaveBeenCalledWith(
      PANEL_ID,
      expect.objectContaining({
        // The find bar stacks ON TOP of the always-present chrome strip.
        y: LAID_OUT.top + SEARCH_BAR_INSET_PX,
        height: LAID_OUT.height - SEARCH_BAR_INSET_PX
      }),
      expect.any(Number)
    )
  })

  it('sends nothing while the panel is refused', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    renderHook(() =>
      usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: false, isVisible: true, isLive: true, searchOpen: false })
    )

    frame()
    expect(setBounds).not.toHaveBeenCalled()
  })

  it('sends nothing before main has a view to apply it to', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    renderHook(() =>
      usePreviewBounds({
        placeholderRef: ref,
        panelId: PANEL_ID,
        enabled: true,
        isVisible: true,
        isLive: false,
        searchOpen: false
      })
    )

    frame()
    // `preview:open` has not returned, so main would drop this rect and the pump
    // would stand down having achieved nothing. Do not send it.
    expect(setBounds).not.toHaveBeenCalled()
  })

  it('pushes as soon as the view goes live, without waiting for a tab switch', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    const { rerender } = renderHook(
      ({ isLive }) =>
        usePreviewBounds({
          placeholderRef: ref,
          panelId: PANEL_ID,
          enabled: true,
          isVisible: true,
          isLive,
          searchOpen: false
        }),
      { initialProps: { isLive: false } }
    )
    expect(setBounds).not.toHaveBeenCalled()

    // Main installed the view and emitted its first non-idle load state.
    rerender({ isLive: true })

    expect(setBounds).toHaveBeenCalledWith(
      PANEL_ID,
      { x: 477, y: 41, width: 400, height: 827 },
      expect.any(Number)
    )
  })
})

describe('usePreviewBounds — publishing where the view sits', () => {
  it('publishes the rect so app chrome can place itself beside the view', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    renderHook(() =>
      usePreviewBounds({
        placeholderRef: ref,
        panelId: PANEL_ID,
        enabled: true,
        isVisible: true,
        isLive: true,
        searchOpen: false
      })
    )

    // The published rect is where the view ACTUALLY sits, chrome strip included,
    // so anything dodging it dodges the real rectangle.
    expect(usePreviewViewportStore.getState().rects.get(PANEL_ID)).toEqual({
      left: 477,
      top: 41,
      width: 400,
      height: 827
    })
  })

  it('clears the rect when the tab stops being visible', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    const { rerender } = renderHook(
      ({ isVisible }) =>
        usePreviewBounds({
          placeholderRef: ref,
          panelId: PANEL_ID,
          enabled: true,
          isVisible,
          isLive: true,
          searchOpen: false
        }),
      { initialProps: { isVisible: true } }
    )
    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(true)

    rerender({ isVisible: false })

    // A rect left behind would push the toast around a view that is no longer
    // on screen — a fault that looks exactly like the bug this machinery fixes.
    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(false)
  })

  it('clears the rect when the view is no longer live', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    const { rerender } = renderHook(
      ({ isLive }) =>
        usePreviewBounds({
          placeholderRef: ref,
          panelId: PANEL_ID,
          enabled: true,
          isVisible: true,
          isLive,
          searchOpen: false
        }),
      { initialProps: { isLive: true } }
    )
    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(true)

    rerender({ isLive: false })
    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(false)
  })

  it('clears the rect on unmount', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    const { unmount } = renderHook(() =>
      usePreviewBounds({
        placeholderRef: ref,
        panelId: PANEL_ID,
        enabled: true,
        isVisible: true,
        isLive: true,
        searchOpen: false
      })
    )
    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(true)

    unmount()
    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(false)
  })

  it('publishes nothing while the panel is refused', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    renderHook(() =>
      usePreviewBounds({
        placeholderRef: ref,
        panelId: PANEL_ID,
        enabled: false,
        isVisible: true,
        isLive: true,
        searchOpen: false
      })
    )

    expect(usePreviewViewportStore.getState().rects.has(PANEL_ID)).toBe(false)
  })
})

describe('usePreviewBounds — drop-point logging (#124 P1-AC1)', () => {
  /** Mounts the hook with every gate open; `props` overrides any of them. */
  function mountHook(ref: React.RefObject<HTMLElement>, props: Partial<UsePreviewBoundsOptions> = {}) {
    return renderHook(
      (p: Partial<UsePreviewBoundsOptions>) =>
        usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false, ...p }),
      { initialProps: props }
    )
  }

  /** The structured context of every drop line written at `level`. */
  const lines = (level: 'info' | 'warn'): unknown[] =>
    log[level].mock.calls.filter(([message]) => message === BOUNDS_DROP_MESSAGE).map(([, context]) => context)

  it('R1: a push while disabled is one info line with the panel, and no seq before any send', () => {
    const { result } = mountHook(makePlaceholder(LAID_OUT).ref, { enabled: false })

    expect(result.current.pushBounds()).toBe(false)
    expect(lines('info')).toEqual([{ source: 'renderer', reason: 'disabled', panelId: stablePathDigest(PANEL_ID) }])
  })

  it('R2: a missing placeholder is one info line', () => {
    mountHook({ current: null })

    expect(lines('info')).toEqual([{ source: 'renderer', reason: 'no-placeholder', panelId: stablePathDigest(PANEL_ID) }])
  })

  it('R3: a degenerate rect is logged with the measured rect, rounded to whole pixels', () => {
    // A find inset taller than the box: the one R3 cause whose rect is not 0×0.
    const { ref } = makePlaceholder({ left: 10.4, top: 20.6, width: 300, height: 30 })
    mountHook(ref, { searchOpen: true })

    expect(lines('info')).toEqual([
      { source: 'renderer', reason: 'degenerate-rect', panelId: stablePathDigest(PANEL_ID), rect: { x: 10, y: 21, w: 300, h: 30 } }
    ])
    expect(log.info.mock.calls[0]?.[0]).toBe(BOUNDS_DROP_MESSAGE)
  })

  it('R3 covers a box that never lands (R6 retired): 200 still frames log one line and no warn', () => {
    mountHook(makePlaceholder(NO_BOX).ref)
    for (let i = 0; i < 200; i += 1) frame()

    expect(lines('info')).toHaveLength(1)
    expect(lines('warn')).toEqual([])
  })

  it('caps repeats: the next line after the window carries how many were swallowed', () => {
    // A background tab: no pump, so every push below is the test's own.
    const { result } = mountHook(makePlaceholder(NO_BOX).ref, { isVisible: false })
    result.current.pushBounds()
    result.current.pushBounds()
    result.current.pushBounds()
    clock = PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS - 1
    result.current.pushBounds()
    expect(lines('info')).toHaveLength(1)

    clock = PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS
    result.current.pushBounds()
    expect(lines('info')).toEqual([
      expect.objectContaining({ reason: 'degenerate-rect' }),
      expect.objectContaining({ reason: 'degenerate-rect', suppressed: 3 })
    ])
  })

  it('gives each reason its own first line and, after a send, the last seq sent', () => {
    const { ref, layout } = makePlaceholder(LAID_OUT)
    const { result, rerender } = mountHook(ref)
    // A sent rect is not a drop.
    expect(log.info).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()

    layout(NO_BOX)
    result.current.pushBounds()
    rerender({ enabled: false })
    result.current.pushBounds()

    const [lastSeq] = setBounds.mock.calls[0]?.slice(2) as [number]
    expect(lines('info')).toEqual([
      expect.objectContaining({ reason: 'degenerate-rect', lastSeq }),
      expect.objectContaining({ reason: 'disabled', lastSeq })
    ])
    expect(lines('info')[0]).not.toHaveProperty('seq')
  })

  it('treats each mount as its own scope, so a remount logs its first drop again', () => {
    const { ref } = makePlaceholder(NO_BOX)
    mountHook(ref).unmount()
    mountHook(ref)

    expect(lines('info')).toHaveLength(2)
  })
})

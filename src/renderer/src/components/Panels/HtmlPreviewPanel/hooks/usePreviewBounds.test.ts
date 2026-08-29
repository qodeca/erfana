// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewBounds — the first-rect pump (issue #74 follow-up).
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
 * vanishes main-side, so the pump must run again once the view is live.
 *
 * The `ResizeObserver` is deliberately inert in these tests (the renderer test
 * setup's `MockResizeObserver` never invokes its callback). That is not a
 * convenience: dockview re-parents an `always`-rendered panel rather than
 * resizing it in place, so the 0×0 → laid-out transition need not produce a
 * resize callback at all. The pump has to hold on its own.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  usePreviewBounds,
  PREVIEW_CHROME_INSET_PX,
  SEARCH_BAR_INSET_PX
} from './usePreviewBounds'
import { usePreviewViewportStore } from '../../../../stores/usePreviewViewportStore'

const PANEL_ID = 'preview-panel-1'

/** A laid-out placeholder rect, matching what dockview gives an active tab. */
const LAID_OUT = { left: 477, top: 41, width: 400, height: 827 }
/** What an inactive dockview tab measures: no box at all. */
const NO_BOX = { left: 0, top: 0, width: 0, height: 0 }

/** Queue of pending animation-frame callbacks, flushed explicitly by `frame()`. */
let rafQueue: FrameRequestCallback[] = []
let setBounds: ReturnType<typeof vi.fn>

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
      { x: 477, y: 41 + PREVIEW_CHROME_INSET_PX, width: 400, height: 827 - PREVIEW_CHROME_INSET_PX },
      expect.any(Number)
    )
  })

  it('always leaves room for the chrome strip the page cannot paint over', () => {
    // A security control, not a margin: the strip is how a reader tells a real
    // Erfana prompt from one an untrusted page drew, so the view must never be
    // allowed to cover it — including when the find bar is closed.
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
    expect(bounds.y).toBeGreaterThanOrEqual(LAID_OUT.top + PREVIEW_CHROME_INSET_PX)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(LAID_OUT.top + LAID_OUT.height)
  })

  it('stops asking once a real rect has gone out', () => {
    const { ref } = makePlaceholder(LAID_OUT)

    renderHook(() =>
      usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false })
    )

    expect(setBounds).toHaveBeenCalledTimes(1)
    // The pump stood down on the first success rather than re-queueing itself.
    expect(rafQueue).toHaveLength(0)
    frame()
    expect(setBounds).toHaveBeenCalledTimes(1)
  })

  it('gives up rather than measuring forever when the panel never gets a box', () => {
    const { ref } = makePlaceholder(NO_BOX)

    renderHook(() =>
      usePreviewBounds({ placeholderRef: ref, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false })
    )

    // Far more frames than the budget allows.
    for (let i = 0; i < 200; i += 1) frame()

    expect(setBounds).not.toHaveBeenCalled()
    expect(rafQueue).toHaveLength(0)
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
        y: LAID_OUT.top + PREVIEW_CHROME_INSET_PX + SEARCH_BAR_INSET_PX,
        height: LAID_OUT.height - PREVIEW_CHROME_INSET_PX - SEARCH_BAR_INSET_PX
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
      { x: 477, y: 41 + PREVIEW_CHROME_INSET_PX, width: 400, height: 827 - PREVIEW_CHROME_INSET_PX },
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
      top: 41 + PREVIEW_CHROME_INSET_PX,
      width: 400,
      height: 827 - PREVIEW_CHROME_INSET_PX
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

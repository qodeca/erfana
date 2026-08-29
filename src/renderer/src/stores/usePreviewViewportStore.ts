// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where each live HTML preview's native view sits on screen, in CSS pixels
 * (issue #74 follow-up).
 *
 * WHY THIS EXISTS. A previewed page runs in a native `WebContentsView` that the
 * OS composites ABOVE all sibling DOM. Erfana's own chrome therefore has to know
 * where those rectangles are if it wants to stay visible beside one instead of
 * hiding it. Today only the toast stack uses this, to place itself clear of a
 * preview rather than blanking it; dialogs, settings and menus still take the
 * hide path, which is right for them because they are large and modal.
 *
 * NO FEEDBACK LOOP. A panel publishes its rect whenever its tab is active and
 * its view is live — deliberately NOT "whenever the view is actually visible".
 * Occlusion is the overlay guard's output, and the toast's placement is one of
 * the guard's inputs; keying this on visibility would make the toast hide the
 * view, the hidden view withdraw its rect, the toast unhide the view, and so on
 * every frame. The rect published here is "where the view would be", which is
 * stable under that decision.
 *
 * The rect is viewport-relative and in CSS pixels — the same units
 * `getBoundingClientRect()` reports and `deriveBounds` sends to main, before
 * main's zoom-to-DIP conversion.
 */

import { create } from 'zustand'

/** A native preview view's on-screen rectangle, in CSS pixels. */
export interface PreviewRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Store contract. */
export interface PreviewViewportState {
  /** Rect per panel id, for panels whose native view is placed on screen. */
  rects: ReadonlyMap<string, PreviewRect>
  /** Record (or update) where a panel's native view sits. */
  setRect: (panelId: string, rect: PreviewRect) => void
  /**
   * Forget a panel's rect.
   *
   * MUST be called when the panel stops being the visible tab, when its view is
   * torn down, and on unmount. A rect left behind would push Erfana's own chrome
   * around a view that is no longer there — a fault that looks exactly like the
   * bug this machinery exists to fix.
   */
  clearRect: (panelId: string) => void
}

/** Every recorded rect, as an array. Stable empty array when there are none. */
const NO_RECTS: readonly PreviewRect[] = []

export const usePreviewViewportStore = create<PreviewViewportState>((set) => ({
  rects: new Map<string, PreviewRect>(),

  setRect: (panelId, rect) =>
    set((state) => {
      const current = state.rects.get(panelId)
      if (
        current !== undefined &&
        current.left === rect.left &&
        current.top === rect.top &&
        current.width === rect.width &&
        current.height === rect.height
      ) {
        // The bounds pump re-sends the same rect on every observer fire; not
        // publishing an identical value keeps subscribers from re-rendering.
        return state
      }
      const rects = new Map(state.rects)
      rects.set(panelId, rect)
      return { rects }
    }),

  clearRect: (panelId) =>
    set((state) => {
      if (!state.rects.has(panelId)) {
        return state
      }
      const rects = new Map(state.rects)
      rects.delete(panelId)
      return { rects }
    })
}))

/**
 * Every recorded preview rect.
 *
 * Reads the live store rather than taking a selector, so a caller that needs the
 * rects at a specific moment — computing a placement, say — gets the settled
 * values rather than a React-render-time snapshot.
 *
 * @returns The rects, or a stable empty array.
 */
export function readPreviewRects(): readonly PreviewRect[] {
  const { rects } = usePreviewViewportStore.getState()
  return rects.size === 0 ? NO_RECTS : [...rects.values()]
}

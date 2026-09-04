// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview bounds zoom-conversion + content-rect clamp (Issue #74, work item 39;
 * design §4.3).
 *
 * Extracted from `PreviewViewService` as a pure function so the coordinate math
 * is unit-testable without a real `BrowserWindow` and so the service stays under
 * the 500-line file cap.
 *
 * `getBoundingClientRect()` in the renderer returns **CSS pixels**;
 * `View.setBounds` takes **DIPs relative to the window content view**, and a
 * native `View` is a sibling surface unaffected by the host renderer's zoom.
 * Browser zoom scales CSS px onto DIPs, so a CSS-px rect is MULTIPLIED by the
 * zoom factor (`getZoomFactor()` is "zoom percent / 100", so 300 % = 3.0 and a
 * 100-CSS-px placeholder occupies 300 DIPs — design §4.3, `electron.d.ts:17732`).
 *
 * After conversion the rect is clamped to the window content rect (origin
 * `(0,0)`, the child-view coordinate space), and any rect whose width or height
 * is `<= 0` after clamping is DROPPED — the caller must not call `setBounds`.
 */

/** A rectangle in some coordinate space. */
export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Convert a CSS-pixel rect to a clamped DIP rect for `View.setBounds`.
 *
 * @param cssRect - the renderer-supplied rect in CSS pixels
 * @param contentSize - the host window content-view size in DIPs; the clamp
 *   region is `{ 0, 0, width, height }` because child-view bounds are relative
 *   to the content view
 * @param zoomFactor - the host window's zoom factor (percent / 100)
 * @returns the clamped DIP rect, or `null` when it collapses to `<= 0` on either
 *   axis (out of view, or a zero/negative input) — the caller must not paint it
 */
export function clampAndZoomBounds(
  cssRect: RectLike,
  contentSize: { width: number; height: number },
  zoomFactor: number
): RectLike | null {
  // A non-finite or non-positive zoom would corrupt every coordinate; fall back
  // to 1.0 (100 %) rather than emit NaN bounds.
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1

  const left = Math.round(cssRect.x * zoom)
  const top = Math.round(cssRect.y * zoom)
  const right = Math.round((cssRect.x + cssRect.width) * zoom)
  const bottom = Math.round((cssRect.y + cssRect.height) * zoom)

  // Clamp to the content rect: the child view's coordinate space has origin
  // (0,0), so the visible region is [0, contentSize.width] × [0, contentSize.height].
  const clampedLeft = Math.max(0, Math.min(left, contentSize.width))
  const clampedTop = Math.max(0, Math.min(top, contentSize.height))
  const clampedRight = Math.max(0, Math.min(right, contentSize.width))
  const clampedBottom = Math.max(0, Math.min(bottom, contentSize.height))

  const width = clampedRight - clampedLeft
  const height = clampedBottom - clampedTop

  // A rect that clamped to nothing (offscreen, or a zero/negative input) is dropped.
  if (width <= 0 || height <= 0) {
    return null
  }

  return { x: clampedLeft, y: clampedTop, width, height }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – where the comment window goes
 * (docs/designs/comments/html-preview-comments.md §10.4 "Placement").
 *
 * Right of the picked point, else left, else below, else above, always inside
 * the page area less an 8px margin; under 400px of page-area width the window
 * becomes a sheet across the page area's foot. Pure – the window measures
 * itself and calls this, so the rule is testable without layout.
 *
 * The anchor is the POINT main sent with the draft (host-window CSS pixels,
 * already clamped to the panel) – the element's own box never leaves main.
 *
 * @module HtmlPreviewPanel/comments/commentPlacement
 */

/** Below this page-area width the window is a sheet (§10.4). */
export const SHEET_BELOW_PX = 400

// The three numbers below MIRROR the stylesheet: placement is arithmetic and
// cannot read a custom property cheaply on every resize. comments.tokens.test.ts
// pins each one to its source, so a change on either side fails there.

/**
 * Margin kept between the window and the page area's edges (half of the 16px
 * §10.4 takes off). Mirrors `--space-4`.
 */
export const EDGE_PX = 8
/** The window's widest inline size. Mirrors `--comments-window-max-width`. */
export const WINDOW_MAX_WIDTH_PX = 480
/**
 * The window's tallest block size. Mirrors the `min(560px, …)` literal of
 * `.erf-comment-window` in CommentWindow.css (a recorded window-card exception).
 */
export const WINDOW_MAX_HEIGHT_PX = 560
/** Gap between the anchor point and the window. */
export const ANCHOR_GAP_PX = 12

/** A box in viewport CSS pixels. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Where the window is drawn. */
export type WindowPlacement =
  | {
      readonly kind: 'sheet'
      readonly left: number
      readonly width: number
      readonly bottom: number
      readonly maxHeight: number
    }
  | {
      readonly kind: 'float'
      readonly side: 'right' | 'left' | 'below' | 'above'
      readonly left: number
      readonly top: number
      readonly maxWidth: number
      readonly maxHeight: number
    }

/** Clamps `value` into `[min, max]`; `min` wins when the range is empty. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/**
 * Places the window.
 *
 * @param point - The anchor, viewport CSS pixels.
 * @param size - The window's measured size (its natural size before placement).
 * @param area - The page area's box.
 * @param viewportHeight - `window.innerHeight`, for the sheet's `bottom`.
 * @returns The placement.
 *
 * @example
 * ```ts
 * placeCommentWindow({ x: 100, y: 80 }, { width: 360, height: 300 },
 *   { left: 0, top: 40, width: 900, height: 600 }, 640)
 * // { kind: 'float', side: 'right', left: 112, top: 68, … }
 * ```
 */
export function placeCommentWindow(
  point: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  area: Box,
  viewportHeight: number
): WindowPlacement {
  const right = area.left + area.width
  const bottom = area.top + area.height
  // §10.4: block size ≤ min(560px, page area − 16px); inline ≤ min(480px, page area − 16px).
  const maxHeight = Math.max(0, Math.min(WINDOW_MAX_HEIGHT_PX, area.height - 2 * EDGE_PX))
  if (area.width < SHEET_BELOW_PX) {
    return {
      kind: 'sheet',
      left: area.left,
      width: area.width,
      bottom: Math.max(0, viewportHeight - bottom),
      maxHeight
    }
  }
  const maxWidth = Math.max(0, Math.min(WINDOW_MAX_WIDTH_PX, area.width - 2 * EDGE_PX))
  const width = Math.min(size.width, maxWidth)
  const height = Math.min(size.height, maxHeight)
  const minLeft = area.left + EDGE_PX
  const maxLeft = right - EDGE_PX - width
  const minTop = area.top + EDGE_PX
  const maxTop = bottom - EDGE_PX - height
  // Beside the point, the window's top a little above it so the title sits level with the element.
  const besideTop = clamp(point.y - ANCHOR_GAP_PX, minTop, maxTop)

  if (point.x + ANCHOR_GAP_PX + width <= right - EDGE_PX) {
    return {
      kind: 'float',
      side: 'right',
      left: point.x + ANCHOR_GAP_PX,
      top: besideTop,
      maxWidth,
      maxHeight
    }
  }
  if (point.x - ANCHOR_GAP_PX - width >= minLeft) {
    return {
      kind: 'float',
      side: 'left',
      left: point.x - ANCHOR_GAP_PX - width,
      top: besideTop,
      maxWidth,
      maxHeight
    }
  }
  const centredLeft = clamp(point.x - width / 2, minLeft, maxLeft)
  if (point.y + ANCHOR_GAP_PX + height <= bottom - EDGE_PX) {
    return {
      kind: 'float',
      side: 'below',
      left: centredLeft,
      top: point.y + ANCHOR_GAP_PX,
      maxWidth,
      maxHeight
    }
  }
  return {
    kind: 'float',
    side: 'above',
    left: centredLeft,
    top: clamp(point.y - ANCHOR_GAP_PX - height, minTop, maxTop),
    maxWidth,
    maxHeight
  }
}

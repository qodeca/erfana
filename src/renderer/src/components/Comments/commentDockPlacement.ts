// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – where the Markdown Preview's non-modal comment window sits
 * (comments-v2 C-18, R-15; differences table D-01). Pure arithmetic.
 *
 * - When the target is scrolled out of the pane, the window folds to an
 *   edge tab at the pane's top or bottom edge ("Comment on paragraph, line
 *   12 ↑"), which brings it back.
 * - When at least {@link MARGIN_MIN_PX} is free between the text column's
 *   right edge and the pane's, the window sits in that margin, top-aligned
 *   with its target.
 * - Otherwise the shipped order: right, left, below, above the target
 *   (`placeCommentWindow`), and a sheet in a narrow pane.
 *
 * Every box is in viewport pixels, as `getBoundingClientRect` gives them.
 *
 * @module components/Comments/commentDockPlacement
 */
import {
  ANCHOR_GAP_PX,
  EDGE_PX,
  WINDOW_MAX_HEIGHT_PX,
  WINDOW_MAX_WIDTH_PX,
  placeCommentWindow,
  type Box,
  type WindowPlacement
} from './commentPlacement'

/** Free width right of the text column that holds the window in the margin (C-18). */
export const MARGIN_MIN_PX = 376

/** Where the docked window goes. */
export type DockedPlacement =
  | WindowPlacement
  | { readonly kind: 'margin'; readonly left: number; readonly top: number; readonly maxWidth: number; readonly maxHeight: number }
  | { readonly kind: 'edge'; readonly above: boolean; readonly left: number; readonly top: number }

/** What the docked window is placed against. */
export interface DockInput {
  /** The target's box now; `null` when it cannot be found (the request's point stands in). */
  readonly anchor: Box | null
  readonly point: { readonly x: number; readonly y: number }
  readonly size: { readonly width: number; readonly height: number }
  /** The preview pane. */
  readonly area: Box
  /** The rendered text column; `null` when unknown. */
  readonly column: Box | null
  readonly viewportHeight: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/**
 * The docked window's place (module comment).
 *
 * @param input - {@link DockInput}
 * @returns An edge tab, the margin, or the shipped placement.
 */
export function placeDocked(input: DockInput): DockedPlacement {
  const { anchor, point, size, area, column, viewportHeight } = input
  const right = area.left + area.width
  const bottom = area.top + area.height
  if (anchor !== null && (anchor.top + anchor.height <= area.top || anchor.top >= bottom)) {
    const above = anchor.top + anchor.height <= area.top
    return { kind: 'edge', above, left: right - EDGE_PX, top: above ? area.top + EDGE_PX : bottom - EDGE_PX }
  }
  const free = column === null ? 0 : right - (column.left + column.width)
  if (column !== null && free >= MARGIN_MIN_PX) {
    const maxHeight = Math.max(0, Math.min(WINDOW_MAX_HEIGHT_PX, area.height - 2 * EDGE_PX))
    const maxWidth = Math.max(0, Math.min(WINDOW_MAX_WIDTH_PX, free - ANCHOR_GAP_PX - EDGE_PX))
    const height = Math.min(size.height, maxHeight)
    const top = clamp(anchor?.top ?? point.y, area.top + EDGE_PX, bottom - EDGE_PX - height)
    return { kind: 'margin', left: column.left + column.width + ANCHOR_GAP_PX, top, maxWidth, maxHeight }
  }
  const at = anchor === null ? point : { x: anchor.left + anchor.width, y: anchor.top }
  return placeCommentWindow(at, size, area, viewportHeight)
}

/**
 * `placement`, from viewport pixels into the box a `position: fixed` element
 * is really placed against. The docked window renders inside its tab, and an
 * ancestor with `contain: layout` (dockview's `.dv-dockview`), a transform or
 * a filter makes itself that box – so viewport pixels would land shifted by
 * the ancestor's offset, off the pane.
 *
 * @param placement - Where the window goes, in viewport pixels.
 * @param frame - The fixed box's containing block, in viewport pixels (the viewport itself when nothing captures it).
 * @param viewportHeight - `window.innerHeight`, which a sheet's `bottom` was measured from.
 * @returns The same placement in the frame's pixels.
 */
export function inFixedFrame(placement: DockedPlacement, frame: Box, viewportHeight: number): DockedPlacement {
  if (placement.kind === 'sheet') {
    const below = viewportHeight - (frame.top + frame.height)
    return { ...placement, left: placement.left - frame.left, bottom: placement.bottom - below }
  }
  return { ...placement, left: placement.left - frame.left, top: placement.top - frame.top }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the comment menu opens, in Erfana's window (docs/designs/
 * html-preview-comments.md §7.3 step 4, §10.3, §19 R3-5; spike S4).
 *
 * - A pointer pick carries the trusted event's `screenX/Y` (R3-5): the point is
 *   `(screen − window content origin) / host zoom`. It needs no frame offset,
 *   because the screen is the same for every frame. A (0, 0) screen point – a
 *   platform that reported none – falls back to the cursor's position.
 * - A keyboard pick carries the element's top-left + 4 px in its own frame:
 *   the frame's offset in the top frame and the view's own rectangle place it,
 *   `(view.x + (offset + point) × page zoom) / host zoom`.
 *
 * Either is clamped to the panel, so a forged or stale value only misplaces
 * the menu inside the preview it belongs to.
 */
import type { PreviewBounds } from '../../../../shared/ipc/preview-types'
import type { CommentPick, CommentPoint } from '../../../../shared/ipc/preview-comment-schema'
import type { FrameOffset } from './commentScripts'

/** What the point is computed from. */
export interface MenuPointInput {
  readonly pick: Pick<CommentPick, 'via' | 'screen' | 'point'>
  /** The picked frame's content origin in the top frame (keyboard picks). */
  readonly frameOffset: FrameOffset | null
  /** The view's rectangle in the window, in DIPs (`bounds.lastRect()`). */
  readonly viewRect: PreviewBounds | null
  /** The window's content rectangle on screen, in DIPs. */
  readonly contentBounds: { readonly x: number; readonly y: number }
  /** The host window's own zoom: renderer CSS pixels × zoom = DIPs. */
  readonly hostZoom: number
  /** The page's zoom factor. */
  readonly pageZoom: number
  /** The cursor on screen, for a pointer pick without a screen point. */
  readonly cursor: () => { readonly x: number; readonly y: number }
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/** The menu's point in host-window CSS pixels, clamped to the panel. */
export function menuPoint(input: MenuPointInput): CommentPoint {
  const hostZoom = positive(input.hostZoom)
  const pageZoom = positive(input.pageZoom)
  let x: number
  let y: number
  if (input.pick.via === 'pointer') {
    const reported = input.pick.screen
    const screen = reported === undefined || (reported.x === 0 && reported.y === 0) ? input.cursor() : reported
    x = (screen.x - input.contentBounds.x) / hostZoom
    y = (screen.y - input.contentBounds.y) / hostZoom
  } else {
    const point = input.pick.point ?? { x: 0, y: 0 }
    const offset = input.frameOffset ?? { x: 0, y: 0 }
    const rect = input.viewRect ?? { x: 0, y: 0, width: 0, height: 0 }
    x = (rect.x + (offset.x + point.x) * pageZoom) / hostZoom
    y = (rect.y + (offset.y + point.y) * pageZoom) / hostZoom
  }
  const rect = input.viewRect
  if (rect !== null && rect.width > 0 && rect.height > 0) {
    x = clamp(x, rect.x / hostZoom, (rect.x + rect.width) / hostZoom - 1)
    y = clamp(y, rect.y / hostZoom, (rect.y + rect.height) / hostZoom - 1)
  }
  return { x: Math.round(x), y: Math.round(y) }
}

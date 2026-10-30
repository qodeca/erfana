// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A right-click out of comment mode (OD-01 `context` pick) opens Erfana's
 * menu only when the real cursor is where the page says the click was
 * (security review L-1).
 *
 * The pick comes from the page's renderer. A compromised one could send it
 * at any moment and pop Erfana's menu over whatever the reader is doing; a
 * real right-click leaves the cursor on the view, at the event's
 * `screenX/Y`. So main reads the cursor itself (`screen.getCursorScreenPoint`)
 * and keeps the pick only when the cursor is over the view's rectangle on
 * screen and within {@link CONTEXT_CURSOR_SLACK_DIP} of the reported point.
 * Anything else – no reported point, no view rectangle, no cursor source –
 * is dropped: the gate fails closed.
 *
 * All values are screen DIPs: the window's content origin plus the view's
 * rectangle in the window (`commentMenuPoint.ts` uses the same frame).
 */
import type { CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import type { PreviewBounds } from '../../../../shared/ipc/preview-types'

/** How far the cursor may be from the reported point: a click's own jitter, never another place. */
export const CONTEXT_CURSOR_SLACK_DIP = 4

/** Where the view is and where the cursor is now. */
export interface ContextGateGeometry {
  /** The view's rectangle in the window, in DIPs. */
  readonly viewRect: () => PreviewBounds | null
  /** The window's content rectangle on screen, in DIPs. */
  readonly contentBounds: () => { readonly x: number; readonly y: number }
  /** The real cursor on screen; absent: no source, the gate refuses. */
  readonly cursor?: () => { readonly x: number; readonly y: number }
}

/**
 * Whether `pick` is a right-click the reader really made (module comment).
 *
 * @param pick - A checked `context` pick.
 * @param geometry - {@link ContextGateGeometry}
 * @returns `true` only when the real cursor is over the view and at the reported point.
 */
export function realContextClick(pick: Pick<CommentPick, 'screen'>, geometry: ContextGateGeometry): boolean {
  const reported = pick.screen
  const rect = geometry.viewRect()
  if (reported === undefined || rect === null || rect.width <= 0 || rect.height <= 0 || geometry.cursor === undefined) return false
  const cursor = geometry.cursor()
  const content = geometry.contentBounds()
  const left = content.x + rect.x
  const top = content.y + rect.y
  const overView = cursor.x >= left && cursor.x < left + rect.width && cursor.y >= top && cursor.y < top + rect.height
  const atPoint = Math.abs(cursor.x - reported.x) <= CONTEXT_CURSOR_SLACK_DIP && Math.abs(cursor.y - reported.y) <= CONTEXT_CURSOR_SLACK_DIP
  return overView && atPoint
}

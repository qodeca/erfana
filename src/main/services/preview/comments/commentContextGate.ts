// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every pick that opens a menu or a window – `context`, `menu`, `open`, `icon` –
 * needs real input main saw on this view itself (security review L-1). The pick
 * comes from the page's renderer: a compromised one could send it at any moment
 * to pop Erfana's menu over whatever the reader is doing, or to mint drafts
 * until the one in the reader's open window is forgotten (`MAX_DRAFTS`). So a
 * page alone can open nothing, and each route answers to its own evidence, a
 * {@link ContextKeyGate} of its own.
 *
 * **Pointer.** A real press reaches the view's `input-event` in main
 * (`previewStillFrameFreshness.ts`), which no page API reaches. That is proof
 * that the reader pressed, and it says nothing about what the press was on: the
 * renderer still names the element and the point. A `context` pick, and an
 * `open` pick outside comment mode (the Comment button, differences table
 * D-10), must also pass {@link realContextClick}: main reads the cursor itself
 * (`screen.getCursorScreenPoint`) and keeps the pick only when the cursor is
 * over the view's rectangle on screen and within
 * {@link CONTEXT_CURSOR_SLACK_DIP} of the reported point. Anything else – no
 * reported point, no view rectangle, no cursor source – is dropped: the gate
 * fails closed. All values are screen DIPs: the window's content origin plus
 * the view's rectangle in the window (`commentMenuPoint.ts` uses the same frame).
 *
 * **Keyboard (owner decision, 2026-11-01; K-1).** A key press has no cursor, so
 * a `via: 'keyboard'` pick needs a real key press instead. Main records it in
 * `before-input-event`, which runs before the page sees the key and which no
 * page API reaches: Shift+F10 or the Menu key, and in comment mode Enter.
 *
 * Either press is good for {@link CONTEXT_KEY_WINDOW_MS} and for one pick, so a
 * renderer cannot bank presses or replay one; a page or mode change forgets it.
 * What a compromised renderer keeps is the choice of element and point for one
 * pick after each real press, which it can spend before the reader's own pick
 * does: `commentMenuPoint.ts` clamps the point to the panel, and the element
 * checks and the menu's own confirmation still stand.
 */
import type { CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import type { PreviewBounds } from '../../../../shared/ipc/preview-types'

/** How far the cursor may be from the reported point: a click's own jitter, never another place. */
export const CONTEXT_CURSOR_SLACK_DIP = 4

/** How long a recorded press lets a pick through. */
export const CONTEXT_KEY_WINDOW_MS = 1_000

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
 * Whether `pick` is a click the reader really made there (module comment).
 *
 * @param pick - A checked `context` pick, or the Comment button's `open` pick.
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

/** The last real press on one view, by one route, spent by the pick it let through (module comment). */
export class ContextKeyGate {
  private pressedAt: number | null = null

  /** Main saw a real press, at `now`. */
  press(now: number): void {
    this.pressedAt = now
  }

  /**
   * The press ended, at `now`. A click and a Windows right-click reach the page
   * at the release, however long the button was held, so an unspent press is
   * good from here. A spent one stays spent: one press, one pick.
   */
  release(now: number): void {
    if (this.pressedAt !== null) this.pressedAt = now
  }

  /**
   * Whether a press lets a pick through at `now`. An attempt that reaches this
   * gate spends the press, whatever becomes of the pick; one dropped before it,
   * for its budget, frame or mode, does not.
   */
  take(now: number): boolean {
    const pressedAt = this.pressedAt
    this.pressedAt = null
    return pressedAt !== null && now >= pressedAt && now - pressedAt < CONTEXT_KEY_WINDOW_MS
  }

  /** The page or the mode changed: a press made before it buys nothing after it. */
  clear(): void {
    this.pressedAt = null
  }
}

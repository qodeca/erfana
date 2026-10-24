// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shift+F10 / the Menu key in the terminal open its context menu (#90).
 *
 * Kept out of `TerminalPanel.tsx` so the routing can be tested without an
 * xterm instance.
 *
 * Trade-off, stated: a program running in the terminal no longer receives
 * Shift+F10 (xterm would send `ESC [21;2~`). Agent CLIs do not bind it, and it
 * is the platform's standard way to reach a context menu from the keyboard
 * (design/system/components/menu). The Menu key has no terminal encoding, so
 * nothing is lost there.
 */
import { isContextMenuKey, markKeyboardMenuOpen } from '../../ContextMenu/contextMenuKey'

/** A point in viewport coordinates, where the menu's top-left goes */
export interface MenuAnchor {
  x: number
  y: number
}

/** Gap kept from the panel's right and bottom edges when the anchor is pulled in, and from its top-left in the fallback */
export const ANCHOR_PADDING_PX = 8

/**
 * The parts of an xterm instance {@link terminalCursorAnchor} reads. Only
 * public API: the screen element's box, the grid size and the cursor.
 */
export interface CursorAnchorSource {
  cols: number
  rows: number
  element?: HTMLElement
  buffer: { active: { cursorX: number; cursorY: number; baseY: number; viewportY: number } }
}

/**
 * Where a keyboard-opened terminal menu goes: just below the cursor cell.
 *
 * Not the helper textarea xterm keeps at the cursor – the panel parks that
 * off-screen (`left/top: -9999px` in TerminalPanel.css), so its box would put
 * the menu in the window's top-left corner. The cell is found from the
 * `.xterm-screen` box divided by the grid (`cols` × `rows`), and the cursor
 * row is taken relative to the rows on screen (`baseY + cursorY - viewportY`),
 * so a scrolled-back viewport still anchors where the cursor shows. The point
 * is kept inside the terminal element (pulled in by the padding only past its
 * right or bottom edge); with no usable screen box it falls back to the
 * element's top-left plus padding.
 *
 * @param xterm - The instance, or anything with the same public fields
 * @returns The anchor in viewport coordinates
 *
 * @example
 * ```ts
 * routeTerminalMenuKey(event, () => terminalCursorAnchor(xterm), open)
 * ```
 */
export function terminalCursorAnchor(xterm: CursorAnchorSource): MenuAnchor {
  const panel = xterm.element?.getBoundingClientRect()
  const fallback: MenuAnchor = {
    x: (panel?.left ?? 0) + ANCHOR_PADDING_PX,
    y: (panel?.top ?? 0) + ANCHOR_PADDING_PX
  }
  const screen = xterm.element?.querySelector('.xterm-screen')?.getBoundingClientRect()
  if (!panel || !screen || screen.width <= 0 || screen.height <= 0 || xterm.cols <= 0 || xterm.rows <= 0) {
    return fallback
  }
  const cellWidth = screen.width / xterm.cols
  const cellHeight = screen.height / xterm.rows
  const { cursorX, cursorY, baseY, viewportY } = xterm.buffer.active
  const col = clamp(cursorX, 0, xterm.cols - 1)
  const row = clamp(baseY + cursorY - viewportY, 0, xterm.rows - 1)
  return {
    // A point already inside the panel stays where it is (column 0 is not
    // pushed right); only one past an edge is pulled in, by the padding
    x: clamp(screen.left + col * cellWidth, panel.left, panel.right - ANCHOR_PADDING_PX),
    y: clamp(screen.top + (row + 1) * cellHeight, panel.top, panel.bottom - ANCHOR_PADDING_PX)
  }
}

function clamp(value: number, min: number, max: number): number {
  // A panel narrower or shorter than the padding: keep its near edge
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * Route one key event from xterm's custom key handler.
 *
 * Both `keydown` and the matching `keypress` / `keyup` are swallowed so the
 * shell never sees half of the chord; only the `keydown` opens the menu.
 *
 * @param event - The event xterm hands its custom key handler
 * @param anchor - Where the menu goes, asked only when it opens (see
 *   {@link terminalCursorAnchor})
 * @param open - Opens the terminal menu at viewport coordinates
 * @returns True when the event was the menu key and xterm must ignore it
 *
 * @example
 * ```ts
 * xterm.attachCustomKeyEventHandler((event) =>
 *   routeTerminalMenuKey(event, () => terminalCursorAnchor(xterm), open) ? false : next(event)
 * )
 * ```
 */
export function routeTerminalMenuKey(
  event: KeyboardEvent,
  anchor: () => MenuAnchor,
  open: (x: number, y: number) => void
): boolean {
  if (!isContextMenuKey(event)) return false
  if (event.type === 'keydown') {
    event.preventDefault()
    markKeyboardMenuOpen()
    const point = anchor()
    open(point.x, point.y)
  }
  return true
}

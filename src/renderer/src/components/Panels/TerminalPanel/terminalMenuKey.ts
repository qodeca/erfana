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
import { isContextMenuKey, markKeyboardMenuOpen, menuAnchorBelow } from '../../ContextMenu/contextMenuKey'

/**
 * Route one key event from xterm's custom key handler.
 *
 * Both `keydown` and the matching `keypress` / `keyup` are swallowed so the
 * shell never sees half of the chord; only the `keydown` opens the menu.
 *
 * @param event - The event xterm hands its custom key handler
 * @param caret - xterm's helper textarea (it sits at the cursor), or the
 *   terminal element when that is missing
 * @param open - Opens the terminal menu at viewport coordinates
 * @returns True when the event was the menu key and xterm must ignore it
 *
 * @example
 * ```ts
 * xterm.attachCustomKeyEventHandler((event) =>
 *   routeTerminalMenuKey(event, xterm.textarea ?? null, open) ? false : next(event)
 * )
 * ```
 */
export function routeTerminalMenuKey(
  event: KeyboardEvent,
  caret: Element | null,
  open: (x: number, y: number) => void
): boolean {
  if (!isContextMenuKey(event)) return false
  if (event.type === 'keydown') {
    event.preventDefault()
    markKeyboardMenuOpen()
    const anchor = caret ? menuAnchorBelow(caret) : { x: 0, y: 0 }
    open(anchor.x, anchor.y)
  }
  return true
}

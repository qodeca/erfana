// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a tree row's context menu opens, and whether a native `contextmenu`
 * event came from the keyboard.
 *
 * The Menu key is not handled the same way on every platform. On macOS and
 * Linux Chromium, a Menu-key keydown the tree has handled produces no native
 * `contextmenu` event. On Windows Chromium turns the key (VK_APPS) into a
 * native `contextmenu` at the focused element's centre as well. So the tree
 * handles the key on keydown everywhere (one code path, menu under the row),
 * and the native event that may follow is recognised here as keyboard-made:
 * it is dropped when it repeats the keydown's menu, and anchored under the row
 * when it arrives on its own. A real right-click keeps the pointer position.
 */

/** A pointer press on the tree, used to tell a right-click from a key. */
export interface PointerPress {
  x: number
  y: number
  /** `performance.now()` at the press */
  at: number
}

/** A `contextmenu` this long after a press can still belong to it. */
export const POINTER_MENU_WINDOW_MS = 1500
/** A right-click's `contextmenu` lands where the press was, give or take this. */
export const POINTER_MENU_SLOP_PX = 12
/** A native `contextmenu` this soon after a keyboard-opened menu repeats it. */
export const KEYBOARD_MENU_ECHO_MS = 1500

/** The subset of a `contextmenu` event this reads. */
export interface ContextMenuPoint {
  clientX: number
  clientY: number
  /** Chromium's `contextmenu` is a PointerEvent; a key-made one has `''` */
  pointerType?: string
}

/**
 * Whether a native `contextmenu` was made by the keyboard (Menu key,
 * Shift+F10 at the OS level) rather than by a pointer.
 *
 * A pointer menu is always preceded by a press at (nearly) the same point:
 * the right button, a two-finger tap, or Ctrl+click on macOS. A key-made one
 * either has no press before it, or sits at the focused row's centre, away
 * from where the last press was. Chromium may also mark it with an empty
 * `pointerType`.
 *
 * @param event - The `contextmenu` event
 * @param lastPress - The last pointer press on the tree, or null
 * @param now - `performance.now()` when the event arrived
 * @returns True when the menu should be treated as keyboard-opened
 */
export function isKeyboardContextMenu(event: ContextMenuPoint, lastPress: PointerPress | null, now: number): boolean {
  if (event.pointerType === '') return true
  if (lastPress === null || now - lastPress.at > POINTER_MENU_WINDOW_MS) return true
  return (
    Math.abs(event.clientX - lastPress.x) > POINTER_MENU_SLOP_PX ||
    Math.abs(event.clientY - lastPress.y) > POINTER_MENU_SLOP_PX
  )
}

/**
 * The point a keyboard-opened menu is anchored to: under the row's left edge.
 *
 * @param row - The row's treeitem element
 * @returns The anchor in viewport coordinates
 */
export function rowMenuAnchor(row: Element): { x: number; y: number } {
  const rect = row.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom }
}

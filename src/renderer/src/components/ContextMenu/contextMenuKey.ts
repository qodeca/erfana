// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard route INTO a context menu (issue #90): Shift+F10 and the Menu
 * key, the standard way to open a context menu without a pointer on every
 * desktop platform (design/system/components/menu, decided).
 *
 * The project tree solved this first (#321, `ProjectTree/contextMenuOrigin.ts`);
 * this module is the same contract for every other surface that opens a menu
 * (tabs, the editor, the terminal, text fields), so each needs only a key test,
 * an anchor and the echo guard below.
 *
 * Why an echo guard: a surface handles the key on `keydown` on every platform,
 * so there is one code path and the menu opens at a predictable anchor. Windows
 * Chromium then ALSO turns the Menu key (VK_APPS) into a native `contextmenu`
 * at the focused element's centre, which the surface's own right-click handler
 * would take as a second open and move the menu. macOS and Linux send nothing
 * after a handled keydown. So a `contextmenu` that arrives shortly after a
 * keyboard open, with no pointer press since, is that echo and is dropped.
 */
import { KEYBOARD_MENU_ECHO_MS } from '../ProjectTree/contextMenuOrigin'

/** The subset of a keyboard event {@link isContextMenuKey} reads. */
export interface MenuKeyEvent {
  key: string
  shiftKey: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/**
 * Whether a key press asks for a context menu.
 *
 * Only a bare Shift+F10 counts: Ctrl+Shift+F10 or Cmd+Shift+F10 are left to
 * whatever else binds them.
 *
 * @param event - A `keydown` (DOM or React)
 * @returns True for Shift+F10 or the Menu (`ContextMenu`) key
 *
 * @example
 * ```ts
 * if (isContextMenuKey(event)) openMenuAt(menuAnchorBelow(event.currentTarget))
 * ```
 */
export function isContextMenuKey(event: MenuKeyEvent): boolean {
  if (event.key === 'ContextMenu') return true
  return (
    event.key === 'F10' &&
    event.shiftKey &&
    event.ctrlKey !== true &&
    event.altKey !== true &&
    event.metaKey !== true
  )
}

/**
 * The point a keyboard-opened menu is anchored to: under the element's left
 * edge, the same place the tree opens a row's menu.
 *
 * @param element - The focused trigger (a tab, a text field, the caret's box)
 * @returns Viewport coordinates for `ContextMenu`'s `x` / `y`
 */
export function menuAnchorBelow(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom }
}

/** The subset of a (DOM or React) keyboard event {@link openMenuFromKey} uses. */
export interface MenuKeyTriggerEvent extends MenuKeyEvent {
  currentTarget: EventTarget | null
  preventDefault: () => void
  stopPropagation: () => void
}

/**
 * Open a field's menu when the key asks for one. For a text field's
 * `onKeyDownCapture`, so the field's own `onKeyDown` (Enter to submit) never
 * sees the chord.
 *
 * @param event - The keydown
 * @param open - Opens the menu at a viewport anchor (under the field)
 * @returns True when the key was consumed
 *
 * @example
 * ```tsx
 * <textarea
 *   aria-haspopup="menu"
 *   onKeyDownCapture={(e) => openMenuFromKey(e, (at) => setContextMenu(at))}
 *   onContextMenu={handleContextMenu}
 * />
 * ```
 */
export function openMenuFromKey(
  event: MenuKeyTriggerEvent,
  open: (anchor: { x: number; y: number }) => void
): boolean {
  if (!isContextMenuKey(event) || !(event.currentTarget instanceof Element)) return false
  event.preventDefault()
  event.stopPropagation()
  markKeyboardMenuOpen()
  open(menuAnchorBelow(event.currentTarget))
  return true
}

// Module state, not per-surface: only one menu can be open at a time, and the
// echo is a property of the window's input stream, not of one component.
let keyboardOpenAt = Number.NEGATIVE_INFINITY
let pointerPressAt = Number.NEGATIVE_INFINITY
let listening = false

/**
 * Record that a menu was just opened from the keyboard.
 *
 * Also starts (once per window) the capture-phase `pointerdown` listener the
 * guard needs, so a right-click after a keyboard open is never mistaken for
 * the echo.
 *
 * @param now - `performance.now()`; injectable for tests
 */
export function markKeyboardMenuOpen(now: number = performance.now()): void {
  if (!listening && typeof document !== 'undefined') {
    document.addEventListener(
      'pointerdown',
      () => {
        pointerPressAt = performance.now()
      },
      { capture: true }
    )
    listening = true
  }
  keyboardOpenAt = now
}

/**
 * Whether a native `contextmenu` repeats a menu the keyboard just opened.
 *
 * @param now - `performance.now()`; injectable for tests
 * @returns True when the event should be dropped (Windows Menu-key echo)
 */
export function isKeyboardMenuEcho(now: number = performance.now()): boolean {
  return now - keyboardOpenAt < KEYBOARD_MENU_ECHO_MS && pointerPressAt < keyboardOpenAt
}

/**
 * Forget any recorded keyboard open. Test isolation only.
 */
export function resetKeyboardMenuEcho(): void {
  keyboardOpenAt = Number.NEGATIVE_INFINITY
  pointerPressAt = Number.NEGATIVE_INFINITY
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure logic functions for terminal clipboard operations.
 * Extracted for testability without React/xterm dependencies.
 */

import { isMacOS, isWindows } from './platform'
import type { ShortcutModifiers } from './shortcutLabel'

export interface KeyEventInfo {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  /** Alt (Option on macOS). AltGr on Windows arrives as Ctrl+Alt, so a chord with it is never a clipboard shortcut. */
  altKey?: boolean
}

export type ClipboardAction = 'copy' | 'paste' | 'none'

/**
 * Determines clipboard action from keyboard event.
 *
 * Decision table (#463, owner decisions of 2026-11-04):
 *
 * | Keys | macOS | Windows | Linux |
 * |---|---|---|---|
 * | Ctrl+Shift+C | copy | copy | copy |
 * | Ctrl+Shift+V | paste | paste | paste |
 * | Cmd+C | copy with a selection | – | – |
 * | Cmd+V | none: the native paste event pastes | – | – |
 * | Ctrl+C | none (^C) | copy with a selection, else none (interrupt) | same as Windows |
 * | Ctrl+V | none (^V) | paste | none (^V, as in other Linux terminals) |
 * | Shift+Insert | none | paste | paste |
 *
 * Every chord that also holds Alt is `none`. Cmd+V stays with xterm on macOS
 * because it produces no key there and the native paste event pastes once;
 * Ctrl+V on Windows produces `^V` in xterm and no paste event, so it must be
 * handled here.
 *
 * @param event Key event information
 * @param hasSelection Whether terminal has text selected
 * @param platform Optional platform override; defaults to the renderer platform
 *   resolved via the preload bridge. Passing it explicitly keeps this function
 *   pure (no `window.api`/`navigator` access) for unit tests.
 * @returns 'copy', 'paste', or 'none'
 */
export function getClipboardAction(
  event: KeyEventInfo,
  hasSelection: boolean,
  platform?: NodeJS.Platform
): ClipboardAction {
  const isMac = isMacOS(platform)
  const isWin = isWindows(platform)
  const { key, ctrlKey, metaKey, shiftKey, altKey = false } = event
  const keyLower = key.toLowerCase()

  if (altKey) return 'none'

  // Explicit shortcuts: Ctrl+Shift+C/V work on all platforms
  if (ctrlKey && shiftKey) {
    if (keyLower === 'c') return 'copy'
    if (keyLower === 'v') return 'paste'
  }

  // macOS: Cmd+C (copy only, let native handle Cmd+V paste)
  if (isMac && metaKey && !ctrlKey && !shiftKey) {
    if (keyLower === 'c') return hasSelection ? 'copy' : 'none'
  }

  if (!isMac) {
    // Ctrl+C copies a selection and interrupts without one; Ctrl+V pastes on Windows
    if (ctrlKey && !shiftKey && !metaKey) {
      if (keyLower === 'c') return hasSelection ? 'copy' : 'none'
      if (keyLower === 'v' && isWin) return 'paste'
    }
    // Shift+Insert: the classic paste key on Windows and Linux
    if (shiftKey && !ctrlKey && !metaKey && key === 'Insert') return 'paste'
  }

  return 'none'
}

/**
 * Determines if key event should pass through to terminal.
 * Returns true if event should NOT be intercepted (e.g., SIGINT).
 *
 * @param event Key event information
 * @param hasSelection Whether terminal has text selected
 * @param platform Optional platform override; threaded to {@link getClipboardAction}
 * @returns true to pass through to terminal, false to intercept
 */
export function shouldPassThrough(
  event: KeyEventInfo,
  hasSelection: boolean,
  platform?: NodeJS.Platform
): boolean {
  return getClipboardAction(event, hasSelection, platform) === 'none'
}

/**
 * The paste shortcut the terminal menu shows: the one that really pastes on
 * this platform (#463). Ctrl+V on Windows, Ctrl+Shift+V on Linux (Ctrl+V sends
 * ^V there), ⌘V on macOS.
 *
 * @param platform Optional platform override, for tests
 * @returns The key and modifiers for `formatShortcut`
 */
export function terminalPasteShortcut(platform?: NodeJS.Platform): { key: string; modifiers: ShortcutModifiers } {
  const linux = !isMacOS(platform) && !isWindows(platform)
  return { key: 'V', modifiers: linux ? { mod: true, shift: true } : { mod: true } }
}

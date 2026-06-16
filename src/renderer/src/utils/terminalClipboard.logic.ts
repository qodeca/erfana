// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure logic functions for terminal clipboard operations.
 * Extracted for testability without React/xterm dependencies.
 */

import { isMacOS } from './platform'

export interface KeyEventInfo {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export type ClipboardAction = 'copy' | 'paste' | 'none'

/**
 * Determines clipboard action from keyboard event.
 *
 * Logic:
 * - Ctrl+Shift+C/V: Explicit copy/paste (all platforms) - we handle these
 * - macOS Cmd+C: Copy (if selection) - we handle for toast + clear selection
 * - Windows/Linux Ctrl+C: Copy (if selection) - we handle for toast + clear selection
 * - Cmd+V / Ctrl+V: Returns 'none' - let xterm.js handle native paste
 *   (Intercepting these causes double-paste: our handler + native paste event)
 * - Ctrl+C without selection: Returns 'none' to allow SIGINT pass-through
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
  // Resolve the macOS-ness once so the decision table below stays
  // behaviorally identical regardless of how platform was supplied.
  const isMac = isMacOS(platform)
  const { key, ctrlKey, metaKey, shiftKey } = event
  const keyLower = key.toLowerCase()

  // Explicit shortcuts: Ctrl+Shift+C/V work on all platforms
  // We handle these because they won't trigger native paste event
  if (ctrlKey && shiftKey) {
    if (keyLower === 'c') return 'copy'
    if (keyLower === 'v') return 'paste'
  }

  // macOS: Cmd+C (copy only, let native handle Cmd+V paste)
  if (isMac && metaKey && !ctrlKey && !shiftKey) {
    if (keyLower === 'c') return hasSelection ? 'copy' : 'none'
    // Cmd+V: return 'none' to let xterm handle native paste
  }

  // Windows/Linux: Ctrl+C (copy only, let native handle Ctrl+V paste)
  if (!isMac && ctrlKey && !shiftKey && !metaKey) {
    if (keyLower === 'c') return hasSelection ? 'copy' : 'none'
    // Ctrl+V: return 'none' to let xterm handle native paste
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

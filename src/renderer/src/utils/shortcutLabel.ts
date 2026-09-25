// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Platform-aware keyboard shortcut labels for tooltips, aria-labels and menu
 * hints (#143).
 *
 * @module shortcutLabel
 *
 * Display only: this formats the text a user reads, it never binds a key.
 * macOS keeps the modifier glyphs in Apple's order (⌃⌥⇧⌘, e.g. "⌥⌘C");
 * Windows and Linux spell them out, Ctrl then Alt then Shift, joined with
 * "+" (e.g. "Ctrl+Alt+C").
 */

import { isMacOS } from './platform'

/** Modifiers a shortcut label shows. */
export interface ShortcutModifiers {
  /** The primary modifier: ⌘ on macOS, Ctrl elsewhere. */
  mod?: boolean
  /** ⌥ on macOS, Alt elsewhere. */
  alt?: boolean
  /** ⇧ on macOS, Shift elsewhere. */
  shift?: boolean
}

/**
 * Formats a keyboard shortcut for the current platform.
 *
 * @param key - The key as shown to the user, e.g. `'B'` or `'Enter'`
 * @param modifiers - Which modifiers the shortcut holds
 * @returns The label, e.g. `'⇧⌘F'` on macOS or `'Ctrl+Shift+F'` elsewhere
 *
 * @example
 * ```ts
 * `Project (${formatShortcut('B', { mod: true })})`
 * // macOS: 'Project (⌘B)'   Windows/Linux: 'Project (Ctrl+B)'
 * ```
 */
export function formatShortcut(key: string, modifiers: ShortcutModifiers = {}): string {
  const { mod = false, alt = false, shift = false } = modifiers
  if (isMacOS()) {
    return `${alt ? '⌥' : ''}${shift ? '⇧' : ''}${mod ? '⌘' : ''}${key}`
  }
  const parts: string[] = []
  if (mod) parts.push('Ctrl')
  if (alt) parts.push('Alt')
  if (shift) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

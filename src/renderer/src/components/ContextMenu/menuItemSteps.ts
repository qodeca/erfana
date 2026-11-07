// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Roving-focus steps for {@link ContextMenu}: separators are never a stop,
 * disabled items are (Menu card).
 *
 * @module components/ContextMenu/menuItemSteps
 */

/** All a step needs to know about an entry. */
interface MenuEntry {
  separator?: boolean
}

/**
 * The next non-separator item after `from`, stepping by `by` with wrap-around.
 *
 * @returns Its index, or -1 when the menu has no items at all
 */
export function stepFrom(items: readonly MenuEntry[], from: number, by: 1 | -1): number {
  const count = items.length
  for (let i = 1; i <= count; i += 1) {
    const at = (((from + by * i) % count) + count) % count
    if (!items[at].separator) return at
  }
  return -1
}

/** The first non-separator item, or -1 for an empty menu. */
export function firstItem(items: readonly MenuEntry[]): number {
  return items.findIndex((item) => !item.separator)
}

/** The last non-separator item, or -1 for an empty menu. */
export function lastItem(items: readonly MenuEntry[]): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (!items[i].separator) return i
  }
  return -1
}

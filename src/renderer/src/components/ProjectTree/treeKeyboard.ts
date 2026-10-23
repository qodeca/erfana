// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { VisibleTreeRow } from './visibleRows'

/**
 * What a key press on the focused tree row should do.
 *
 * Kept as data, apart from the component, so the whole keyboard contract
 * (WAI-ARIA APG tree view; decided by design/system/components/row/index.html)
 * is testable without rendering a tree.
 */
export type TreeKeyAction =
  | { type: 'focus'; index: number }
  | { type: 'expand'; path: string }
  | { type: 'collapse'; path: string }
  | { type: 'activate'; index: number }
  | { type: 'menu'; index: number }

/** The subset of a keyboard event the contract reads. */
export interface TreeKey {
  key: string
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

/**
 * Map a key press on row `index` to its action.
 *
 * - ↑ / ↓: previous / next row; Home / End: first / last row.
 * - →: a closed folder opens; an open folder moves to its first child.
 * - ←: an open folder closes; anything else moves to its parent.
 * - Enter: the row's default action (open a file, toggle a folder).
 * - Shift+F10 / the ContextMenu key: open the row's context menu.
 *
 * Keys with Ctrl, Alt or Cmd held are left alone: those belong to app
 * shortcuts (Cmd+C on the tree, Cmd+Alt+R refresh, …).
 *
 * @param rows - The visible rows in display order
 * @param index - Index of the focused row
 * @param event - The key press
 * @returns The action, or null when the key is not part of the contract
 */
export function resolveTreeKey(rows: readonly VisibleTreeRow[], index: number, event: TreeKey): TreeKeyAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null
  const row = rows[index]
  if (!row) return null
  const last = rows.length - 1
  const isFolder = row.node.type === 'directory'

  if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
    return { type: 'menu', index }
  }
  if (event.shiftKey) return null

  switch (event.key) {
    case 'ArrowDown':
      return { type: 'focus', index: Math.min(index + 1, last) }
    case 'ArrowUp':
      return { type: 'focus', index: Math.max(index - 1, 0) }
    case 'Home':
      return { type: 'focus', index: 0 }
    case 'End':
      return { type: 'focus', index: last }
    case 'ArrowRight':
      if (!isFolder) return null
      if (!row.isExpanded) return { type: 'expand', path: row.node.path }
      // Open folder: step to its first child, if it has one.
      return index < last && rows[index + 1].parentPath === row.node.path
        ? { type: 'focus', index: index + 1 }
        : null
    case 'ArrowLeft': {
      if (isFolder && row.isExpanded) return { type: 'collapse', path: row.node.path }
      if (row.parentPath === null) return null
      // The parent is the nearest row above with a smaller level.
      for (let i = index - 1; i >= 0; i--) {
        if (rows[i].level < row.level) return { type: 'focus', index: i }
      }
      return null
    }
    case 'Enter':
      return { type: 'activate', index }
    default:
      return null
  }
}

/**
 * Type-ahead: the next row whose name starts with `query`, wrapping around.
 *
 * A single character searches from the row AFTER the focused one, so pressing
 * the same letter again cycles through the matches. A longer query searches
 * from the focused row itself, so typing more of the name keeps focus where it
 * is while it still matches.
 *
 * @param rows - The visible rows in display order
 * @param index - Index of the focused row
 * @param query - The characters typed so far (case-insensitive)
 * @returns The matching row's index, or null when nothing matches
 */
export function findTypeAheadMatch(rows: readonly VisibleTreeRow[], index: number, query: string): number | null {
  if (query === '' || rows.length === 0) return null
  const needle = query.toLowerCase()
  const start = needle.length === 1 ? index + 1 : index
  for (let step = 0; step < rows.length; step++) {
    const i = (start + step) % rows.length
    if (rows[i].node.name.toLowerCase().startsWith(needle)) return i
  }
  return null
}

/**
 * Whether a key press is a printable character that should feed type-ahead.
 *
 * @param event - The key press
 * @returns True for a single printable character with no command modifier
 */
export function isTypeAheadKey(event: TreeKey): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey
}

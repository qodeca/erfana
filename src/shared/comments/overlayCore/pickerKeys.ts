// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard picker's one key rule and tree walk (spec 024 024-NFR-006,
 * 024-AC-029; differences table A-15; plan step 6, K-4, K-12, K-25).
 *
 * Shared overlay core – pure, no imports, no globals, no DOM (see
 * `pinLayout.ts` and docs/adrs/0006-overlay-core-in-the-sealed-preload.md). A
 * host hands in its own tree: the HTML page's elements, or a renderer preview's
 * targets.
 *
 * - **The keys:** Tab, Shift+Tab, Alt+Up, Alt+Down, Enter, Shift+F10 or the
 *   Menu key, Esc. A key held with Ctrl or Cmd is never the picker's (copy,
 *   Find, the mode shortcut), and neither is one the list does not name: those
 *   stay the page's. Alt+Up and Alt+Down match on the physical key, so Option
 *   on macOS and any layout work.
 * - **Tab and Shift+Tab** move among siblings, at the same level, and stop at
 *   either end with a sentence: they never climb. **Alt+Up and Alt+Down**
 *   change level, and Alt+Down goes back the way Alt+Up came, else to the first
 *   child.
 */

/** What a picker key does. */
export type PickerStep = 'next' | 'previous' | 'parent' | 'child' | 'open' | 'menu' | 'exit'

/** A step that moves the picker. */
export type PickerMoveStep = 'next' | 'previous' | 'parent' | 'child'

/** The fields of a keydown the rule reads. */
export interface PickerKeyEvent {
  readonly key: string
  readonly code: string
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

/** The picker step a key is, or `null` for a key the picker leaves alone. */
export function pickerStepOf(event: PickerKeyEvent): PickerStep | null {
  if (event.ctrlKey || event.metaKey) return null
  if (event.altKey) {
    if (event.shiftKey) return null
    const physical = event.code === '' ? event.key : event.code
    if (physical === 'ArrowUp') return 'parent'
    return physical === 'ArrowDown' ? 'child' : null
  }
  if (event.key === 'Tab') return event.shiftKey ? 'previous' : 'next'
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) return 'menu'
  if (event.shiftKey) return null
  if (event.key === 'Enter') return 'open'
  return event.key === 'Escape' ? 'exit' : null
}

/** What the walk asks of a host's tree. */
export interface PickerTree<T> {
  /** The node above `node`, or `null` at the top (and for a node no longer in the tree). */
  parent(node: T): T | null
  /** The first node one level inside `node`, or `null`. */
  firstChild(node: T): T | null
  /** The next (or previous) node at `node`'s level, or `null` at that end. */
  sibling(node: T, forward: boolean): T | null
}

/** The sentence said where a move has nowhere to go. */
export type PickerEnd = 'top' | 'no-child' | 'last' | 'first'

/** Where a move step lands: a node with the way back down, or an end of the tree. */
export type PickerMove<T> = { readonly target: T; readonly path: readonly T[] } | { readonly end: PickerEnd }

/**
 * The one move `step` makes from `current`.
 *
 * @param tree - The host's {@link PickerTree}.
 * @param current - The node the picker is on.
 * @param path - The way back down: what Alt+Up left, deepest last.
 * @param step - The move.
 * @returns Where it lands, or which end was reached.
 */
export function movePicker<T>(tree: PickerTree<T>, current: T, path: readonly T[], step: PickerMoveStep): PickerMove<T> {
  if (step === 'parent') {
    const parent = tree.parent(current)
    return parent === null ? { end: 'top' } : { target: parent, path: [...path, current] }
  }
  if (step === 'child') {
    for (const back of path.slice(-1)) {
      if (tree.parent(back) === current) return { target: back, path: path.slice(0, -1) }
    }
    const child = tree.firstChild(current)
    return child === null ? { end: 'no-child' } : { target: child, path: [] }
  }
  const sibling = tree.sibling(current, step === 'next')
  if (sibling === null) return { end: step === 'next' ? 'last' : 'first' }
  return { target: sibling, path }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "Show in preview", and the mode tab's one rule, for both comment overlays
 * (plan step 10; I-6, K-22, P-F07, I-19): one reveal step – open the folded
 * part, scroll, flash – and one distance at which the tab moves away.
 *
 * Pure, like everything here: a host hands in its own tree of folds.
 */

/** How long the static highlight stays on a revealed target (no motion, so reduced motion needs nothing). */
export const REVEAL_FLASH_MS = 1_500

/** The mode tab moves to the bottom edge while the pointer is this near the top (§10.1). */
export const MODE_TAB_AVOID_PX = 48

/** A host's nodes, as far as folds go. */
export interface FoldTree<T> {
  /** The node holding `node`, or `null` at the top. */
  parentOf(node: T): T | null
  /** `node` is a section that is closed now. */
  isClosed(node: T): boolean
  /** `child` of closed section `fold` still shows: it is the section's summary. */
  showsWhileClosed(fold: T, child: T): boolean
}

/**
 * The closed sections that hide `target`, outermost first: the order to open them in.
 *
 * @param target - The node to show.
 * @param tree - {@link FoldTree}
 * @returns The sections to open; none when nothing folds `target` away.
 */
export function foldsHiding<T>(target: T, tree: FoldTree<T>): T[] {
  const folds: T[] = []
  let child = target
  for (let up = tree.parentOf(target); up !== null; child = up, up = tree.parentOf(up)) {
    if (tree.isClosed(up) && !tree.showsWhileClosed(up, child)) folds.push(up)
  }
  return folds.reverse()
}

/**
 * Whether the mode tab moves away from the top edge.
 *
 * @param pointerTop - The pointer's distance from the preview's top, or `null` with no pointer over it.
 * @returns The tab belongs at the bottom edge.
 */
export function modeTabMovesAway(pointerTop: number | null): boolean {
  return pointerTop !== null && pointerTop < MODE_TAB_AVOID_PX
}

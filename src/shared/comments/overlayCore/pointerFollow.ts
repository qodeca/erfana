// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether a pointer move hands the picker to what is under it (plan step 4,
 * I-3): the outline shows what a click would hit.
 *
 * Shared overlay core – pure, no imports, no globals, no DOM (see
 * `pinLayout.ts` and docs/adrs/0006-overlay-core-in-the-sealed-preload.md).
 * `contains` is the one thing asked of a target.
 *
 * - The pointer on the current target changes nothing.
 * - A level the keys chose (Alt+Up) holds while the pointer stays inside it:
 *   its hand resting on a child must not undo the step.
 * - Anywhere else, the pointer leads.
 *
 * A host keeps a pick that a menu or window is open on: that is its own rule.
 */

/** What the rule asks of a target. */
export interface PointerTarget<T> {
  contains(other: T | null): boolean
}

/**
 * @param current - What the picker is on now, or `null`.
 * @param under - What is under the pointer, or `null`.
 * @param keyHeld - The keys put the picker on `current`.
 * @returns Whether the picker moves to `under`.
 */
export function pointerTakesOver<T extends PointerTarget<T>>(current: T | null, under: T | null, keyHeld: boolean): boolean {
  if (under === current) return false
  return !(keyHeld && under !== null && current?.contains(under) === true)
}

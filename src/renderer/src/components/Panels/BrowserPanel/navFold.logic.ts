// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The navigation row's fold steps 3–7 (spec 025; design § States › Tiers):
 * which steps give the address field its room, and what More then holds.
 *
 * Room is given back in one order, each step only once the previous one is
 * exhausted. Steps 1 and 2 (the path, then subdomain labels) are the origin
 * formatter's; steps 3–7 are the toolbar's, taken only when the scheme, the
 * whole registrable domain and the port still do not fit:
 *
 * 3. The zoom chip, Open in system browser and DevTools go into More.
 * 4. Forward and Reload go into More; their keys keep working.
 * 5. The address bar's margins shrink to `--space-2`.
 * 6. The badge word collapses to its icon.
 * 7. Back goes into More, last.
 *
 * Step 8 (cutting the domain from its start) is again the formatter's, once
 * every step here is taken. More never folds (OD-22).
 */
import type { ContextMenuItem } from '../../ContextMenu/ContextMenu'

/** The toolbar's fold steps, in the order they are taken. */
export const NAV_FOLD_STEPS = [3, 4, 5, 6, 7] as const

/** One of {@link NAV_FOLD_STEPS}. */
export type NavFoldStep = (typeof NAV_FOLD_STEPS)[number]

/**
 * Extra room an unfold must leave, in px, so a width that sits on a step's
 * edge (sub-pixel layout) does not fold and unfold on alternate frames.
 */
export const UNFOLD_SLACK_PX = 1

/** What {@link navFoldCount} decides from. */
export interface NavFoldInput {
  /** The field's room with no step taken, in px. */
  readonly room: number
  /** The width the origin needs with steps 1 and 2 exhausted, in px; 0 when no web origin shows. */
  readonly needed: number
  /** The room each step gives back, in px, by step. */
  readonly freed: Readonly<Record<NavFoldStep, number>>
  /** How many steps are taken now (for the unfold slack). */
  readonly current: number
}

/** The fewest steps, in order, after which `needed` fits; all of them when it never does. */
function stepsFor(room: number, needed: number, freed: Readonly<Record<NavFoldStep, number>>): number {
  let available = room
  for (let count = 0; count < NAV_FOLD_STEPS.length; count++) {
    if (available >= needed) return count
    available += freed[NAV_FOLD_STEPS[count]]
  }
  return NAV_FOLD_STEPS.length
}

/**
 * How many of {@link NAV_FOLD_STEPS} to take.
 *
 * @param input - {@link NavFoldInput}
 * @returns 0 (every tool on the row) to 5 (Back in More too)
 *
 * @example
 * ```ts
 * navFoldCount({ room: 60, needed: 100, freed: { 3: 30, 4: 30, 5: 8, 6: 40, 7: 30 }, current: 0 }) // 2
 * ```
 */
export function navFoldCount(input: NavFoldInput): number {
  const { room, needed, freed, current } = input
  if (!Number.isFinite(room) || needed <= 0) return 0
  const count = stepsFor(room, needed, freed)
  // Giving steps back needs a pixel to spare, so the row settles.
  return count < current ? Math.min(current, stepsFor(room, needed + UNFOLD_SLACK_PX, freed)) : count
}

/** The steps taken for `count`, as the row's `data-fold` list (`"3 4 5"`), or undefined for none. */
export function navFoldAttribute(count: number): string | undefined {
  return count <= 0 ? undefined : NAV_FOLD_STEPS.slice(0, count).join(' ')
}

/** Whether `step` is taken when `count` steps are. */
export function isFolded(step: NavFoldStep, count: number): boolean {
  return NAV_FOLD_STEPS.indexOf(step) < count
}

/** The step a `data-fold-step` attribute names, or null for none or another value. */
export function parseFoldStep(value: string | null | undefined): NavFoldStep | null {
  return NAV_FOLD_STEPS.find(step => String(step) === value) ?? null
}

/** The tab facts and actions the folded navigation items need. */
export interface FoldedNavInput {
  readonly count: number
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly loading: boolean
  /** The keys as shown on this platform. */
  readonly keys: { readonly back: string; readonly forward: string; readonly reload: string }
  readonly onBack: () => void
  readonly onForward: () => void
  readonly onReload: () => void
  readonly onStop: () => void
}

/**
 * The navigation tools More holds once they left the row (steps 4 and 7),
 * in the row's order: Back, Forward, then Reload (or Stop while loading).
 * Zoom, Open in system browser and DevTools (step 3) are in More at every
 * width already.
 *
 * @param input - {@link FoldedNavInput}
 * @returns The items, empty while every one is on the row
 */
export function foldedNavItems(input: FoldedNavInput): ContextMenuItem[] {
  const { count, keys } = input
  const items: ContextMenuItem[] = []
  if (isFolded(7, count)) {
    items.push({
      label: 'Back',
      shortcut: keys.back,
      action: input.onBack,
      ...(input.canGoBack ? {} : { disabled: true, reason: 'No earlier page' })
    })
  }
  if (isFolded(4, count)) {
    items.push({
      label: 'Forward',
      shortcut: keys.forward,
      action: input.onForward,
      ...(input.canGoForward ? {} : { disabled: true, reason: 'No later page' })
    })
    items.push(
      input.loading
        ? { label: 'Stop loading', action: input.onStop }
        : { label: 'Reload', shortcut: keys.reload, action: input.onReload }
    )
  }
  return items
}

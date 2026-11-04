// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which panel-toolbar buttons fit, and which move into the "…" menu (#451).
 *
 * Pure arithmetic over measured widths, so the row never has to render a wrong
 * layout to find the right one. The order of what gives way is the Toolbar
 * overflow card's (docs/design-system/system/patterns/toolbar-overflow,
 * decided): the title truncates down to its reserve first (CSS does that), then
 * buttons move one at a time, then the title goes, then the panel icon. The …
 * button never goes.
 *
 * @module components/ToolbarOverflow/toolbarOverflow.logic
 */

/** One button, as the computation sees it. */
export interface OverflowItem {
  id: string
  /** Its rendered width in px (measured; the last known width once it has moved) */
  width: number
  /** Raised: moves only after every other button has (Maximize terminal, New file) */
  moveLast?: boolean
}

/** Everything the row measures. All widths in px. */
export interface OverflowInput {
  /** The row's content box: its width minus its inline padding */
  available: number
  /** The gap between the row's parts: icon, title and the button group */
  rowGap: number
  /** The gap between two buttons, and between the last button and … */
  itemGap: number
  /** The panel icon's width; 0 when the row has none */
  iconWidth: number
  /** The width the title keeps until every button has moved; 0 when the row has no title */
  titleReserve: number
  hasIcon: boolean
  hasTitle: boolean
  /** The … button's width */
  moreWidth: number
  /** The buttons in toolbar order, left to right */
  items: readonly OverflowItem[]
}

/** What the row shows. */
export interface OverflowLayout {
  /** Ids of the buttons in the menu, in toolbar order (empty: no … button) */
  moved: string[]
  showTitle: boolean
  showIcon: boolean
}

/** Sub-pixel tolerance: measured widths are fractional, and a 0.3 px miss is not a clip. */
const FIT_TOLERANCE_PX = 0.5

/**
 * The order buttons leave in: rightmost first, raised buttons after all the
 * others (again rightmost first among themselves).
 *
 * @param items - Buttons in toolbar order
 * @returns Their ids, first to move first
 */
export function moveOrder(items: readonly OverflowItem[]): string[] {
  const reversed = [...items].reverse()
  return [...reversed.filter((item) => !item.moveLast), ...reversed.filter((item) => item.moveLast)].map(
    (item) => item.id
  )
}

/** The width of `count` items laid side by side with `gap` between them. */
function runWidth(widths: readonly number[], gap: number): number {
  if (widths.length === 0) return 0
  return widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1)
}

/**
 * Compute the row's layout.
 *
 * A candidate that moves exactly the buttons a narrower one would keep is never
 * chosen when it only trades a button for … of the same width (card rule 5): a
 * set of moved buttons is worth a menu only if, side by side, they are wider
 * than the … button. So a one-button toolbar never shows ….
 *
 * @param input - The row's measurements
 * @returns The buttons to move and whether the title and the icon stay
 */
export function computeOverflow(input: OverflowInput): OverflowLayout {
  const { items, itemGap, moreWidth } = input
  const widthById = new Map(items.map((item) => [item.id, item.width]))
  const order = moveOrder(items)

  /** The button group's width with the first `k` of `order` moved. */
  const groupWidth = (k: number): number => {
    const movedIds = new Set(order.slice(0, k))
    const kept = items.filter((item) => !movedIds.has(item.id)).map((item) => item.width)
    if (k === 0) return runWidth(kept, itemGap)
    return runWidth([...kept, moreWidth], itemGap)
  }

  /** Moving the first `k` is worth a menu: they are wider than … together. */
  const worthAMenu = (k: number): boolean =>
    k === 0 || runWidth(order.slice(0, k).map((id) => widthById.get(id) ?? 0), itemGap) > moreWidth

  /** The width left for the button group once the icon and title take theirs. */
  const budget = (showIcon: boolean, showTitle: boolean): number => {
    let lead = 0
    if (input.hasIcon && showIcon) lead += input.iconWidth + input.rowGap
    if (input.hasTitle && showTitle) lead += input.titleReserve + input.rowGap
    return input.available - lead
  }

  const layout = (k: number, showIcon: boolean, showTitle: boolean): OverflowLayout => {
    const movedIds = new Set(order.slice(0, k))
    return {
      moved: items.filter((item) => movedIds.has(item.id)).map((item) => item.id),
      showTitle,
      showIcon
    }
  }

  // Stage 1: icon and title (at its reserve) stay; move as few buttons as fit.
  const withAll = budget(true, true)
  for (let k = 0; k <= items.length; k += 1) {
    if (worthAMenu(k) && groupWidth(k) <= withAll + FIT_TOLERANCE_PX) return layout(k, true, true)
  }

  // Every button that can move has moved: the floor is … alone, or the single
  // button that is not worth a menu.
  const floor = worthAMenu(items.length) ? items.length : 0
  if (groupWidth(floor) <= budget(true, false) + FIT_TOLERANCE_PX) return layout(floor, true, false)
  return layout(floor, false, false)
}

/**
 * Whether two layouts show the same thing, so a re-measure that changes
 * nothing does not re-render the row.
 */
export function sameLayout(a: OverflowLayout, b: OverflowLayout): boolean {
  return (
    a.showIcon === b.showIcon &&
    a.showTitle === b.showTitle &&
    a.moved.length === b.moved.length &&
    a.moved.every((id, index) => id === b.moved[index])
  )
}

/** The layout before anything is measured: everything in the row. */
export const FULL_LAYOUT: OverflowLayout = { moved: [], showTitle: true, showIcon: true }

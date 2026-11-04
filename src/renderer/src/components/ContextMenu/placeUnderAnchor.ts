// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Placement of a {@link ContextMenu} opened from a menu button (#451, the
 * toolbar's "More actions"): under the button, its inline-end edge on the
 * button's (Toolbar overflow card, rule 8).
 *
 * @module components/ContextMenu/placeUnderAnchor
 */

/** Distance kept from the window's edges, in px. */
const EDGE_MARGIN_PX = 8
/** Gap between a menu button and the menu it opens, in px (--space-1). */
const ANCHOR_GAP_PX = 2

/**
 * Place a menu under its menu button, inline-end edge on the button's; flip it
 * to open toward the window's interior when that would leave the window, and
 * above the button when there is no room below. Then show it.
 *
 * @param menu - The menu element, already rendered (measured at its real size)
 * @param anchor - The menu button
 */
export function placeUnderAnchor(menu: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  const { width, height } = menu.getBoundingClientRect()
  let left = rect.right - width
  if (left < EDGE_MARGIN_PX) left = rect.left
  let top = rect.bottom + ANCHOR_GAP_PX
  if (top + height > window.innerHeight - EDGE_MARGIN_PX) top = rect.top - ANCHOR_GAP_PX - height
  left = Math.max(EDGE_MARGIN_PX, Math.min(left, window.innerWidth - width - EDGE_MARGIN_PX))
  top = Math.max(EDGE_MARGIN_PX, top)
  menu.style.left = `${left}px`
  menu.style.top = `${top}px`
  menu.style.opacity = '1'
}

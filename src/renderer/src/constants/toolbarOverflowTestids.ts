// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test ids of the panel toolbar overflow (#451).
 *
 * Kept out of `testids.ts`, which sits at its max-lines ratchet
 * (scripts/max-lines-baseline.json), the way `commentTestids.ts` is. Not spread
 * into `TEST_IDS`: import them from here. A moved button's menu item carries its
 * row button's test id plus `-overflow-item` (`overflowItemTestId()` in
 * `components/ToolbarOverflow/ToolbarOverflow.tsx`).
 *
 * @module constants/toolbarOverflowTestids
 */
export const TOOLBAR_OVERFLOW_TEST_IDS = {
  /** A panel toolbar's "More actions" (…) button; one per row that overflows */
  MORE: 'toolbar-overflow-more',
  /** The menu "More actions" opens */
  MENU: 'toolbar-overflow-menu',
  /** The project panel header's filter-options toggle */
  PROJECT_PANEL_BTN_FILTER: 'project-panel-btn-filter'
} as const

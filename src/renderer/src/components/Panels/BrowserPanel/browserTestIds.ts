// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test ids of the built-in browser's renderer UI (spec 025, commit 17). Kept
 * beside the components rather than in `constants/testids.ts`, which the
 * max-lines ratchet holds at its size. Controls are found by role and name;
 * these ids name only what has neither.
 */
export const BROWSER_TEST_IDS = {
  /** A browser panel's root; `data-browser-tab-id` carries main's tab id once known. */
  PANEL: 'browser-panel',
  /** The element the page's native view covers exactly. */
  PAGE_PLACEHOLDER: 'browser-page-placeholder',
  /** A browser editor tab's root in the tab strip. */
  EDITOR_TAB: 'browser-editor-tab',
  /** The refused-address message under the navigation row. */
  REFUSED: 'browser-refused-address'
} as const

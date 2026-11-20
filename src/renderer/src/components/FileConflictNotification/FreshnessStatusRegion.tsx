// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A panel's one live region for its file notice (#478, plan decision 51, F13).
 *
 * Always mounted, empty when there is nothing to say: a live region added to
 * the page at the moment its text appears is not announced. Polite, because a
 * file changing on disk is news, not an emergency, and the reader should
 * finish what it is saying. The panel passes an empty text while it is not
 * the active tab, so a background tab never speaks over the one in front.
 *
 * @module components/FileConflictNotification/FreshnessStatusRegion
 */
import { FRESHNESS_NOTICE_TEST_IDS } from './freshnessNoticeCopy'
import './FileConflictNotification.css'

export function FreshnessStatusRegion({ text }: { text: string }): JSX.Element {
  return (
    <span
      className="file-freshness-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={FRESHNESS_NOTICE_TEST_IDS.status}
    >
      {text}
    </span>
  )
}

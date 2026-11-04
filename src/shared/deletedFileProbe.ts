// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * How often a tab whose file was deleted on disk looks for it again, in ms
 * (issue #450).
 *
 * A genuine delete ends the file's watch, so nothing reports the file coming
 * back – a branch switch or a merge puts it back seconds later. While a tab
 * shows the deleted state it asks once per interval, one `stat` and no
 * overlapping asks, and stops when the file is back or the tab closes. Used by
 * the editor and image tabs (renderer, `useDeletedFileProbe`) and by the HTML
 * preview's page watch (main, `previewEntryWatch`), so every kind of tab
 * recovers on the same clock, well inside the issue's 10 s budget.
 */
export const DELETED_FILE_PROBE_INTERVAL_MS = 2_000

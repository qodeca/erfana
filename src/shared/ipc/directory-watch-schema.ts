// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Wire shape of the `directory-watch:changed` push (main → renderer).
 *
 * One type for the sender (`DirectoryWatcherService`), the preload bridge and
 * the renderer's `IProjectTreeApi`, so a field added on one side cannot be
 * missed on the other.
 */

/** Event kinds a batch is summarised by. */
export type DirectoryChangeKind = 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'

export interface DirectoryChangedPayload {
  dirPath: string
  /** Events surviving coalescing (0 for a catch-up refresh). */
  eventCount: number
  /** Raw events from the backend watcher, after the path filter. */
  originalEventCount: number
  /** Events removed by the coalescer. */
  coalescedCount: number
  summary: Partial<Record<DirectoryChangeKind, number>>
  /**
   * Whether the batch can have changed the project tree. `false` only for a
   * batch of content edits to files that were already there; always `true`
   * for a catch-up, resync or compensating refresh and after a buffer overflow.
   */
  structural: boolean
  /** #210: set only on a catch-up refresh, which passes the internal-operation gate. */
  catchUp?: boolean
}

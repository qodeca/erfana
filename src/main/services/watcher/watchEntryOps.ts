// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * watchEntryOps - taking a watch entry down (#478, plan S8).
 *
 * Extracted from `FileWatcherService` so the service keeps the decisions and
 * stays under the line ceiling. Every teardown takes the entry out of the map
 * **before** it awaits the watcher's `close()` (plan decision 19): a subscribe
 * arriving while an old watcher closes then builds a fresh watch instead of
 * joining one that is about to go (the closing-watch race).
 */
import type { AtomicSaveDetector } from './AtomicSaveDetector'
import type { UnseenWatchProbe } from './unseenWatchProbe'
import { closeQuietly } from './armWatch'
import type { WatchEntry } from './watchTypes'

/** The service state an entry teardown touches. */
export interface EntryOpsHost {
  readonly entries: Map<string, WatchEntry>
  readonly atomicSaveDetector: AtomicSaveDetector
  readonly unseenProbe: UnseenWatchProbe
}

/** Drop the entry's pending atomic-save check. */
export function cancelPendingWork(host: EntryOpsHost, entry: WatchEntry): void {
  host.atomicSaveDetector.cancelPending(entry.filePath)
}

/**
 * Take `entry` out of the map, when the map still holds it, with its pending
 * check; the unseen probe forgets the path. A newer entry under the same key
 * (reopened while this one's check awaited the disk) is left alone.
 *
 * @returns true when the entry was the one held
 */
export function forgetEntry(host: EntryOpsHost, entry: WatchEntry): boolean {
  if (host.entries.get(entry.key) !== entry) return false
  cancelPendingWork(host, entry)
  host.entries.delete(entry.key)
  host.unseenProbe.pathChanged(entry.filePath)
  return true
}

/** Forget the entry, then close its watcher; the close is awaited. */
export async function closeAndForget(host: EntryOpsHost, entry: WatchEntry): Promise<void> {
  forgetEntry(host, entry)
  const watcher = entry.watcher
  entry.watcher = null
  if (watcher) await closeQuietly(watcher)
}

/**
 * Fire-and-forget teardown, used from the async unlink branch where there is
 * nobody left to await the close.
 */
export function discardEntry(host: EntryOpsHost, entry: WatchEntry): void {
  void closeAndForget(host, entry)
}

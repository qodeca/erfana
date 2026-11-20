// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * atomicRearm - what to do when a watched single file is unlinked.
 *
 * An unlink is ambiguous: it is either a genuine delete or the first half of an
 * atomic save (write temp, rename over the target), which is how most agents
 * and design tools write. A chokidar single-file watch is bound to the inode it
 * opened, so after a rename the original watcher is permanently deaf and every
 * later edit is invisible until the tab is closed and reopened - the defect
 * behind issue #70 (D2).
 *
 * This module owns the branch that follows `AtomicSaveDetector`'s verdict. It
 * lives beside `FileWatcherService` rather than inside it so that service stays
 * under the project's 500-line ceiling; it talks to the service through the
 * narrow {@link AtomicRearmDeps} seam, which also makes the branch testable
 * without a chokidar instance. The re-arm itself is `armWatch`, the one place a
 * watcher is (re-)created, which re-checks project confinement (#478, plan
 * decision 12).
 */
import { isPresentAfterSettle } from './pathPresence'
import { closeQuietly } from './armWatch'
import type { ArmOutcome, WatchEntry } from './watchTypes'
import type { WatchEndReason } from '../../../shared/freshness/freshnessTypes'
import { WATCH_END_MESSAGES } from './watchEndMessages'

/**
 * The texts a watch owner gets when its watch died (`onWatchDead`).
 *
 * A dead watch that stays silent leaves the renderer showing stale content with
 * no indicator - the exact symptom issue #70 fixes - so every teardown that is
 * not a genuine delete surfaces (H-4b).
 */
export const WATCH_DEAD_SESSION_ENDED = WATCH_END_MESSAGES['project-switch']
export const WATCH_DEAD_REARM_FAILED = WATCH_END_MESSAGES['restart-failed']
export const WATCH_DEAD_OUTSIDE_PROJECT = WATCH_END_MESSAGES['outside-project']

/** The slice of `FileWatcherService` the re-arm branch needs. */
export interface AtomicRearmDeps {
  /** True once the service is tearing down; nothing may be sent after that. */
  isDisposing(): boolean
  /** The entry the service holds under `key` now, if any. */
  getWatch(key: string): WatchEntry | undefined
  /** `armWatch` on the entry: re-checks confinement and binds a new watcher. */
  rearm(entry: WatchEntry): Promise<ArmOutcome>
  /**
   * Cancel pending work for the watch, close it and drop the entry with its
   * subscriptions - only while the map still holds this entry; a newer watch on
   * the path stays.
   */
  discardWatch(entry: WatchEntry): void
  notifyDeleted(entry: WatchEntry): void
  notifyWatchDead(entry: WatchEntry, reason: WatchEndReason): void
  /** Re-enter the service's change path (never notify directly). */
  emitChange(entry: WatchEntry): void
  log(message: string): void
}

/**
 * Decide what an unlink actually was, once the atomic-save window has closed.
 *
 * @param wasAtomicSave - the detector's verdict: the file reappeared in time
 */
export async function resolveDeletedWatch(
  key: string,
  wasAtomicSave: boolean,
  deps: AtomicRearmDeps
): Promise<void> {
  if (deps.isDisposing()) return
  const watched = deps.getWatch(key)
  // A suspended watch has no watcher to replace; `resumeSuspended` arms it
  if (!watched || watched.suspended) return

  // One final existence check even when the detector said "gone": a slow
  // temp-then-rename can land between its check and this callback, and a false
  // "file deleted" banner over a file that exists is worse than a late refresh
  // (issue #70, H-4a). An unreadable file counts as there, except a Windows
  // EPERM or EBUSY that persists past a second look: that file is being
  // deleted (#252).
  const present = wasAtomicSave || (await isPresentAfterSettle(watched.filePath))

  // That check can wait (a second look on Windows), and the path may be watched
  // again by the time it answers. The newer watch gets neither this one's
  // verdict nor its teardown (#346 review).
  if (deps.isDisposing() || deps.getWatch(key) !== watched) return

  if (present) {
    await rearmWatch(watched, deps)
    return
  }

  deps.log('🗑️  File deleted externally')
  deps.notifyDeleted(watched)
  deps.discardWatch(watched)
}

/**
 * Replace a watch whose inode was destroyed by an atomic save. Re-arming is
 * required, not an optimisation; the entry is kept, so its subscriptions and
 * their pauses survive and the re-arm can never trip a bucket cap.
 */
async function rearmWatch(watched: WatchEntry, deps: AtomicRearmDeps): Promise<void> {
  const outcome = await deps.rearm(watched)
  if (outcome === 'stale') return
  if (deps.isDisposing() || deps.getWatch(watched.key) !== watched) {
    await closeOrphan(watched)
    return
  }

  if (outcome !== 'armed') {
    await endUnarmed(watched, outcome, deps)
    return
  }

  // TOCTOU: the path can vanish between the arm's check and chokidar.watch().
  // Without this the entry would hold a slot forever, watching nothing (#70, L-3).
  const stillThere = await isPresentAfterSettle(watched.filePath)
  // The watch may have been dropped, or the path watched again, while the stat
  // was in flight: the replacement watcher then belongs to nobody (#252 review)
  if (deps.isDisposing() || deps.getWatch(watched.key) !== watched) {
    await closeOrphan(watched)
    return
  }
  if (!stillThere) {
    deps.notifyDeleted(watched)
    deps.discardWatch(watched)
    return
  }

  deps.log('♻️  Re-armed watch after atomic save')
  // Re-enter the normal change path rather than notifying directly, so the
  // pause and the subscription checks still apply (issue #70, H-1)
  deps.emitChange(watched)
}

/** Close the watcher of an entry nobody holds any more. */
async function closeOrphan(watched: WatchEntry): Promise<void> {
  const watcher = watched.watcher
  watched.watcher = null
  if (watcher) await closeQuietly(watcher)
}

/**
 * End a watch whose re-arm was refused. A file that went away meanwhile (or,
 * on Windows, is being deleted) cannot be resolved either: that is a delete,
 * not an escape from the project (#252).
 */
async function endUnarmed(
  watched: WatchEntry,
  outcome: Exclude<ArmOutcome, 'armed' | 'stale'>,
  deps: AtomicRearmDeps
): Promise<void> {
  const gone = outcome === 'missing' || !(await isPresentAfterSettle(watched.filePath))
  if (deps.isDisposing() || deps.getWatch(watched.key) !== watched) return
  if (gone) {
    deps.notifyDeleted(watched)
  } else {
    deps.notifyWatchDead(watched, outcome === 'failed' ? 'restart-failed' : outcome)
  }
  deps.discardWatch(watched)
}

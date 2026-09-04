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
 * without a chokidar instance.
 */
import { FSWatcher } from 'chokidar'
import { stat } from 'fs/promises'
import { logger } from '../LoggingService'

/**
 * Reasons a watch died that the renderer must be told about.
 *
 * A dead watch that stays silent leaves the renderer showing stale content with
 * no indicator - the exact symptom issue #70 fixes - so every teardown that is
 * not a genuine delete surfaces as `file-watch:error` (H-4b).
 */
export const WATCH_DEAD_SESSION_ENDED = 'File watch ended because the project session changed'
export const WATCH_DEAD_REARM_FAILED =
  'File watch ended: could not re-arm after the file was replaced'
export const WATCH_DEAD_OUTSIDE_PROJECT =
  'File watch ended: the file no longer resolves inside the project'

/** The parts of a watched-file entry this branch reads or mutates. */
export interface RearmableWatch {
  filePath: string
  watcher: FSWatcher
  version: number
  debounceTimer: NodeJS.Timeout | null
}

/** The slice of `FileWatcherService` the re-arm branch needs. */
export interface AtomicRearmDeps {
  /** True once the service is tearing down; nothing may be sent after that. */
  isDisposing(): boolean
  /** The current session token, bumped on project switch / window teardown. */
  currentVersion(): number
  getWatch(filePath: string): RearmableWatch | undefined
  /**
   * Is the path still inside the open project with symlinks resolved? Asked
   * again at re-arm time because the file was just replaced by someone else.
   */
  isPathConfined(filePath: string): Promise<boolean>
  createWatcher(filePath: string): FSWatcher
  /**
   * Point the service's record at the replacement watcher.
   *
   * @returns false when the entry is gone, so the new watcher is orphaned
   */
  replaceWatcher(filePath: string, watcher: FSWatcher): boolean
  /** Cancel pending work for the watch, close it and drop the map entry. */
  discardWatch(filePath: string, watched: RearmableWatch): void
  notifyDeleted(filePath: string): void
  notifyWatchDead(filePath: string, reason: string): void
  /** Re-enter the service's debounced change path (never notify directly). */
  emitChange(filePath: string): void
  log(message: string): void
}

/**
 * Decide what an unlink actually was, once the atomic-save window has closed.
 *
 * @param wasAtomicSave - the detector's verdict: the file reappeared in time
 */
export async function resolveDeletedWatch(
  filePath: string,
  wasAtomicSave: boolean,
  deps: AtomicRearmDeps
): Promise<void> {
  if (deps.isDisposing()) return
  const watched = deps.getWatch(filePath)
  if (!watched) return

  // One final existence check even when the detector said "gone": a slow
  // temp-then-rename can land between its check and this callback, and a false
  // "file deleted" banner over a file that exists is worse than a late refresh
  // (issue #70, H-4a).
  if (wasAtomicSave || (await pathExists(filePath))) {
    await rearmWatch(watched, deps)
    return
  }

  if (deps.isDisposing() || deps.getWatch(filePath) !== watched) return

  deps.log(`🗑️  File deleted externally: ${filePath}`)
  deps.notifyDeleted(filePath)
  deps.discardWatch(filePath, watched)
}

/**
 * Replace a watch whose inode was destroyed by an atomic save.
 *
 * Re-arming is required, not an optimisation. The record is updated in place
 * through {@link AtomicRearmDeps.replaceWatcher} so subscribers, `isPaused` and
 * the map size survive; the re-arm therefore can never trip
 * `MAX_WATCHED_FILES`.
 */
async function rearmWatch(watched: RearmableWatch, deps: AtomicRearmDeps): Promise<void> {
  const { filePath } = watched
  if (deps.isDisposing()) return

  // The session moved on while the delete was pending. Silently dropping the
  // entry here would leave the renderer showing stale content forever, so the
  // dead watch is announced before the entry goes (issue #70, H-4b / L3).
  if (watched.version !== deps.currentVersion()) {
    deps.notifyWatchDead(filePath, WATCH_DEAD_SESSION_ENDED)
    deps.discardWatch(filePath, watched)
    return
  }

  // The path was replaced by whoever wrote the file, so where it points is an
  // open question again: an in-project name can now be a symlink out of the
  // project. `watchFile`'s entry check was lexical and ran before that write,
  // which is a TOCTOU window this re-check closes (issue #70, security).
  if (!(await deps.isPathConfined(filePath))) {
    deps.notifyWatchDead(filePath, WATCH_DEAD_OUTSIDE_PROJECT)
    deps.discardWatch(filePath, watched)
    return
  }
  if (deps.isDisposing() || deps.getWatch(filePath) !== watched) return

  // Awaited, not fire-and-forget: two chokidar watchers on one path would
  // otherwise overlap, and this app has a file-descriptor budget to respect
  // (chokidar is pinned to v3 for exactly that reason).
  await closeQuietly(watched.watcher)
  if (deps.isDisposing() || deps.getWatch(filePath) !== watched) return

  let watcher: FSWatcher
  try {
    watcher = deps.createWatcher(filePath)
  } catch (error) {
    logger.error(
      `Failed to re-arm file watch for ${filePath}`,
      error instanceof Error ? error : undefined
    )
    deps.notifyWatchDead(filePath, WATCH_DEAD_REARM_FAILED)
    deps.discardWatch(filePath, watched)
    return
  }
  if (!deps.replaceWatcher(filePath, watcher)) {
    await closeQuietly(watcher)
    return
  }

  // TOCTOU: the path can vanish between the detector's existence check and
  // chokidar.watch(). Without this the entry would hold a MAX_WATCHED_FILES
  // slot forever, watching nothing (issue #70, L-3).
  if (!(await pathExists(filePath))) {
    deps.notifyDeleted(filePath)
    deps.discardWatch(filePath, watched)
    return
  }

  // The watch may have been torn down while the stat was in flight; the new
  // watcher would then be orphaned.
  if (deps.isDisposing() || deps.getWatch(filePath) !== watched) {
    await closeQuietly(watcher)
    return
  }

  deps.log(`♻️  Re-armed watch after atomic save: ${filePath}`)

  // Re-enter the normal change path rather than notifying directly, so the emit
  // keeps the debounce, the `isPaused` check and the session guard. A direct
  // notify would tell the editor to reload a file that may still be half
  // written (issue #70, H-1).
  deps.emitChange(filePath)
}

/** Close a watcher, ignoring a failure there is nobody left to act on. */
async function closeQuietly(watcher: FSWatcher): Promise<void> {
  try {
    await watcher.close()
  } catch {
    // A watcher that refuses to close is already gone for our purposes
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

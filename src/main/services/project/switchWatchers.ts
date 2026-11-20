// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * switchWatchers - the watchers' part of a project open, switch or close
 * (#478, plan decision 18).
 *
 * Nothing is stopped until the new project's settings and path filter are
 * built, so an open that fails there leaves every watch running (G1). Then,
 * just before the commit, {@link SwitchWatchers.suspend} closes the file
 * watchers (keeping their records) and stops the directory watchers. A failure
 * after that runs {@link SwitchWatchers.resume}; a commit runs
 * {@link SwitchWatchers.end}, which ends every file watch of the old project.
 *
 * Every step is non-fatal: a watcher that cannot be stopped or restarted is
 * logged and the transition goes on; the session guards drop its late events.
 * The directory watchers are not restarted on a failure: only synchronous
 * steps follow the suspend, and the renderer starts them for the open project.
 */
import type { WatchEndReason } from '../../../shared/freshness/freshnessTypes'
import { redactQuotedPaths } from '../../../shared/redactQuotedPaths'
import type { IDirectoryWatcherService } from '../../interfaces/IDirectoryWatcherService'
import type { IFileWatcherService } from '../../interfaces/IFileWatcherService'
import { logger } from '../LoggingService'
import { withTimeout } from '../../utils/withTimeout'

/** Longest a watcher step may take before the transition goes on without it. */
const WATCHER_STEP_TIMEOUT_MS = 15_000

export interface SwitchWatchers {
  /** Just before the commit: file watches suspended, directory watches stopped. */
  suspend(): Promise<void>
  /** A step after {@link suspend} failed: the file watches follow again. */
  resume(): Promise<void>
  /** The commit made `generation` current: the old project's file watches end. */
  end(generation: number, reason: WatchEndReason): Promise<void>
}

export function createSwitchWatchers(
  files: IFileWatcherService,
  directories: IDirectoryWatcherService
): SwitchWatchers {
  return {
    suspend: async () => {
      await nonFatal('Suspending the file watchers', () => files.suspendAll())
      await nonFatal('Stopping the directory watchers', () => directories.stopAll())
    },
    resume: () => nonFatal('Resuming the file watchers', () => files.resumeSuspended()),
    end: (generation, reason) =>
      nonFatal('Ending the old file watches', () => files.endSuspended(generation, reason))
  }
}

async function nonFatal(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await withTimeout(run(), WATCHER_STEP_TIMEOUT_MS, what)
  } catch (e) {
    // Non-fatal: proceed with the transition, guards prevent stale events
    logger.warn(`${what} failed (continuing)`, {
      error: e instanceof Error ? redactQuotedPaths(e.message) : String(e)
    })
  }
}

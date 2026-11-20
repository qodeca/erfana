// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * watchOwnerLifecycle - what ends or wakes a window's file watches (#478,
 * plan decisions 17 and 22).
 *
 * - **Navigation** (`did-navigate`: a main-frame, cross-document commit, a
 *   reload included): the window's page generation goes up and every
 *   subscription, pause and waitlist entry of the old page is dropped. A
 *   reload keeps the `webContents`, so `destroyed` alone left the old page's
 *   pauses muting the file for the new one (G2).
 * - **Destroyed**: the same, for good (issue #59).
 * - **Power resume**: every watch is re-armed – a watcher can die silently in
 *   sleep – then one health round runs, then app windows get
 *   `file-watch:check` and in-process owners their check (G8, F26).
 */
import type { WebContents } from 'electron'
import { FILE_WATCH_CHANNELS } from '../../../shared/ipc/file-watch-channels'
import type { FileWatchCheck } from '../../../shared/ipc/file-watch-schema'
import type { PowerMonitorLike } from '../../utils/PowerMonitorLike'
import { redactedLogError } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import { broadcastToWindows } from '../watcher/watchNotifier'

/** The slice of `FileWatcherService` an owner's life touches. */
export interface WatchOwnerTarget {
  pageNavigated(webContentsId: number): Promise<void>
  cleanupForWebContentsId(webContentsId: number): Promise<void>
}

/** The slice of `FileWatcherService` a wake touches. */
export interface WatchWakeTarget {
  rearmAll(): Promise<void>
  runHealthRound(): Promise<void>
  checkInProcessOwners(): void
}

/** The `webContents` events this module listens to. */
export type WatchOwnerContents = Pick<WebContents, 'id'> & {
  on(event: 'did-navigate' | 'destroyed', listener: () => void): unknown
}

/** Drop a window's watches when its page navigates and when it is destroyed. */
export function wireWatchOwner(contents: WatchOwnerContents, watches: WatchOwnerTarget): void {
  // Read once: a destroyed webContents throws on property access
  const webContentsId = contents.id
  contents.on('did-navigate', () => {
    watches.pageNavigated(webContentsId).catch(error => {
      logger.error('Dropping file watches after a navigation failed', redactedLogError(error))
    })
  })
  contents.on('destroyed', () => {
    // Fire-and-forget with error logging: cleanup must not block the destroyed event
    watches.cleanupForWebContentsId(webContentsId).catch(error => {
      logger.error('Error cleaning up file watchers', redactedLogError(error))
    })
  })
}

/**
 * On every power `resume`: re-arm, one health round, then the checks.
 *
 * @param broadcast - sends the check to app windows; `file-watch:check` to
 *                    every window by default
 */
export function wirePowerResume(
  powerMonitor: PowerMonitorLike,
  watches: WatchWakeTarget,
  broadcast: (check: FileWatchCheck) => void = defaultBroadcast
): void {
  powerMonitor.on('resume', () => {
    void afterWake(watches, broadcast)
  })
}

/** The wake sequence; exported for tests, which await it. */
export async function afterWake(
  watches: WatchWakeTarget,
  broadcast: (check: FileWatchCheck) => void = defaultBroadcast
): Promise<void> {
  try {
    await watches.rearmAll()
    await watches.runHealthRound()
  } catch (error) {
    logger.error('Re-arming file watches after a wake failed', redactedLogError(error))
  }
  // The checks go out even when a re-arm failed: each tracker then reads the disk itself
  try {
    broadcast({ reason: 'resume' })
  } catch (error) {
    logger.error('Sending the file check after a wake failed', redactedLogError(error))
  }
  watches.checkInProcessOwners()
}

function defaultBroadcast(check: FileWatchCheck): void {
  broadcastToWindows(FILE_WATCH_CHANNELS.check, check, message => logger.warn(message))
}

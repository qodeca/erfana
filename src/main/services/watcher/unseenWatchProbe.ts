// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * unseenWatchProbe - notices a watched file that vanished where no watcher looks.
 *
 * A single-file watch hears nothing when a folder above the file is renamed,
 * moved or deleted: the file itself is never touched, so no event reaches it on
 * any platform. The project watcher reports such removals (`ancestorRemoval`),
 * but it never sees a folder its path filter drops – excluded, hidden or
 * ignored – nor a file outside the project, so such a tab was never marked
 * deleted (#252). Watching every ancestor folder instead would cost a handle
 * per folder, and on Windows an open folder handle can stop its parents being
 * renamed. So the watched files the project watcher cannot see are re-checked
 * on a slow timer: one `stat` at a time, never two rounds at once, and only
 * while some file is watched. A missing file takes the watch's normal unlink
 * path, whose atomic-save window and final existence check guard against a
 * false banner.
 */
import { stat } from 'fs/promises'
import { logger } from '../LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'

/** Time between two rounds of the probe. */
export const UNSEEN_PROBE_INTERVAL_MS = 2000

/** Errors that mean the path is gone, rather than unreadable for now. */
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR'])

/** The slice of `FileWatcherService` the probe needs. */
export interface UnseenWatchProbeDeps {
  /** Every watched path, read afresh at each round. */
  watchedPaths(): Iterable<string>
  /** True when the project watcher would report a removal of any folder above the file. */
  isCovered(filePath: string): boolean
  /** The file is gone: hand it to the watch's unlink path. */
  onMissing(filePath: string): void
  /** Existence test; the default treats only ENOENT and ENOTDIR as gone. */
  exists?(filePath: string): Promise<boolean>
}

/** True unless `stat` says the path is gone; an unreadable path counts as present. */
export async function pathIsPresent(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    return !(code && MISSING_CODES.has(code))
  }
}

/**
 * Check the paths one after another and report each one that is gone.
 *
 * Sequential on purpose: a `stat` on a network drive that stopped answering
 * holds a libuv thread, and a round of parallel ones could hold them all.
 *
 * @param isCancelled - checked before each `stat`, so a stopped probe ends early
 */
export async function reportMissingPaths(
  paths: readonly string[],
  onMissing: (filePath: string) => void,
  exists: (filePath: string) => Promise<boolean> = pathIsPresent,
  isCancelled: () => boolean = () => false
): Promise<void> {
  for (const filePath of paths) {
    if (isCancelled()) return
    if (!(await exists(filePath))) onMissing(filePath)
  }
}

export class UnseenWatchProbe {
  private timer: ReturnType<typeof setTimeout> | null = null
  private roundInFlight = false
  private stopped = false

  constructor(private readonly deps: UnseenWatchProbeDeps) {}

  /** Arm the next round, unless one is armed or running, or the probe is stopped. */
  schedule(): void {
    if (this.stopped || this.timer !== null || this.roundInFlight) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.runRound()
    }, UNSEEN_PROBE_INTERVAL_MS)
    // A background check must never keep the process alive on its own
    this.timer.unref?.()
  }

  /** Stop for good: cancel the armed round and end a running one early. */
  stop(): void {
    this.stopped = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** One round over the unseen files, then the next one while any file is watched. */
  private async runRound(): Promise<void> {
    this.roundInFlight = true
    try {
      const unseen = [...this.deps.watchedPaths()].filter(filePath => !this.deps.isCovered(filePath))
      await reportMissingPaths(unseen, this.deps.onMissing, this.deps.exists, () => this.stopped)
    } catch (error) {
      logger.error('Unseen file watch probe failed', redactedLogError(error))
    } finally {
      this.roundInFlight = false
    }
    if (hasAny(this.deps.watchedPaths())) this.schedule()
  }
}

function hasAny(paths: Iterable<string>): boolean {
  return paths[Symbol.iterator]().next().done !== true
}

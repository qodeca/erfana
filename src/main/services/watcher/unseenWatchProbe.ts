// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * unseenWatchProbe - notices a watched file that vanished where no watcher looks.
 *
 * A single-file watch hears nothing when a folder above the file is renamed,
 * moved or deleted: the file itself is never touched, so no event reaches it on
 * any platform. The project watcher reports such removals (`ancestorRemoval`),
 * but it never sees a folder its path filter drops – excluded, hidden or
 * ignored – so such a tab was never marked deleted (#252). Watching every
 * ancestor folder instead would cost a handle per folder, and on Windows an
 * open folder handle can stop its parents being renamed. So the watched files
 * the project watcher cannot see are re-checked on a slow timer, under rules
 * that keep it cheap and honest:
 *
 * - One `stat` at a time, through one queue shared by the rounds and by
 *   {@link UnseenWatchProbe.checkNow}: a `stat` on a network drive that stopped
 *   answering holds a libuv thread, and parallel ones could hold them all.
 * - Each `stat` is time-boxed, and a path whose earlier `stat` never answered
 *   is not asked again until it does. A timeout counts as present.
 * - The next round waits the interval plus the last round's duration, and is
 *   armed only while some watched file is unseen. The "covered" verdict is
 *   kept per path until that watch or the project watcher's coverage changes.
 * - A file is reported only once two rounds in a row found it gone, and never
 *   while one of the app's own operations is removing it.
 *
 * A reported file takes the watch's normal unlink path, whose atomic-save
 * window and final existence check guard against a false banner.
 */
import { logger } from '../LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import { TimeoutError, withTimeout } from '../../utils/withTimeout'
import { pathIsPresent } from './pathPresence'

/** Time between two rounds of the probe, before the back-off. */
export const UNSEEN_PROBE_INTERVAL_MS = 2000

/** How long one `stat` may take before it counts as "present, for now". */
export const UNSEEN_STAT_TIMEOUT_MS = 1000

/** Rounds in a row a file must be found gone before it is reported. */
export const MISSING_ROUNDS_TO_REPORT = 2

/** What the project watcher can say about removals; `DirectoryWatcherService` provides it. */
export interface RemovalCoverage {
  /** True when the project watcher would report a removal of any folder above the file. */
  reportsRemovalsAbove(filePath: string): boolean
  /** True when an own operation, in a pause still running, removed this path or a folder above it. */
  isOwnRemoval(filePath: string): boolean
  /** Hear when `reportsRemovalsAbove` may answer differently; returns an unsubscribe. */
  onCoverageChanged(listener: () => void): () => void
}

/** The slice of `FileWatcherService` the probe needs. */
export interface UnseenWatchProbeDeps {
  /** The watched paths the probe may check (inside the project, current session), read afresh. */
  probeablePaths(): readonly string[]
  /** The file is gone: hand it to the watch's unlink path. */
  onMissing(filePath: string): void
  /** Existence test; {@link pathIsPresent} by default. */
  exists?(filePath: string): Promise<boolean>
}

export class UnseenWatchProbe {
  private coverage: RemovalCoverage | null = null
  private unsubscribeCoverage: (() => void) | null = null
  private readonly coveredVerdicts = new Map<string, boolean>()
  private readonly missedRounds = new Map<string, number>()
  /** Paths whose last `stat` has not answered, even if its time box ran out. */
  private readonly unsettledStats = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | null = null
  /** A round is queued or running. */
  private roundPending = false
  private lastRoundMs = 0
  /** Bumped by {@link reset}: a check of an older generation stops at the next path. */
  private generation = 0
  private disposed = false

  constructor(private readonly deps: UnseenWatchProbeDeps) {}

  /** Take the project watcher's answers from `coverage`; with none, no file is unseen. */
  setCoverage(coverage: RemovalCoverage | null): void {
    this.unsubscribeCoverage?.()
    this.unsubscribeCoverage = null
    this.coverage = this.disposed ? null : coverage
    if (this.coverage) {
      this.unsubscribeCoverage = this.coverage.onCoverageChanged(() => this.coverageChanged())
    }
    this.coverageChanged()
  }

  /** A path started or stopped being watched: its verdict and its missed rounds start over. */
  pathChanged(filePath: string): void {
    this.coveredVerdicts.delete(filePath)
    this.missedRounds.delete(filePath)
    this.schedule()
  }

  /** Arm the next round, unless one is armed or pending, or no watched file is unseen. */
  schedule(): void {
    if (this.disposed || this.timer !== null || this.roundPending) return
    if (this.unseenPaths().length === 0) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.runRound()
    }, UNSEEN_PROBE_INTERVAL_MS + this.lastRoundMs)
    // A background check must never keep the process alive on its own
    this.timer.unref?.()
  }

  /**
   * Check these paths once, in the rounds' queue, and report each one that is
   * gone unless `isOwnRemoval` says the app removed it itself. For removals
   * the project watcher lost without a path: one check is evidence enough.
   */
  checkNow(paths: readonly string[], isOwnRemoval: (filePath: string) => boolean): Promise<void> {
    const generation = this.generation
    return this.enqueue(async () => {
      for (const filePath of paths) {
        if (this.isCancelled(generation)) return
        const present = await this.isPresent(filePath)
        if (this.isCancelled(generation)) return
        if (!present && !isOwnRemoval(filePath)) this.deps.onMissing(filePath)
      }
    })
  }

  /**
   * A project switch: cancel the armed round, end a running check early (its
   * answers, even "gone", are dropped) and forget every verdict and the old
   * project's back-off.
   */
  reset(): void {
    this.generation++
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.coveredVerdicts.clear()
    this.missedRounds.clear()
    this.lastRoundMs = 0
  }

  /** Stop for good (app shutdown). */
  dispose(): void {
    this.disposed = true
    this.reset()
    this.setCoverage(null)
  }

  private coverageChanged(): void {
    this.coveredVerdicts.clear()
    this.schedule()
  }

  private runRound(): void {
    this.roundPending = true
    const generation = this.generation
    void this.enqueue(async () => {
      const startedAt = Date.now()
      try {
        await this.checkRound(generation)
      } catch (error) {
        logger.error('Unseen file watch probe failed', redactedLogError(error))
      } finally {
        // A round cut short by a reset says nothing about the next project's disk
        if (!this.isCancelled(generation)) this.lastRoundMs = Date.now() - startedAt
        this.roundPending = false
      }
      this.schedule()
    })
  }

  private async checkRound(generation: number): Promise<void> {
    const unseen = this.unseenPaths()
    const probed = new Set(unseen)
    for (const filePath of this.missedRounds.keys()) {
      if (!probed.has(filePath)) this.missedRounds.delete(filePath)
    }
    for (const filePath of unseen) {
      if (this.isCancelled(generation)) return
      const present = await this.isPresent(filePath)
      if (this.isCancelled(generation)) return
      this.countRound(filePath, present)
    }
  }

  /** Report a path once it was gone two rounds in a row, never while the app itself removes it. */
  private countRound(filePath: string, present: boolean): void {
    if (present || this.coverage?.isOwnRemoval(filePath)) {
      this.missedRounds.delete(filePath)
      return
    }
    const missed = (this.missedRounds.get(filePath) ?? 0) + 1
    if (missed < MISSING_ROUNDS_TO_REPORT) {
      this.missedRounds.set(filePath, missed)
      return
    }
    this.missedRounds.delete(filePath)
    this.deps.onMissing(filePath)
  }

  private unseenPaths(): string[] {
    const coverage = this.coverage
    if (!coverage) return []
    return this.deps.probeablePaths().filter(filePath => !this.isCovered(coverage, filePath))
  }

  private isCovered(coverage: RemovalCoverage, filePath: string): boolean {
    const cached = this.coveredVerdicts.get(filePath)
    if (cached !== undefined) return cached
    let verdict = false
    try {
      verdict = coverage.reportsRemovalsAbove(filePath)
    } catch (error) {
      // Unknown counts as unseen: checking a file it did not need to is the safe mistake
      logger.error('Unseen file watch probe failed', redactedLogError(error))
    }
    this.coveredVerdicts.set(filePath, verdict)
    return verdict
  }

  /** One time-boxed `stat`. A timeout counts as present; so does a path whose last `stat` is still out. */
  private async isPresent(filePath: string): Promise<boolean> {
    if (this.unsettledStats.has(filePath)) return true
    this.unsettledStats.add(filePath)
    const check = Promise.resolve()
      .then(() => (this.deps.exists ? this.deps.exists(filePath) : pathIsPresent(filePath)))
      .finally(() => this.unsettledStats.delete(filePath))
    try {
      return await withTimeout(check, UNSEEN_STAT_TIMEOUT_MS, 'Unseen file watch stat')
    } catch (error) {
      if (error instanceof TimeoutError) return true
      throw error
    }
  }

  private isCancelled(generation: number): boolean {
    return this.disposed || generation !== this.generation
  }

  /** Run a check after every earlier one; the queue's tail never rejects. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => undefined)
    return result
  }
}

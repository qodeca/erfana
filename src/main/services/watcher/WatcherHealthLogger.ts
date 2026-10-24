// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The directory watcher's periodic health line (120 s), split out of
 * `DirectoryWatcherService` (finding [65]).
 */
import { logger } from '../LoggingService'
import { collectMemorySnapshot } from '../../utils/processMemorySnapshot'
import type { WatcherMetrics } from './WatcherMetrics'

export class WatcherHealthLogger {
  // Health logger interval (120s)
  private healthLogInterval: NodeJS.Timeout | null = null
  // Resync count at the previous health line: only new resyncs mean stress
  private lastNativeResyncs = 0

  constructor(private readonly metrics: WatcherMetrics) {}

  /**
   * Start the periodic health logger (120s interval).
   * Logs watcher health metrics and promotes to warn on stress indicators.
   */
  start(): void {
    if (this.healthLogInterval !== null) return

    this.healthLogInterval = setInterval(() => this.logHealth(), 120000)
    this.healthLogInterval.unref()
  }

  /**
   * One health line: watcher metrics plus process memory (#208).
   *
   * Logged at `info` so it reaches `main.log` at the default file level – the
   * memory trend is the only trace a heap exhaustion leaves – and at `warn`
   * when the watcher shows stress.
   */
  private logHealth(): void {
    const snapshot = this.metrics.getSnapshot()
    const resourceCount = process.getActiveResourcesInfo().length

    // The counters are cumulative: a resync is stress only on the first line after it
    const newResyncs = snapshot.nativeResyncs > this.lastNativeResyncs
    this.lastNativeResyncs = snapshot.nativeResyncs
    const isStressed =
      snapshot.bufferOverflows > 0 ||
      snapshot.peakEventsPerSecond > 100 ||
      newResyncs
    const level = isStressed ? 'warn' : 'info'

    logger[level]('DirectoryWatcher health', {
      activeWatchers: snapshot.activeWatchers,
      eventsReceived: snapshot.eventsReceived,
      eventsFiltered: snapshot.eventsFiltered,
      nativeOverflows: snapshot.nativeOverflows,
      nativeResyncs: snapshot.nativeResyncs,
      matcherBudgetExceeded: snapshot.matcherBudgetExceeded,
      bufferOverflows: snapshot.bufferOverflows,
      errorCounts: snapshot.errorCounts,
      peakEventsPerSecond: snapshot.peakEventsPerSecond,
      resourceCount,
      ...collectMemorySnapshot()
    })
  }

  /**
   * Stop the periodic health logger.
   */
  stop(): void {
    if (this.healthLogInterval) {
      clearInterval(this.healthLogInterval)
      this.healthLogInterval = null
    }
  }
}

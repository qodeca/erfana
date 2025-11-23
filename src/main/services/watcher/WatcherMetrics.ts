/**
 * WatcherMetrics - Performance metrics for file watching operations
 *
 * Tracks key performance indicators based on VS Code's watcherStats.ts pattern:
 * - Event throughput (events/second)
 * - Coalesce efficiency (events saved by coalescing)
 * - Buffer usage (current vs max)
 * - Error counts by type
 *
 * Use getSnapshot() for DevTools debugging.
 */

export interface WatcherMetricsSnapshot {
  // Event counters
  eventsReceived: number
  eventsEmitted: number
  eventsCoalesced: number
  coalesceEfficiency: number // Percentage of events saved (0-100)

  // Throughput
  eventsPerSecond: number
  peakEventsPerSecond: number

  // Buffer status
  currentBufferSize: number
  maxBufferSize: number
  bufferOverflows: number

  // Timing
  avgEventLatencyMs: number
  maxEventLatencyMs: number

  // Errors
  errorCounts: Record<string, number>

  // Active watchers
  activeWatchers: number

  // Uptime
  uptimeMs: number
  lastResetTime: number
}

interface EventTiming {
  receivedAt: number
  emittedAt?: number
}

const ONE_SECOND_MS = 1000
const THROUGHPUT_WINDOW_MS = 5000 // Calculate throughput over 5 seconds

export class WatcherMetrics {
  // Counters
  private eventsReceived = 0
  private eventsEmitted = 0
  private eventsCoalesced = 0
  private bufferOverflows = 0

  // Buffer tracking
  private currentBufferSize = 0
  private maxBufferSize: number

  // Timing tracking (limited circular buffer)
  private eventTimings: EventTiming[] = []
  private readonly MAX_TIMING_SAMPLES = 1000

  // Throughput tracking
  private recentEventTimestamps: number[] = []
  private peakEventsPerSecond = 0

  // Error tracking
  private errorCounts: Map<string, number> = new Map()

  // Active watchers
  private activeWatcherCount = 0

  // Start time
  private startTime = Date.now()
  private lastResetTime = Date.now()

  constructor(maxBufferSize: number = 30000) {
    this.maxBufferSize = maxBufferSize
  }

  /**
   * Record a received event (before coalescing)
   */
  recordEventReceived(): void {
    this.eventsReceived++
    this.currentBufferSize++

    const now = Date.now()
    this.recentEventTimestamps.push(now)

    // Track timing
    if (this.eventTimings.length < this.MAX_TIMING_SAMPLES) {
      this.eventTimings.push({ receivedAt: now })
    }

    // Update peak throughput
    this.updatePeakThroughput()
  }

  /**
   * Record multiple received events (batch)
   */
  recordEventsReceived(count: number): void {
    for (let i = 0; i < count; i++) {
      this.recordEventReceived()
    }
  }

  /**
   * Record events emitted (after coalescing)
   */
  recordEventsEmitted(count: number): void {
    const now = Date.now()
    this.eventsEmitted += count
    this.currentBufferSize = Math.max(0, this.currentBufferSize - count)

    // Mark timings as emitted
    let marked = 0
    for (let i = this.eventTimings.length - 1; i >= 0 && marked < count; i--) {
      if (!this.eventTimings[i].emittedAt) {
        this.eventTimings[i].emittedAt = now
        marked++
      }
    }
  }

  /**
   * Record coalesced (merged/removed) events
   */
  recordEventsCoalesced(count: number): void {
    this.eventsCoalesced += count
    this.currentBufferSize = Math.max(0, this.currentBufferSize - count)
  }

  /**
   * Record buffer overflow (events dropped due to limit)
   */
  recordBufferOverflow(droppedCount: number): void {
    this.bufferOverflows++
    this.eventsCoalesced += droppedCount // Count dropped as "coalesced"
    this.currentBufferSize = Math.max(0, this.currentBufferSize - droppedCount)
  }

  /**
   * Record an error by type
   */
  recordError(errorType: string): void {
    const current = this.errorCounts.get(errorType) || 0
    this.errorCounts.set(errorType, current + 1)
  }

  /**
   * Update active watcher count
   */
  setActiveWatchers(count: number): void {
    this.activeWatcherCount = count
  }

  /**
   * Update buffer size directly (for sync with actual buffer)
   */
  setBufferSize(size: number): void {
    this.currentBufferSize = size
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): WatcherMetricsSnapshot {
    const now = Date.now()

    // Calculate throughput over window
    this.cleanupOldTimestamps()
    const eventsInWindow = this.recentEventTimestamps.length
    const windowSeconds = THROUGHPUT_WINDOW_MS / ONE_SECOND_MS
    const eventsPerSecond =
      eventsInWindow > 0 ? Math.round((eventsInWindow / windowSeconds) * 10) / 10 : 0

    // Calculate coalesce efficiency
    const coalesceEfficiency =
      this.eventsReceived > 0
        ? Math.round((this.eventsCoalesced / this.eventsReceived) * 100)
        : 0

    // Calculate latency from completed timings
    const completedTimings = this.eventTimings.filter((t) => t.emittedAt)
    let avgLatency = 0
    let maxLatency = 0

    if (completedTimings.length > 0) {
      const latencies = completedTimings.map((t) => t.emittedAt! - t.receivedAt)
      avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      maxLatency = Math.max(...latencies)
    }

    return {
      eventsReceived: this.eventsReceived,
      eventsEmitted: this.eventsEmitted,
      eventsCoalesced: this.eventsCoalesced,
      coalesceEfficiency,

      eventsPerSecond,
      peakEventsPerSecond: this.peakEventsPerSecond,

      currentBufferSize: this.currentBufferSize,
      maxBufferSize: this.maxBufferSize,
      bufferOverflows: this.bufferOverflows,

      avgEventLatencyMs: avgLatency,
      maxEventLatencyMs: maxLatency,

      errorCounts: Object.fromEntries(this.errorCounts),

      activeWatchers: this.activeWatcherCount,

      uptimeMs: now - this.startTime,
      lastResetTime: this.lastResetTime
    }
  }

  /**
   * Get a formatted string for logging/debugging
   */
  getFormattedStats(): string {
    const s = this.getSnapshot()
    return `[Watcher Metrics]
├── Events: received=${s.eventsReceived}, emitted=${s.eventsEmitted}, coalesced=${s.eventsCoalesced}
├── Efficiency: ${s.coalesceEfficiency}% events saved by coalescing
├── Throughput: ${s.eventsPerSecond}/s (peak: ${s.peakEventsPerSecond}/s)
├── Buffer: ${s.currentBufferSize}/${s.maxBufferSize} (overflows: ${s.bufferOverflows})
├── Latency: avg=${s.avgEventLatencyMs}ms, max=${s.maxEventLatencyMs}ms
├── Active watchers: ${s.activeWatchers}
├── Errors: ${JSON.stringify(s.errorCounts)}
└── Uptime: ${Math.round(s.uptimeMs / 1000)}s`
  }

  /**
   * Reset all metrics (for testing or after significant changes)
   */
  reset(): void {
    this.eventsReceived = 0
    this.eventsEmitted = 0
    this.eventsCoalesced = 0
    this.bufferOverflows = 0
    this.currentBufferSize = 0
    this.eventTimings = []
    this.recentEventTimestamps = []
    this.peakEventsPerSecond = 0
    this.errorCounts.clear()
    this.lastResetTime = Date.now()
  }

  /**
   * Update peak throughput calculation
   */
  private updatePeakThroughput(): void {
    this.cleanupOldTimestamps()
    const eventsInWindow = this.recentEventTimestamps.length
    const windowSeconds = THROUGHPUT_WINDOW_MS / ONE_SECOND_MS
    const currentThroughput = eventsInWindow / windowSeconds

    if (currentThroughput > this.peakEventsPerSecond) {
      this.peakEventsPerSecond = Math.round(currentThroughput * 10) / 10
    }
  }

  /**
   * Clean up old timestamps outside the throughput window
   */
  private cleanupOldTimestamps(): void {
    const cutoff = Date.now() - THROUGHPUT_WINDOW_MS
    this.recentEventTimestamps = this.recentEventTimestamps.filter((ts) => ts > cutoff)
  }
}

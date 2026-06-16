// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ThrottledWorker - VS Code-style chunk processing with throttling
 *
 * Based on VS Code's parcelWatcher.ts:178-187 implementation.
 *
 * Key features:
 * - Process events in chunks (default 500)
 * - Throttle delay between chunks (default 200ms)
 * - Buffer limit to prevent memory exhaustion (default 30,000)
 * - Collection delay before processing (default 75ms)
 *
 * VS Code Values:
 * - maxWorkChunkSize: 500 (Parcel), 100 (NodeJS)
 * - throttleDelay: 200ms
 * - maxBufferedWork: 30,000 (Parcel), 10,000 (NodeJS)
 * - collectionDelay: 75ms
 */

import { logger } from '../LoggingService'

export interface ThrottledWorkerOptions {
  /**
   * Maximum items to process in one chunk
   * VS Code: 500 for Parcel, 100 for NodeJS
   */
  maxWorkChunkSize: number

  /**
   * Delay between processing chunks (ms)
   * VS Code: 200ms
   */
  throttleDelay: number

  /**
   * Maximum items to buffer before dropping oldest
   * VS Code: 30,000 for Parcel, 10,000 for NodeJS
   */
  maxBufferedWork: number

  /**
   * Delay to collect events before processing (ms)
   * VS Code: 75ms (accounts for Parcel's 50ms internal delay)
   */
  collectionDelay: number
}

export interface ThrottledWorkerCallbacks<T> {
  /**
   * Called when a chunk of work is ready to process
   */
  onWork: (items: T[]) => void

  /**
   * Called when items are dropped due to buffer overflow
   */
  onOverflow?: (droppedCount: number) => void
}

const DEFAULT_OPTIONS: ThrottledWorkerOptions = {
  maxWorkChunkSize: 500,
  throttleDelay: 200,
  maxBufferedWork: 30000,
  collectionDelay: 75
}

/**
 * Compaction threshold — when the head offset exceeds this absolute count
 * AND exceeds half the underlying array length, we compact by slicing.
 * Prevents runaway memory (old array slots holding references) while avoiding
 * thrash for small-burst workloads.
 */
const COMPACT_ABSOLUTE_FLOOR = 1024

export class ThrottledWorker<T> {
  // Amortized-O(1) deque implemented as `T[]` + `bufferOffset`.
  //
  // Invariant: live items are `buffer[bufferOffset .. buffer.length)`.
  // - push: `buffer.push(item)` — O(1) amortized
  // - evict/consume from head: `bufferOffset += n` — O(1)
  // - periodic compaction reclaims memory when half the array is wasted
  //
  // This shape replaces the previous `buffer = buffer.slice(n)` pattern which
  // allocated a fresh N-element array on every front-drop. That pattern turned
  // a 60 k-event burst into ~14 GB of garbage + ~31 s wall-clock on Windows
  // (Defender + V8 GC interaction). See #173 for the perf story.
  private buffer: T[] = []
  private bufferOffset = 0
  private collectionTimer: NodeJS.Timeout | null = null
  private throttleTimer: NodeJS.Timeout | null = null
  private isProcessing = false
  private isDisposed = false
  private pressureWarningEmitted = false

  private readonly options: ThrottledWorkerOptions
  private readonly callbacks: ThrottledWorkerCallbacks<T>

  constructor(
    options: Partial<ThrottledWorkerOptions>,
    callbacks: ThrottledWorkerCallbacks<T>
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.callbacks = callbacks
  }

  /**
   * Add work item to the buffer
   */
  work(item: T): void {
    if (this.isDisposed) return
    this.buffer.push(item)
    this.enforceBufferLimit()
    this.checkBufferPressure()
    this.scheduleProcessing()
  }

  /**
   * Add multiple work items to the buffer
   */
  workMany(items: T[]): void {
    if (this.isDisposed) return
    this.buffer.push(...items)
    this.enforceBufferLimit()
    this.checkBufferPressure()
    this.scheduleProcessing()
  }

  /**
   * Get current buffer size (number of live items, not underlying array length)
   */
  getBufferSize(): number {
    return this.buffer.length - this.bufferOffset
  }

  /**
   * Check if currently processing
   */
  isBusy(): boolean {
    return this.isProcessing || this.collectionTimer !== null || this.throttleTimer !== null
  }

  /**
   * Cancel pending operations
   */
  cancel(): void {
    if (this.collectionTimer) {
      clearTimeout(this.collectionTimer)
      this.collectionTimer = null
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer)
      this.throttleTimer = null
    }
  }

  /**
   * Cancel and clear buffer
   */
  flush(): void {
    this.cancel()
    this.buffer = []
    this.bufferOffset = 0
    this.pressureWarningEmitted = false
  }

  /**
   * Dispose the worker
   */
  dispose(): void {
    this.isDisposed = true
    this.flush()
  }

  /**
   * Threshold-crossing pattern: warn at 80%, reset at 50%
   * Prevents oscillating log spam around the threshold boundary.
   */
  private checkBufferPressure(): void {
    const liveCount = this.getBufferSize()
    const fillRatio = liveCount / this.options.maxBufferedWork
    if (fillRatio >= 0.8 && !this.pressureWarningEmitted) {
      this.pressureWarningEmitted = true
      logger.warn('ThrottledWorker buffer pressure', {
        current: liveCount,
        max: this.options.maxBufferedWork,
        pct: Math.round(fillRatio * 100)
      })
    } else if (fillRatio < 0.5 && this.pressureWarningEmitted) {
      this.pressureWarningEmitted = false
    }
  }

  /**
   * Enforce buffer limit, dropping oldest items.
   *
   * O(1) per call: `bufferOffset += droppedCount` advances the head pointer,
   * dereferencing the dropped elements so V8 can GC them as the backing array
   * grows. Periodic compaction via {@link compactIfWasted} reclaims the
   * underlying array memory.
   */
  private enforceBufferLimit(): void {
    const liveCount = this.buffer.length - this.bufferOffset
    if (liveCount > this.options.maxBufferedWork) {
      const droppedCount = liveCount - this.options.maxBufferedWork
      // Null out dropped slots so V8 can GC them before the next compaction.
      // Without this, references linger in the backing array for the life of
      // the deque, which matters for large/long-lived event payloads.
      for (let i = this.bufferOffset; i < this.bufferOffset + droppedCount; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.buffer as any)[i] = undefined
      }
      this.bufferOffset += droppedCount
      logger.warn('ThrottledWorker buffer overflow', {
        dropped: droppedCount,
        current: this.buffer.length - this.bufferOffset,
        max: this.options.maxBufferedWork
      })

      if (this.callbacks.onOverflow) {
        this.callbacks.onOverflow(droppedCount)
      }

      this.compactIfWasted()
    }
  }

  /**
   * Compact the underlying array when >= half its length is wasted head slots.
   * O(n) per compaction; amortized O(1) per push because compactions are
   * spaced by at least N/2 pushes.
   */
  private compactIfWasted(): void {
    if (
      this.bufferOffset >= COMPACT_ABSOLUTE_FLOOR &&
      this.bufferOffset >= this.buffer.length / 2
    ) {
      this.buffer = this.buffer.slice(this.bufferOffset)
      this.bufferOffset = 0
    }
  }

  /**
   * Schedule processing after collection delay
   */
  private scheduleProcessing(): void {
    // Already scheduled or processing
    if (this.collectionTimer || this.isProcessing || this.throttleTimer) {
      return
    }

    this.collectionTimer = setTimeout(() => {
      this.collectionTimer = null
      this.processNextChunk()
    }, this.options.collectionDelay)
  }

  /**
   * Process the next chunk of work
   */
  private processNextChunk(): void {
    const liveCount = this.buffer.length - this.bufferOffset
    if (this.isDisposed || liveCount === 0) {
      this.isProcessing = false
      return
    }

    this.isProcessing = true

    // Extract chunk via offset advance — O(chunk size) for the slice,
    // O(1) for the offset bump. No backing-array shift.
    const chunkSize = Math.min(this.options.maxWorkChunkSize, liveCount)
    const chunk = this.buffer.slice(this.bufferOffset, this.bufferOffset + chunkSize)
    // Null out consumed slots so V8 can GC them before the next compaction.
    for (let i = this.bufferOffset; i < this.bufferOffset + chunkSize; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.buffer as any)[i] = undefined
    }
    this.bufferOffset += chunkSize
    this.compactIfWasted()

    // Process chunk
    try {
      this.callbacks.onWork(chunk)
    } catch (error) {
      logger.error('ThrottledWorker: Error processing chunk', error instanceof Error ? error : undefined)
    }

    // If more work, schedule next chunk after throttle delay
    if (this.buffer.length - this.bufferOffset > 0) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null
        this.processNextChunk()
      }, this.options.throttleDelay)
    } else {
      this.isProcessing = false
    }
  }
}

/**
 * Create a pre-configured ThrottledWorker with VS Code defaults
 */
export function createThrottledWorker<T>(
  onWork: (items: T[]) => void,
  onOverflow?: (droppedCount: number) => void,
  options?: Partial<ThrottledWorkerOptions>
): ThrottledWorker<T> {
  return new ThrottledWorker(options || {}, { onWork, onOverflow })
}

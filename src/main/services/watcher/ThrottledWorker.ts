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

export class ThrottledWorker<T> {
  private buffer: T[] = []
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

    // Threshold-crossing pattern: warn at 80%, reset at 50%
    const fillRatio = this.buffer.length / this.options.maxBufferedWork
    if (fillRatio >= 0.8 && !this.pressureWarningEmitted) {
      this.pressureWarningEmitted = true
      logger.warn('ThrottledWorker buffer pressure', {
        current: this.buffer.length,
        max: this.options.maxBufferedWork,
        pct: Math.round(fillRatio * 100)
      })
    } else if (fillRatio < 0.5 && this.pressureWarningEmitted) {
      this.pressureWarningEmitted = false
    }

    this.scheduleProcessing()
  }

  /**
   * Add multiple work items to the buffer
   */
  workMany(items: T[]): void {
    if (this.isDisposed) return
    this.buffer.push(...items)
    this.enforceBufferLimit()
    this.scheduleProcessing()
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.buffer.length
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
   * Enforce buffer limit, dropping oldest items
   */
  private enforceBufferLimit(): void {
    if (this.buffer.length > this.options.maxBufferedWork) {
      const droppedCount = this.buffer.length - this.options.maxBufferedWork
      this.buffer = this.buffer.slice(droppedCount)
      logger.warn('ThrottledWorker buffer overflow', {
        dropped: droppedCount,
        current: this.buffer.length,
        max: this.options.maxBufferedWork
      })

      if (this.callbacks.onOverflow) {
        this.callbacks.onOverflow(droppedCount)
      }
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
    if (this.isDisposed || this.buffer.length === 0) {
      this.isProcessing = false
      return
    }

    this.isProcessing = true

    // Extract chunk
    const chunk = this.buffer.splice(0, this.options.maxWorkChunkSize)

    // Process chunk
    try {
      this.callbacks.onWork(chunk)
    } catch (error) {
      logger.error('ThrottledWorker: Error processing chunk', error instanceof Error ? error : undefined)
    }

    // If more work, schedule next chunk after throttle delay
    if (this.buffer.length > 0) {
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

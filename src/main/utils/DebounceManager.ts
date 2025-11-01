/**
 * DebounceManager handles adaptive debouncing with bulk operation detection
 * Automatically adjusts delay based on event frequency
 *
 * Example:
 *   const manager = new DebounceManager(1000, 5, 300)
 *   manager.schedule(() => console.log('Executed!'), 10) // 10 pending events => bulk delay
 */
export class DebounceManager {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly bulkDelay: number = 1000,
    private readonly bulkThreshold: number = 5,
    private readonly normalDelay: number = 300
  ) {}

  /**
   * Schedule a callback with adaptive debouncing
   * @param callback - Function to execute after delay
   * @param eventCount - Number of pending events (for bulk detection)
   * @returns true if scheduled, false if already scheduled (will reschedule)
   */
  schedule(callback: () => void, eventCount: number): void {
    // Clear existing timer
    if (this.timer) {
      clearTimeout(this.timer)
    }

    // Determine delay based on event frequency
    // If we have many pending events, it's likely a bulk operation (git, npm, etc)
    const isBulkOperation = eventCount >= this.bulkThreshold
    const delay = isBulkOperation ? this.bulkDelay : this.normalDelay

    // Schedule callback
    this.timer = setTimeout(() => {
      callback()
      this.timer = null
    }, delay)
  }

  /**
   * Cancel any pending callback
   */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /**
   * Check if a callback is currently scheduled
   */
  isScheduled(): boolean {
    return this.timer !== null
  }
}

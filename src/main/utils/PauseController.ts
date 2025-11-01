/**
 * PauseController manages pause/resume state with reference counting
 * Enables nested pause/resume operations to work correctly
 *
 * Example:
 *   controller.pause() // count: 1, isPaused: true
 *   controller.pause() // count: 2, isPaused: true
 *   controller.resume() // count: 1, isPaused: true (still paused)
 *   controller.resume() // count: 0, isPaused: false (now resumed)
 */
export class PauseController {
  private pauseCount = 0

  /**
   * Increment pause counter and mark as paused
   * Returns the new pause count
   */
  pause(): number {
    this.pauseCount++
    return this.pauseCount
  }

  /**
   * Decrement pause counter
   * Returns true if fully resumed (count reached 0), false otherwise
   */
  resume(): boolean {
    this.pauseCount = Math.max(0, this.pauseCount - 1)
    return this.pauseCount === 0
  }

  /**
   * Check if currently paused (pauseCount > 0)
   */
  isPaused(): boolean {
    return this.pauseCount > 0
  }

  /**
   * Get current pause count
   */
  getCount(): number {
    return this.pauseCount
  }

  /**
   * Force reset to unpaused state
   * Useful for error recovery or cleanup
   */
  reset(): void {
    this.pauseCount = 0
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Options for configuring PauseController behavior
 */
export interface PauseControllerOptions {
  /** Safety timeout in ms: auto-resume if resume() is not called within this window */
  timeoutMs?: number
  /** Callback invoked when the safety timeout fires and the controller is auto-resumed */
  onTimeout?: () => void
}

/**
 * PauseController manages pause/resume state with reference counting
 * Enables nested pause/resume operations to work correctly
 *
 * When configured with a safety timeout, automatically resets to unpaused state
 * if resume() is not called within the timeout window. This prevents permanent
 * pause states caused by missed resume() calls (e.g., uncaught exceptions).
 *
 * Example:
 *   controller.pause() // count: 1, isPaused: true
 *   controller.pause() // count: 2, isPaused: true
 *   controller.resume() // count: 1, isPaused: true (still paused)
 *   controller.resume() // count: 0, isPaused: false (now resumed)
 */
export class PauseController {
  private pauseCount = 0
  private safetyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options?: PauseControllerOptions) {}

  /**
   * Increment pause counter and mark as paused
   * Returns the new pause count
   */
  pause(): number {
    this.pauseCount++
    if (this.options?.timeoutMs) {
      this.startTimer()
    }
    return this.pauseCount
  }

  /**
   * Decrement pause counter
   * Returns true if fully resumed (count reached 0), false otherwise
   */
  resume(): boolean {
    this.pauseCount = Math.max(0, this.pauseCount - 1)
    if (this.pauseCount === 0) {
      this.clearTimer()
    }
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
    this.clearTimer()
  }

  /**
   * Dispose of the controller, clearing any pending safety timer
   */
  dispose(): void {
    this.clearTimer()
  }

  /**
   * Start or restart the safety timer
   * Each pause() call resets the timer to give the full timeout window
   */
  private startTimer(): void {
    if (!this.options?.timeoutMs) return
    this.clearTimer()
    this.safetyTimer = setTimeout(() => this.handleTimeout(), this.options.timeoutMs)
  }

  /**
   * Clear the safety timer if one is pending
   */
  private clearTimer(): void {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer)
      this.safetyTimer = null
    }
  }

  /**
   * Handle safety timeout expiration
   * Resets the controller to unpaused state and invokes the onTimeout callback
   */
  private handleTimeout(): void {
    this.safetyTimer = null
    this.reset()
    this.options?.onTimeout?.()
  }
}

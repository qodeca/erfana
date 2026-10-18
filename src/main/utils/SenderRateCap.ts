// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/** Counters for one sender's current window. */
interface SenderWindow {
  logged: number
  suppressed: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * Fixed-window, per-sender rate cap with a drop summary.
 *
 * Same shape as the console-error cap in `rendererCrashHandlers.ts`: the window
 * opens on a sender's first record and closes `windowMs` later, at which point
 * `onSummary` reports how many records were dropped. The close is timer-driven
 * (not lazy), so a burst that stops right after hitting the cap still leaves
 * its "N dropped" line behind. Timers are `unref`'d so a pending window never
 * holds a quitting app open.
 */
export class SenderRateCap {
  private readonly windows = new Map<number, SenderWindow>()

  /**
   * @param maxPerWindow - Records allowed per sender per window
   * @param windowMs - Window length in milliseconds
   * @param onSummary - Called when a window closes with at least one drop
   */
  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
    private readonly onSummary: (senderId: number, suppressed: number, windowMs: number) => void
  ) {}

  /** `true` when this sender may write one more record in the current window. */
  allow(senderId: number): boolean {
    let current = this.windows.get(senderId)
    if (!current) {
      const timer = setTimeout(() => this.closeWindow(senderId), this.windowMs)
      timer.unref()
      current = { logged: 0, suppressed: 0, timer }
      this.windows.set(senderId, current)
    }

    if (current.logged < this.maxPerWindow) {
      current.logged += 1
      return true
    }

    current.suppressed += 1
    return false
  }

  private closeWindow(senderId: number): void {
    const current = this.windows.get(senderId)
    this.windows.delete(senderId)
    if (current && current.suppressed > 0) {
      this.onSummary(senderId, current.suppressed, this.windowMs)
    }
  }
}

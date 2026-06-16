// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MonotonicTimestampGenerator
 *
 * REFACTORING (todo015): Extract timestamp generation from SettingsService
 *
 * Generates monotonically increasing timestamps to prevent clock skew issues
 * (NTP sync, DST changes, manual time adjustments) from breaking sort order.
 *
 * Single Responsibility: Timestamp generation and monotonicity enforcement
 */

export class MonotonicTimestampGenerator {
  private lastTimestamp = 0

  /**
   * Generate a monotonically increasing timestamp
   *
   * Ensures returned timestamp is always greater than previous timestamps,
   * even if system clock goes backwards.
   */
  generate(): number {
    const currentTime = Date.now()
    const timestamp = Math.max(currentTime, this.lastTimestamp + 1)
    this.lastTimestamp = timestamp
    return timestamp
  }

  /**
   * Restore from persisted timestamp (e.g., on app restart)
   *
   * Ensures monotonicity continues across application restarts
   */
  restore(persistedTimestamp: number): void {
    if (persistedTimestamp > this.lastTimestamp) {
      this.lastTimestamp = persistedTimestamp
    }
  }

  /**
   * Get current last timestamp without generating new one
   */
  getLastTimestamp(): number {
    return this.lastTimestamp
  }
}

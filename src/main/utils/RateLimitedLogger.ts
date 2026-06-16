// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { logger } from '../services/LoggingService'

/**
 * Rate-limited logger to prevent log spam during error cascades.
 * Emits at most once per configured interval, reporting how many
 * events were suppressed since the last emission.
 *
 * @example
 * const emfileLogger = new RateLimitedLogger('emfile', 10000) // 10s cooldown
 * emfileLogger.log('warn', 'EMFILE detected', { dirPath, activeWatchers })
 */
export class RateLimitedLogger {
  private lastLogTime = 0
  private suppressedCount = 0

  readonly key: string

  constructor(key: string, private readonly intervalMs: number) {
    this.key = key
  }

  log(
    level: 'warn' | 'error' | 'info' | 'debug',
    message: string,
    meta?: Record<string, unknown>
  ): void {
    const now = performance.now()

    if (now - this.lastLogTime < this.intervalMs) {
      this.suppressedCount++
      return
    }

    const context = { ...meta, suppressedCount: this.suppressedCount }

    if (level === 'error') {
      logger.error(message, undefined, context)
    } else {
      logger[level](message, context)
    }

    this.lastLogTime = now
    this.suppressedCount = 0
  }

  reset(): void {
    this.lastLogTime = 0
    this.suppressedCount = 0
  }
}

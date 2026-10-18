// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { logger } from '../services/LoggingService'
import { writeCrashFallbackLine } from './crashFallbackLog'
import { isBenignShutdownTimerError } from './isBenignShutdownTimerError'

export const UNHANDLED_REJECTION_TAG = '[crash] unhandled-rejection'
export const UNCAUGHT_EXCEPTION_TAG = '[crash] uncaught-exception'

/** Set once the process listeners are attached; makes a second call a no-op. */
let processCrashLoggingRegistered = false

function record(tag: string, value: unknown): void {
  try {
    if (value instanceof Error) {
      logger.error(tag, value)
    } else {
      logger.error(tag, undefined, { reason: String(value) })
    }
  } catch {
    // the logger must never be the thing that throws inside a crash hook
  }
  writeCrashFallbackLine(tag, value)
}

/**
 * Records process-wide failures that would otherwise leave no trace.
 *
 * - `unhandledRejection` is logged. Having a listener means Node no longer
 *   escalates a stray rejection to an uncaught exception.
 * - `uncaughtExceptionMonitor` only OBSERVES: it runs before any
 *   `uncaughtException` listener and never changes what happens next, so the
 *   shutdown-scoped guard in `index.ts` and Electron's default handling stay
 *   exactly as they were. The benign shutdown timer race that guard swallows is
 *   skipped here too, so it is not recorded as a crash.
 *
 * Idempotent. Call once, as early as possible.
 */
export function registerProcessCrashLogging(): void {
  if (processCrashLoggingRegistered) return
  processCrashLoggingRegistered = true

  process.on('unhandledRejection', (reason) => {
    record(UNHANDLED_REJECTION_TAG, reason)
  })

  process.on('uncaughtExceptionMonitor', (error) => {
    if (isBenignShutdownTimerError(error)) return
    record(UNCAUGHT_EXCEPTION_TAG, error)
  })
}

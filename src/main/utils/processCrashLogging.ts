// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { logger } from '../services/LoggingService'
import { writeCrashFallbackLine } from './crashFallbackLog'
import { isBenignShutdownTimerError } from './isBenignShutdownTimerError'

export const UNHANDLED_REJECTION_TAG = '[crash] unhandled-rejection'
export const UNCAUGHT_EXCEPTION_TAG = '[crash] uncaught-exception'

/** Set once the process listeners are attached; makes a second call a no-op. */
let processCrashLoggingRegistered = false

/** Rejections already re-raised as uncaught exceptions, so the monitor does not log them twice. */
const reraised = new WeakSet<object>()

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
 * Turn an unhandled rejection back into an uncaught exception.
 *
 * Without any `unhandledRejection` listener Node (mode `throw`, the default)
 * raises the rejection as an uncaught exception, which Electron's main process
 * shows to the user. Merely adding a logging listener would silently swallow
 * that, so this puts it back: the throw happens in a microtask, outside the
 * listener, and non-Error reasons are wrapped the way Node wraps them
 * (`ERR_UNHANDLED_REJECTION`).
 */
function rethrowAsUncaught(reason: unknown): void {
  const error =
    reason instanceof Error
      ? reason
      : Object.assign(new Error(`Unhandled promise rejection: ${String(reason)}`), {
          code: 'ERR_UNHANDLED_REJECTION',
          reason
        })
  reraised.add(error)
  queueMicrotask(() => {
    throw error
  })
}

/** Test seam: how a non-benign rejection is re-raised. */
export interface ProcessCrashLoggingOptions {
  rethrow?: (reason: unknown) => void
}

/**
 * Records process-wide failures that would otherwise leave no trace, without
 * changing what happens to them.
 *
 * - `unhandledRejection` logs `[crash] unhandled-rejection`, then re-raises the
 *   rejection as an uncaught exception, exactly as Node did before this
 *   listener existed. The one exception is the benign shutdown timer race
 *   (`isBenignShutdownTimerError`): it is logged but not re-raised, matching
 *   the shutdown-scoped guard in `index.ts`.
 * - `uncaughtExceptionMonitor` only OBSERVES: it runs before any
 *   `uncaughtException` listener and never changes what happens next, so the
 *   shutdown-scoped guard in `index.ts` and Electron's default handling stay
 *   exactly as they were. The benign race is skipped there too, and so is an
 *   exception that was just re-raised from a rejection (already logged).
 *
 * Idempotent. Call once, as early as possible.
 */
export function registerProcessCrashLogging(options: ProcessCrashLoggingOptions = {}): void {
  if (processCrashLoggingRegistered) return
  processCrashLoggingRegistered = true

  const rethrow = options.rethrow ?? rethrowAsUncaught

  process.on('unhandledRejection', (reason) => {
    record(UNHANDLED_REJECTION_TAG, reason)
    if (!isBenignShutdownTimerError(reason)) rethrow(reason)
  })

  process.on('uncaughtExceptionMonitor', (error) => {
    if (isBenignShutdownTimerError(error)) return
    if (typeof error === 'object' && error !== null && reraised.has(error)) return
    record(UNCAUGHT_EXCEPTION_TAG, error)
  })
}

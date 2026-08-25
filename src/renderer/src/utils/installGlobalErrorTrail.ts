// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Global error trail for the failure classes no React boundary can see.
 *
 * `RootErrorBoundary` and `PanelErrorBoundary` only catch throws during render
 * or a lifecycle method. An error thrown from an event handler, a `setTimeout`
 * callback, or an unhandled promise rejection never reaches them — the UI stays
 * up and the incident leaves no record. This installs `window` listeners for
 * both classes and writes a `fatal`-level line in the SAME payload shape the
 * boundary uses, so one grep finds every crash-class record.
 *
 * Called from `main.tsx` BEFORE the route branch, so the screenshot-overlay
 * window gets a trail too. That is deliberate: the overlay has no recovery UI,
 * which makes the log the only evidence it ever produces.
 *
 * IDEMPOTENT. Installing twice registers one listener per event type.
 *
 * KNOWN DUPLICATE, stated plainly. `RendererLogger.installErrorHandlers()`
 * (`utils/logger.ts`) registers its own `error` / `unhandledrejection`
 * listeners at `error` level when the logger initialises. Both fire, so an
 * uncaught error currently produces one `fatal` line from here and one `error`
 * line from the logger. Suppressing the logger's pair from this module would
 * require `stopImmediatePropagation()`, which would silently kill every
 * `error` listener registered after this one — a worse defect than a duplicate
 * log line. Collapsing the two belongs in `logger.ts`.
 *
 * Additionally, React's DEVELOPMENT build re-throws a boundary-caught error to
 * `window` after `componentDidCatch`, so in dev a single crash can appear twice.
 * Production does not do this (design §1, §6).
 *
 * @see docs/design/design-issue-60.md §2.3 (global error trail)
 * @module utils/installGlobalErrorTrail
 */

import {
  APP_VERSION,
  buildErrorDetails,
  buildLogContext,
  toError
} from '../components/RootErrorBoundary/errorDetails'
import { logger } from './logger'

/** Log message for an uncaught error reaching `window`. Greppable. */
export const GLOBAL_ERROR_LOG_MESSAGE = '[GlobalErrorTrail] uncaught error'

/** Log message for an unhandled promise rejection. Greppable. */
export const GLOBAL_REJECTION_LOG_MESSAGE = '[GlobalErrorTrail] unhandled rejection'

/** Set once the listeners are attached; makes a second install a no-op. */
let installed = false

/**
 * Write one trail record.
 *
 * Never throws: a throwing global error handler would itself become an
 * uncaught error, which is how a log path turns into a crash loop.
 *
 * @param message - Greppable log message
 * @param value - The thrown / rejected value, of any type
 * @param extra - Event-specific fields merged into the log context
 */
function record(message: string, value: unknown, extra: Record<string, unknown>): void {
  try {
    const details = buildErrorDetails(value, null, APP_VERSION)
    logger.fatal(message, toError(value), { ...buildLogContext(details), ...extra })
  } catch {
    /* the trail is best effort by definition */
  }
}

/**
 * `window` `error` handler.
 *
 * @param event - The error event; `event.error` is absent for cross-origin
 *   script errors, in which case the message is all there is
 */
function handleErrorEvent(event: ErrorEvent): void {
  record(GLOBAL_ERROR_LOG_MESSAGE, event?.error ?? event?.message, {
    filename: event?.filename ?? '',
    lineno: event?.lineno ?? 0,
    colno: event?.colno ?? 0
  })
}

/**
 * `window` `unhandledrejection` handler.
 *
 * @param event - The rejection event; `event.reason` is arbitrary
 */
function handleRejectionEvent(event: PromiseRejectionEvent): void {
  record(GLOBAL_REJECTION_LOG_MESSAGE, event?.reason, {})
}

/**
 * Install the global error trail. Safe to call more than once.
 */
export function installGlobalErrorTrail(): void {
  if (installed) return
  if (typeof window === 'undefined') return

  installed = true
  window.addEventListener('error', handleErrorEvent)
  window.addEventListener('unhandledrejection', handleRejectionEvent)
}

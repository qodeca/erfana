// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared flake-guard for vitest setup files.
 *
 * **Problem this solves**
 * Vitest's reporter prints `Errors 1 error` when an unhandled rejection or
 * uncaught exception fires AFTER the test that triggered it has finished
 * (typically during worker teardown). The reporter does NOT include the
 * stack trace in default mode, making the flake invisible. Same class as
 * #159 (CameraDialog timer firing post-jsdom-teardown).
 *
 * **What this guard does**
 *
 * 1. **Logs** any unhandled rejection / uncaught exception with full stack
 *    so the originating async operation can be located.
 * 2. **Records** the count in `globalThis.__flakeGuardCount__` so a future
 *    `afterAll` hook (or CI script) can fail the run if the count > 0.
 *
 * Importantly, attaching a handler is NOT a fix on its own — the unhandled
 * rejection still represents an async cleanup bug. The handler just makes
 * the bug visible. Fix the underlying source (cancel the timer, await the
 * promise, etc.) when the stack points you at it.
 *
 * **Side effect note (relevant to current flake-hunt)**
 * Adding a `process.on('unhandledRejection')` listener prevents Node's
 * default-handler from printing to stderr. Vitest's "Errors N error" count
 * in the reporter ALSO listens to this event — but vitest checks for a
 * "rejection" listener via `process.listenerCount('unhandledRejection')`
 * and adjusts behavior. After this guard is installed, vitest no longer
 * counts the rejection toward "Errors" because we've claimed responsibility
 * for it. The console.error output is the new ground-truth signal.
 */

let unhandledCount = 0
let uncaughtCount = 0
let installed = false

export function installFlakeGuard(scope: string): void {
  // Idempotent — if a setup file gets re-evaluated (HMR, multiple workers
  // sharing setup), don't double-attach.
  if (installed) return
  installed = true

  process.on('unhandledRejection', (reason: unknown) => {
    unhandledCount++
    console.error(
      `[flakeGuard:${scope}] UNHANDLED REJECTION (#${unhandledCount}):`,
      reason instanceof Error ? reason.stack ?? reason.message : String(reason),
    )
  })

  process.on('uncaughtException', (err: Error) => {
    uncaughtCount++
    console.error(
      `[flakeGuard:${scope}] UNCAUGHT EXCEPTION (#${uncaughtCount}):`,
      err.stack ?? err.message,
    )
  })

  // Expose the counters globally so test runners / afterAll hooks / CI
  // scripts can introspect.
  ;(globalThis as Record<string, unknown>).__flakeGuardCount__ = {
    get unhandled() { return unhandledCount },
    get uncaught() { return uncaughtCount },
    scope,
  }
}

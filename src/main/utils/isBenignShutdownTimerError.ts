// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Detects the benign Node timer-subsystem race that chokidar can trigger during
 * app shutdown.
 *
 * `FileWatcherService` watches files with chokidar's `awaitWriteFinish` option,
 * which schedules internal `setTimeout`-based throttle timers (`FSWatcher._throttle`).
 * During the shutdown window an in-flight `ReaddirpStream` read callback can call
 * `setTimeout` just as Node/Electron is dismantling its timer priority queue,
 * throwing synchronously from `node:internal/timers`:
 *
 *   TypeError: Cannot read properties of undefined (reading 'expiry')
 *       at compareTimersLists (node:internal/timers)
 *       ...
 *       at setTimeout (node:internal/timers)
 *       at FSWatcher._throttle (chokidar/index.js)
 *
 * We are already exiting, so this is harmless – but as an *uncaught* exception it
 * crashes the main process and leaves file handles locked (observed as the e2e
 * `EBUSY ... unlink` teardown timeout on Windows). A shutdown-scoped
 * `uncaughtException` guard swallows exactly this error and lets the exit proceed.
 *
 * The match is deliberately narrow (message + timer-internal stack frame) so the
 * guard never masks an unrelated crash that happens to occur during shutdown.
 */
export function isBenignShutdownTimerError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const message = err.message ?? ''
  const stack = err.stack ?? ''
  return (
    message.includes("reading 'expiry'") &&
    (stack.includes('compareTimersLists') || stack.includes('internal/timers'))
  )
}

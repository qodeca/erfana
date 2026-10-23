// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The app-quit state machine (#305).
 *
 * `before-quit` starts an ASYNC shutdown (lock release, disposers, then `app.exit(0)`).
 * Electron emits `before-quit` a second time when something calls `app.quit()` while
 * that shutdown runs – the quit-confirm handler destroys the window, which fires
 * `window-all-closed`, which calls `app.quit()`. If that second event is not
 * prevented, Electron quits 1 ms after the shutdown started and the disposers never
 * finish (terminals, ConPTY workers and console hosts are torn down by Node instead).
 *
 * So: every `before-quit` is prevented, only the first starts the shutdown, and
 * `window-all-closed` does not call `app.quit()` once the shutdown is running. The
 * only way out is the `app.exit(0)` at the end of the shutdown.
 */
export interface QuitGuard {
  /** True once the shutdown sequence has been started. */
  isShuttingDown(): boolean
  /**
   * Handles a `before-quit` event: always prevents it.
   *
   * @returns true when the caller must run the shutdown sequence (first call only)
   */
  handleBeforeQuit(event: { preventDefault(): void }): boolean
  /** Handles `window-all-closed`: asks the app to quit unless the shutdown is already running. */
  handleWindowAllClosed(quit: () => void): void
}

export function createQuitGuard(): QuitGuard {
  let shuttingDown = false
  return {
    isShuttingDown: () => shuttingDown,
    handleBeforeQuit(event) {
      event.preventDefault()
      if (shuttingDown) return false
      shuttingDown = true
      return true
    },
    handleWindowAllClosed(quit) {
      if (!shuttingDown) quit()
    }
  }
}

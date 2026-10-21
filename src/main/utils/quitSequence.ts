// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Runs the app-quit steps so that the app ALWAYS exits (#305).
 *
 * `before-quit` is prevented for every quit (see quitGuard), so `app.exit(0)` is the
 * only way out. A step that throws, or a step that never settles, must not leave the
 * app un-quittable: later quits are blocked by the guard.
 */

/** A step may be sync or async; it may throw. */
export type QuitStep = () => void | Promise<void>

/**
 * Last-resort bound on the whole shutdown. Longer than every per-step bound in
 * `src/main/index.ts` (lock 1 s + disposers 2 s), so it only fires when something
 * never settles or the event loop is starved.
 */
export const SHUTDOWN_LAST_RESORT_MS = 8_000

/**
 * Arms a timer that exits the app if the shutdown has not. Deliberately not
 * `unref`'d: it must keep the process alive until the exit happens.
 *
 * @returns the timer, so the caller can clear it
 */
export function armLastResortExit(
  exit: () => void,
  ms: number = SHUTDOWN_LAST_RESORT_MS,
  setTimeoutFn: typeof setTimeout = setTimeout
): ReturnType<typeof setTimeout> {
  return setTimeoutFn(exit, ms)
}

/**
 * Runs the steps one after the other. A step that throws is reported and the next
 * one still runs; `exit` runs in every case.
 *
 * @param steps - the quit steps, in order
 * @param exit - leaves the app (`app.exit(0)`)
 * @param onError - called with whatever a step threw
 */
export async function runQuitSequence(
  steps: ReadonlyArray<QuitStep>,
  exit: () => void,
  onError: (error: unknown) => void
): Promise<void> {
  try {
    for (const step of steps) {
      try {
        await step()
      } catch (error) {
        onError(error)
      }
    }
  } finally {
    exit()
  }
}

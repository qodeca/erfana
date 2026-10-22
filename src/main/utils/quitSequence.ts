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
 * `src/main/index.ts` (lock 1 s + disposers 2 s + quit-helper launcher 3 s), so it only fires when something
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

/** Longest the quit waits for the quit helper's launcher before `app.exit(0)` (#305). */
export const LAUNCHER_WAIT_MS = 3_000

/**
 * Waits for `work` for at most `ms`; never rejects (#305: the quit-helper launcher must
 * leave libuv's kill-on-close job before the app exits, but a stuck one must not hold
 * up the quit).
 *
 * @returns whether `work` settled in time, and how long the wait took
 */
export async function waitBounded(
  work: Promise<unknown>,
  ms: number = LAUNCHER_WAIT_MS,
  now: () => number = Date.now,
  setTimeoutFn: typeof setTimeout = setTimeout
): Promise<{ settled: boolean; waitedMs: number }> {
  const startedAt = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeoutFn(() => resolve(false), ms)
  })
  const settled = await Promise.race([work.then(() => true, () => true), timedOut])
  clearTimeout(timer)
  return { settled, waitedMs: now() - startedAt }
}

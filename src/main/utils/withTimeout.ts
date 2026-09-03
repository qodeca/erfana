// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Race a promise against a timer, so an await that may never settle cannot
 * wedge whatever is waiting on it.
 *
 * Lived inside `ImageRasterizeWindow` as a module-private helper until the
 * preview's approval path needed the same thing: on Windows, Allow → Confirm
 * sat on "Saving…" forever because one await inside `applyApprovedHosts`
 * never settled (2026-09-03). Nothing time-boxed it, so nothing could recover.
 */

/** Thrown when the timer wins. `instanceof` it to tell a timeout from a failure. */
export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Resolve or reject with `promise`, unless `ms` elapses first, in which case
 * reject with a {@link TimeoutError} naming `what`. Never leaves an unhandled
 * rejection behind when the timer wins and the loser rejects later.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  // Belt-and-braces, and honestly labelled: `Promise.race` below already
  // attaches a rejection handler to `promise`, so a loser that rejects after
  // the timer won is ALREADY marked handled and cannot reach the process-level
  // unhandledRejection hook. This no-op handler is what keeps that true if the
  // race is ever replaced by a wrapper that attaches later.
  promise.catch(() => {})

  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}

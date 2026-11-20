// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Leading + trailing throttle for change events (#478, plan decision 32).
 *
 * The first change runs at once (P1); during a burst it runs at most once per
 * window, and the last change of a burst always runs at the end of its window,
 * so the final version is always shown (P2). `run` is told which: a trailing
 * run comes up to one window after the change that asked for it, so the
 * caller cannot assume the file is still as that change left it (P3). A window of 0 passes every
 * trigger straight through (the HTML preview, whose pool coalesce is its only
 * burst control – F21).
 *
 * @module shared/freshness/throttle
 */
import type { Clock, TimerHandle } from '../clock'

/** A throttled action. */
export interface Throttle {
  /**
   * Ask for a run: now if the window is free, else once at the end of it.
   * `unsettled`: the change that asks may still be being written, so even a
   * run at once is told it is not "right after the change" (`late` true).
   */
  trigger(unsettled?: boolean): void
  /** Drop a pending trailing run and close the window. */
  cancel(): void
}

/**
 * @param clock - time source (a manual clock in tests)
 * @param windowMs - shortest gap between two runs; 0 = no throttling
 * @param run - the action; called synchronously from `trigger` (`trailing`
 *   false, or true for an `unsettled` trigger) or from the window timer
 *   (`trailing` true)
 */
export function createThrottle(clock: Clock, windowMs: number, run: (trailing: boolean) => void): Throttle {
  let timer: TimerHandle | undefined
  let pending = false

  const openWindow = (): void => {
    timer = clock.setTimeout(onWindowEnd, windowMs)
  }

  function onWindowEnd(): void {
    timer = undefined
    if (!pending) return
    pending = false
    openWindow()
    run(true)
  }

  return {
    trigger(unsettled = false): void {
      if (windowMs <= 0) {
        run(unsettled)
        return
      }
      if (timer !== undefined) {
        pending = true
        return
      }
      openWindow()
      run(unsettled)
    },
    cancel(): void {
      clock.clearTimeout(timer)
      timer = undefined
      pending = false
    },
  }
}

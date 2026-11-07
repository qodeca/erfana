// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The main process's clock owner (spec 025 solution design § 12, T1).
 *
 * Every main-process module that measures time is handed {@link mainClock}
 * (or a clock injected by its own tests). In production it is the real clock.
 * In an e2e test build the test hooks swap in an offset clock before anything
 * schedules a timer (`src/main/testHooks/clockHook.ts`), so a test can move
 * main's time forward through `app.evaluate`.
 *
 * Distinct from `utils/Clock.ts`, the lock service's narrower time source.
 */
import { realClock, type Clock } from '../../shared/clock'

let current: Clock = realClock
let timerScheduled = false

/** The clock main-process modules use; it forwards to the clock in force. */
export const mainClock: Clock = {
  now: () => current.now(),
  setTimeout: (callback, delayMs) => {
    timerScheduled = true
    return current.setTimeout(callback, delayMs)
  },
  clearTimeout: handle => current.clearTimeout(handle),
  setInterval: (callback, intervalMs) => {
    timerScheduled = true
    return current.setInterval(callback, intervalMs)
  },
  clearInterval: handle => current.clearInterval(handle)
}

/**
 * Puts `clock` in force behind {@link mainClock}. Called by the test hooks at
 * start-up only; production code never calls it.
 *
 * @throws Error when a timer was already scheduled through `mainClock` – its
 *   handle belongs to the previous clock, which the new one could not clear.
 */
export function replaceMainClock(clock: Clock): void {
  if (timerScheduled) {
    throw new Error('replaceMainClock() must run before any timer is scheduled through mainClock')
  }
  current = clock
}

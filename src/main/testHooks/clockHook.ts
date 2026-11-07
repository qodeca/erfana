// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The clock test hook (spec 025 solution design § 12, T1): main owns time in
 * an e2e test build, and a test moves it forward with
 * `globalThis.__erfanaTestHooks.clock.advance(ms)` from `app.evaluate`.
 *
 * Test builds only – reached through `./index`, never from production code.
 */
import { createOffsetClock, realClock, type Clock, type TestClock } from '../../shared/clock'
import { replaceMainClock } from '../utils/mainClock'

/**
 * Something that must catch up after main's clock moved – for example a
 * renderer, which is told the new offset and acks. `advance` resolves only
 * after every follower has resolved.
 */
export type ClockFollower = (advancedMs: number) => Promise<void>

/** What a test reaches as `__erfanaTestHooks.clock`. */
export interface ClockTestHook {
  /** Main's current time, in epoch ms. */
  now(): number
  /** Total ms the test has moved main's clock. */
  advancedMs(): number
  /**
   * Moves main's clock forward by `ms`, fires the timers that fell due, then
   * waits for every follower. Async so a follower can be added without a
   * change for the tests that call it.
   */
  advance(ms: number): Promise<void>
}

/** The hook over `clock`; `followers` are told each new total after a move. */
export function createClockTestHook(
  clock: TestClock,
  followers: readonly ClockFollower[] = []
): ClockTestHook {
  return {
    now: () => clock.now(),
    advancedMs: () => clock.advancedMs(),
    advance: async ms => {
      clock.advance(ms)
      await Promise.all(followers.map(follow => follow(clock.advancedMs())))
    }
  }
}

/**
 * Puts an offset clock over `base` in force as main's clock and returns its
 * hook. Throws when main already scheduled a timer (`replaceMainClock`).
 */
export function installClockTestHook(
  base: Clock = realClock,
  install: (clock: Clock) => void = replaceMainClock
): ClockTestHook {
  const clock = createOffsetClock(base)
  install(clock)
  // Renderer sync (push the offset to each renderer and await its ack) is a
  // follower added by a later commit.
  return createClockTestHook(clock)
}

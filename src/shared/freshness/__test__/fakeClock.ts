// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Test clock for the freshness core: the shared manual clock
 * (`shared/clock.ts`) plus the async stepping a tracker needs – its work
 * alternates timers and promise continuations, so time is moved in small
 * steps with the microtask queue drained between them.
 */
import { createManualClock, type TestClock } from '../../clock'

/** Microtask turns drained per flush: enough for the deepest await chain in the core. */
const FLUSH_TURNS = 50
/** Default step of {@link FakeClock.run}, ms. */
const DEFAULT_STEP_MS = 5

export interface FakeClock extends TestClock {
  /** Drain pending promise continuations (no time passes). */
  flush(): Promise<void>
  /** Move time forward by `ms` in steps, draining promises before and after each. */
  run(ms: number, stepMs?: number): Promise<void>
}

export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < FLUSH_TURNS; i++) await Promise.resolve()
}

export function createFakeClock(startMs = 1_000_000): FakeClock {
  const clock = createManualClock(startMs)
  return Object.assign(clock, {
    flush: flushMicrotasks,
    async run(ms: number, stepMs = DEFAULT_STEP_MS): Promise<void> {
      let left = ms
      await flushMicrotasks()
      while (left > 0) {
        const step = Math.min(stepMs, left)
        clock.advance(step)
        left -= step
        await flushMicrotasks()
      }
    },
  })
}

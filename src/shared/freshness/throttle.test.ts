// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'

import { createManualClock } from '../clock'
import { createThrottle } from './throttle'

function setup(windowMs: number) {
  const clock = createManualClock(0)
  const runs: number[] = []
  const throttle = createThrottle(clock, windowMs, () => runs.push(clock.now()))
  return { clock, runs, throttle }
}

describe('createThrottle', () => {
  it('P1: runs the first trigger at once', () => {
    const { runs, throttle } = setup(250)
    throttle.trigger()
    expect(runs).toEqual([0])
  })

  it('P2: a burst runs at most once per window and always runs after the last trigger', () => {
    const { clock, runs, throttle } = setup(250)
    // Writes every 150 ms for 10 s
    for (let t = 0; t <= 10_000; t += 150) {
      clock.advance(t - clock.now())
      throttle.trigger()
    }
    const lastTrigger = clock.now()
    clock.advance(1_000)

    for (let i = 1; i < runs.length; i++) {
      expect(runs[i] - runs[i - 1]).toBeGreaterThanOrEqual(250)
      expect(runs[i] - runs[i - 1]).toBeLessThanOrEqual(1_000)
    }
    expect(runs[0]).toBe(0)
    expect(runs[runs.length - 1]).toBeGreaterThanOrEqual(lastTrigger)
  })

  it('tells a trailing run from a leading one', () => {
    const clock = createManualClock(0)
    const runs: boolean[] = []
    const throttle = createThrottle(clock, 250, (trailing) => runs.push(trailing))
    throttle.trigger()
    clock.advance(100)
    throttle.trigger()
    clock.advance(150)
    expect(runs).toEqual([false, true])
  })

  it('an unsettled trigger is told late even when it runs at once (F8), and with a window of 0', () => {
    for (const windowMs of [250, 0]) {
      const clock = createManualClock(0)
      const runs: boolean[] = []
      const throttle = createThrottle(clock, windowMs, (late) => runs.push(late))
      throttle.trigger(true)
      expect(runs).toEqual([true])
    }
  })

  it('a single trigger inside the window runs once, at the window end', () => {
    const { clock, runs, throttle } = setup(250)
    throttle.trigger()
    clock.advance(100)
    throttle.trigger()
    throttle.trigger()
    clock.advance(150)
    expect(runs).toEqual([0, 250])
    clock.advance(1_000)
    expect(runs).toEqual([0, 250])
  })

  it('the window frees after a quiet period: the next trigger runs at once', () => {
    const { clock, runs, throttle } = setup(250)
    throttle.trigger()
    clock.advance(300)
    throttle.trigger()
    expect(runs).toEqual([0, 300])
  })

  it('0 passes every trigger straight through (preview, F21)', () => {
    const { runs, throttle, clock } = setup(0)
    throttle.trigger()
    throttle.trigger()
    throttle.trigger()
    expect(runs).toEqual([0, 0, 0])
    expect(clock.pendingTimers()).toBe(0)
  })

  it('cancel drops the pending trailing run', () => {
    const { clock, runs, throttle } = setup(250)
    throttle.trigger()
    throttle.trigger()
    throttle.cancel()
    clock.advance(1_000)
    expect(runs).toEqual([0])
    expect(clock.pendingTimers()).toBe(0)
  })
})

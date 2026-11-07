// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The main clock owner: real time until the test hooks replace it, and no
 * replacement once a timer is out on the previous clock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createManualClock } from '../../shared/clock'

type MainClockModule = typeof import('./mainClock')

let mod: MainClockModule

beforeEach(async () => {
  vi.resetModules()
  mod = await import('./mainClock')
})

describe('mainClock', () => {
  it('reads real time until a clock is put in force', () => {
    const before = Date.now()
    const now = mod.mainClock.now()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(Date.now())
  })

  it('forwards time and every timer call to the clock put in force', () => {
    const clock = createManualClock(5_000)
    mod.replaceMainClock(clock)
    const once = vi.fn()
    const tick = vi.fn()
    const cleared = vi.fn()

    mod.mainClock.setTimeout(once, 500)
    mod.mainClock.clearTimeout(mod.mainClock.setTimeout(cleared, 100))
    const interval = mod.mainClock.setInterval(tick, 300)
    clock.advance(600)
    mod.mainClock.clearInterval(interval)
    clock.advance(1_000)

    expect(mod.mainClock.now()).toBe(6_600)
    expect(once).toHaveBeenCalledTimes(1)
    expect(cleared).not.toHaveBeenCalled()
    expect(tick).toHaveBeenCalledTimes(2)
    expect(clock.pendingTimers()).toBe(0)
  })

  it.each(['setTimeout', 'setInterval'] as const)(
    'refuses a replacement once %s has scheduled a timer',
    method => {
      const first = createManualClock()
      mod.replaceMainClock(first)
      mod.mainClock[method](() => {}, 10)
      expect(() => mod.replaceMainClock(createManualClock())).toThrow(/before any timer/)
    }
  )
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The injectable clock (spec 025 solution design § 12, T1): the timer rules
 * both test clocks share, the boundary edges the browser modules depend on
 * (499/500 ms, 299/300 ms), and the real clock's pass-through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_TIMERS_PER_ADVANCE,
  createManualClock,
  createOffsetClock,
  realClock,
  type TestClock
} from './clock'

/** Both test clocks, the offset one over a manual base so no real time passes. */
const testClocks: ReadonlyArray<[string, () => TestClock]> = [
  ['manual clock', () => createManualClock(1_000)],
  ['offset clock', () => createOffsetClock(createManualClock(1_000))]
]

describe.each(testClocks)('%s', (_name, makeClock) => {
  it('starts at its start time and moves only by advance', () => {
    const clock = makeClock()
    expect(clock.now()).toBe(1_000)
    clock.advance(250)
    expect(clock.now()).toBe(1_250)
    expect(clock.advancedMs()).toBe(250)
  })

  it.each([
    [500, 499],
    [300, 299]
  ])('a %i ms timer has not fired at %i ms and fires at exactly its due time', (delay, before) => {
    const clock = makeClock()
    const fired = vi.fn()
    clock.setTimeout(fired, delay)

    clock.advance(before)
    expect(fired).not.toHaveBeenCalled()
    clock.advance(1)
    expect(fired).toHaveBeenCalledTimes(1)
    expect(clock.pendingTimers()).toBe(0)
  })

  it('advance(0) fires a zero-delay timer, and no timer fires before advance is called', () => {
    const clock = makeClock()
    const fired = vi.fn()
    clock.setTimeout(fired, 0)
    expect(fired).not.toHaveBeenCalled()
    clock.advance(0)
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it('fires due timers in due order, and same-time timers in scheduling order', () => {
    const clock = makeClock()
    const order: string[] = []
    clock.setTimeout(() => order.push('c@300'), 300)
    clock.setTimeout(() => order.push('a@100'), 100)
    clock.setTimeout(() => order.push('b1@200'), 200)
    clock.setTimeout(() => order.push('b2@200'), 200)
    clock.advance(1_000)
    expect(order).toEqual(['a@100', 'b1@200', 'b2@200', 'c@300'])
  })

  it('fires a timer scheduled by a firing timer in the same advance when it is due by the end', () => {
    const clock = makeClock()
    const order: string[] = []
    clock.setTimeout(() => {
      order.push('outer')
      clock.setTimeout(() => order.push('inner'), 0)
      clock.setTimeout(() => order.push('late'), 10_000)
    }, 100)
    clock.advance(200)
    expect(order).toEqual(['outer', 'inner'])
    expect(clock.pendingTimers()).toBe(1)
  })

  it('does not fire a cleared timer, and ignores unknown and undefined handles', () => {
    const clock = makeClock()
    const fired = vi.fn()
    const handle = clock.setTimeout(fired, 10)
    clock.clearTimeout(handle)
    clock.clearTimeout(undefined)
    clock.clearTimeout(handle)
    clock.advance(100)
    expect(fired).not.toHaveBeenCalled()
  })

  it('treats a negative or non-finite delay as 0', () => {
    const clock = makeClock()
    const fired = vi.fn()
    clock.setTimeout(fired, -5)
    clock.setTimeout(fired, Number.NaN)
    clock.advance(0)
    expect(fired).toHaveBeenCalledTimes(2)
  })

  it('repeats an interval once per period until cleared, also from inside its callback', () => {
    const clock = makeClock()
    let ticks = 0
    const handle = clock.setInterval(() => {
      ticks += 1
      if (ticks === 3) clock.clearInterval(handle)
    }, 100)
    clock.advance(99)
    expect(ticks).toBe(0)
    clock.advance(1)
    expect(ticks).toBe(1)
    clock.advance(1_000)
    expect(ticks).toBe(3)
    expect(clock.pendingTimers()).toBe(0)
  })

  it('clamps a zero interval to 1 ms', () => {
    const clock = makeClock()
    const tick = vi.fn()
    const handle = clock.setInterval(tick, 0)
    clock.advance(5)
    expect(tick).toHaveBeenCalledTimes(5)
    clock.clearTimeout(handle)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses advance(%d)', ms => {
    expect(() => makeClock().advance(ms)).toThrow(RangeError)
  })

  it('refuses advance from inside one of its own timer callbacks', () => {
    const clock = makeClock()
    clock.setTimeout(() => clock.advance(1), 10)
    expect(() => clock.advance(10)).toThrow(/inside a timer callback/)
  })

  it('stops a timer that reschedules itself with no delay', () => {
    const clock = makeClock()
    const again = (): void => {
      clock.setTimeout(again, 0)
    }
    clock.setTimeout(again, 0)
    expect(() => clock.advance(0)).toThrow(new RegExp(String(MAX_TIMERS_PER_ADVANCE)))
  })

  it('stays consistent when a callback throws: the rest fire on the next advance', () => {
    const clock = makeClock()
    const later = vi.fn()
    clock.setTimeout(() => {
      throw new Error('boom')
    }, 10)
    clock.setTimeout(later, 20)
    expect(() => clock.advance(30)).toThrow('boom')
    expect(later).not.toHaveBeenCalled()
    clock.advance(30)
    expect(later).toHaveBeenCalledTimes(1)
    expect(clock.pendingTimers()).toBe(0)
  })
})

describe('createManualClock', () => {
  it('starts at 0 by default and reads each timer its own due time inside the callback', () => {
    const clock = createManualClock()
    const seen: number[] = []
    clock.setTimeout(() => seen.push(clock.now()), 100)
    clock.setTimeout(() => seen.push(clock.now()), 250)
    clock.advance(1_000)
    expect(seen).toEqual([100, 250])
    expect(clock.now()).toBe(1_000)
  })

  it('fires an interval at each period inside one advance', () => {
    const clock = createManualClock()
    const seen: number[] = []
    clock.setInterval(() => seen.push(clock.now()), 300)
    clock.advance(999)
    expect(seen).toEqual([300, 600, 900])
  })
})

describe('createOffsetClock', () => {
  it('reads base time plus the start offset plus every advance', () => {
    const base = createManualClock(10_000)
    const clock = createOffsetClock(base, 5_000)
    expect(clock.now()).toBe(15_000)
    base.advance(100)
    expect(clock.now()).toBe(15_100)
    clock.advance(400)
    expect(clock.now()).toBe(15_500)
    expect(clock.advancedMs()).toBe(400)
  })

  it('fires a timer when base time reaches its due time, without an advance', () => {
    const base = createManualClock()
    const clock = createOffsetClock(base)
    const fired = vi.fn()
    clock.setTimeout(fired, 500)
    base.advance(499)
    expect(fired).not.toHaveBeenCalled()
    base.advance(1)
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it('arms one base timer, for the earliest due timer, and none once the queue is empty', () => {
    const base = createManualClock()
    const clock = createOffsetClock(base)
    const late = clock.setTimeout(() => {}, 900)
    clock.setTimeout(() => {}, 300)
    expect(base.pendingTimers()).toBe(1)
    base.advance(300)
    expect(base.pendingTimers()).toBe(1)
    clock.clearTimeout(late)
    expect(base.pendingTimers()).toBe(0)
  })

  it('re-arms the base timer for a shorter wait after an advance', () => {
    const base = createManualClock()
    const clock = createOffsetClock(base)
    const fired = vi.fn()
    clock.setTimeout(fired, 1_000)
    clock.advance(600)
    base.advance(399)
    expect(fired).not.toHaveBeenCalled()
    base.advance(1)
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it('re-arms the base timer even when a callback fired by base time throws', () => {
    const base = createManualClock()
    const clock = createOffsetClock(base)
    const later = vi.fn()
    clock.setTimeout(() => {
      throw new Error('boom')
    }, 10)
    clock.setTimeout(later, 20)
    expect(() => base.advance(10)).toThrow('boom')
    base.advance(10)
    expect(later).toHaveBeenCalledTimes(1)
  })
})

describe('realClock', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads Date.now() and passes timers through to the host', () => {
    vi.useFakeTimers({ now: 42_000 })
    expect(realClock.now()).toBe(42_000)

    const once = vi.fn()
    const cleared = vi.fn()
    const tick = vi.fn()
    realClock.setTimeout(once, 500)
    realClock.clearTimeout(realClock.setTimeout(cleared, 100))
    const interval = realClock.setInterval(tick, 200)

    vi.advanceTimersByTime(499)
    expect(once).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(once).toHaveBeenCalledTimes(1)
    expect(cleared).not.toHaveBeenCalled()
    expect(tick).toHaveBeenCalledTimes(2)

    realClock.clearInterval(interval)
    vi.advanceTimersByTime(1_000)
    expect(tick).toHaveBeenCalledTimes(2)
  })
})

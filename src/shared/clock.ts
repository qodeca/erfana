// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * An injectable clock (spec 025 solution design § 12, panel finding T1).
 *
 * Every module that measures time – an input guard, a queue gap, an expiry –
 * takes a {@link Clock} instead of calling `Date.now()` and `setTimeout`
 * directly, so a test can move time instead of waiting for it. No imports, on
 * purpose, so main and renderer run the same code.
 *
 * Three implementations:
 * - {@link realClock} – wall-clock time and the host's own timers; production.
 * - {@link createManualClock} – time moves only on `advance(ms)`; unit tests.
 * - {@link createOffsetClock} – wall-clock time plus an offset that
 *   `advance(ms)` grows; e2e test builds, where the app keeps running on real
 *   time and a test jumps it forward.
 *
 * Timer rules shared by the two test clocks:
 * - A timer due at exactly `t` fires when time reaches `t`, never before.
 * - Due timers fire in due-time order; timers due at the same time fire in the
 *   order they were scheduled.
 * - A timer scheduled by a firing timer fires in the same `advance` when it is
 *   due by the end of it.
 * - A delay that is negative or not a finite number counts as 0; an interval
 *   shorter than 1 ms counts as 1 ms, as in browsers and Node.
 * - `clearTimeout` and `clearInterval` are interchangeable, ignore an unknown
 *   or `undefined` handle, and stop an interval from inside its own callback.
 */

declare const timerHandleBrand: unique symbol

/** An opaque timer handle; only the clock that issued it can clear it. */
export type TimerHandle = { readonly [timerHandleBrand]: 'TimerHandle' }

/** What a time-measuring module needs: the current time and timers. */
export interface Clock {
  /** Milliseconds since the Unix epoch (or since the manual clock's start). */
  now(): number
  setTimeout(callback: () => void, delayMs: number): TimerHandle
  clearTimeout(handle: TimerHandle | undefined): void
  setInterval(callback: () => void, intervalMs: number): TimerHandle
  clearInterval(handle: TimerHandle | undefined): void
}

/** A clock a test can move forward. */
export interface TestClock extends Clock {
  /**
   * Moves time forward by `ms` and fires every timer that falls due, in order.
   * Throws a `RangeError` for a negative or non-finite `ms`, and an `Error` when
   * called from inside a timer callback of the same clock or when timers keep
   * rescheduling themselves past {@link MAX_TIMERS_PER_ADVANCE}. An exception
   * thrown by a timer callback propagates out of `advance`; the clock stays
   * consistent and the remaining due timers fire on the next `advance`.
   */
  advance(ms: number): void
  /** Total milliseconds moved by `advance` so far. */
  advancedMs(): number
  /** Timers scheduled and not yet fired or cleared (an interval counts once). */
  pendingTimers(): number
}

/**
 * The most timer callbacks one `advance` runs. A timer that reschedules itself
 * with no delay would otherwise loop forever; this turns that into an error.
 */
export const MAX_TIMERS_PER_ADVANCE = 10_000

type HostTimer = ReturnType<typeof globalThis.setTimeout>

/** Wall-clock time and the host's own timers. */
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs) as unknown as TimerHandle,
  clearTimeout: handle => globalThis.clearTimeout(handle as unknown as HostTimer | undefined),
  setInterval: (callback, intervalMs) =>
    globalThis.setInterval(callback, intervalMs) as unknown as TimerHandle,
  clearInterval: handle => globalThis.clearInterval(handle as unknown as HostTimer | undefined)
}

interface VirtualTimer {
  readonly callback: () => void
  /** Present for an interval: the period it is rescheduled by. */
  readonly intervalMs?: number
  due: number
  /** Scheduling order, the tie-breaker between timers due at the same time. */
  seq: number
}

function toDelay(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

function toInterval(ms: number): number {
  return Math.max(1, toDelay(ms))
}

function assertAdvanceMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`advance(ms) needs a finite, non-negative number of ms, got ${ms}`)
  }
}

/**
 * The timer queue both test clocks share. Linear scans: a test clock holds a
 * handful of timers, and the order rule stays easy to read.
 */
class VirtualTimers {
  private readonly timers = new Map<number, VirtualTimer>()
  private nextId = 1
  private nextSeq = 0

  add(callback: () => void, due: number, intervalMs?: number): TimerHandle {
    const id = this.nextId++
    this.timers.set(id, { callback, intervalMs, due, seq: this.nextSeq++ })
    return id as unknown as TimerHandle
  }

  remove(handle: TimerHandle | undefined): void {
    this.timers.delete(handle as unknown as number)
  }

  size(): number {
    return this.timers.size
  }

  /** The id of the timer that fires next, or `undefined` when none is scheduled. */
  private next(): number | undefined {
    let nextId: number | undefined
    let best: VirtualTimer | undefined
    for (const [id, timer] of this.timers) {
      if (
        best === undefined ||
        timer.due < best.due ||
        (timer.due === best.due && timer.seq < best.seq)
      ) {
        nextId = id
        best = timer
      }
    }
    return nextId
  }

  /** The due time of the timer that fires next. */
  nextDue(): number | undefined {
    const id = this.next()
    return id === undefined ? undefined : this.timers.get(id)?.due
  }

  /**
   * Fires the next timer if it is due at or before `limit`, after taking it off
   * the queue (a timeout) or moving it one period on (an interval), so a
   * callback that throws or clears it leaves the queue consistent. Returns the
   * due time of the timer it fired, or `undefined` when none was due.
   */
  fireNext(limit: number, beforeFire: (due: number) => void): number | undefined {
    const id = this.next()
    const timer = id === undefined ? undefined : this.timers.get(id)
    if (id === undefined || timer === undefined || timer.due > limit) return undefined
    const due = timer.due
    if (timer.intervalMs === undefined) {
      this.timers.delete(id)
    } else {
      timer.due += timer.intervalMs
      timer.seq = this.nextSeq++
    }
    beforeFire(due)
    timer.callback()
    return due
  }
}

/** Guards one clock's `advance` against re-entry and runaway rescheduling. */
function advanceGuard(): (run: (countFired: () => void) => void) => void {
  let advancing = false
  return run => {
    if (advancing)
      throw new Error('advance() was called from inside a timer callback of the same clock')
    advancing = true
    let fired = 0
    try {
      run(() => {
        fired += 1
        if (fired > MAX_TIMERS_PER_ADVANCE) {
          throw new Error(
            `advance() ran more than ${MAX_TIMERS_PER_ADVANCE} timer callbacks – a timer keeps rescheduling itself with no delay`
          )
        }
      })
    } finally {
      advancing = false
    }
  }
}

/**
 * A clock whose time moves only on `advance(ms)`. Inside a timer callback,
 * `now()` reads that timer's due time, so a callback sees the time it was
 * scheduled for.
 */
export function createManualClock(startMs = 0): TestClock {
  const timers = new VirtualTimers()
  const guard = advanceGuard()
  let current = startMs

  return {
    now: () => current,
    setTimeout: (callback, delayMs) => timers.add(callback, current + toDelay(delayMs)),
    clearTimeout: handle => timers.remove(handle),
    setInterval: (callback, intervalMs) => {
      const period = toInterval(intervalMs)
      return timers.add(callback, current + period, period)
    },
    clearInterval: handle => timers.remove(handle),
    advance: ms => {
      assertAdvanceMs(ms)
      const target = current + ms
      guard(countFired => {
        const enter = (due: number): void => {
          countFired()
          current = due
        }
        while (timers.fireNext(target, enter) !== undefined) {
          // fireNext ran one callback; loop until nothing is due by `target`.
        }
      })
      current = target
    },
    advancedMs: () => current - startMs,
    pendingTimers: () => timers.size()
  }
}

/**
 * A clock that reads `base.now()` plus an offset. Its timers fire on base time
 * as they fall due, and `advance(ms)` grows the offset and fires at once every
 * timer the jump made due. Inside a timer callback, `now()` reads the current
 * time, which may be later than the timer's due time.
 *
 * At most one base timer is armed at any time, for the earliest due timer.
 * `startOffsetMs` lets a relaunched app carry on from a time a test had
 * already moved to.
 */
export function createOffsetClock(base: Clock = realClock, startOffsetMs = 0): TestClock {
  const timers = new VirtualTimers()
  const guard = advanceGuard()
  let offset = startOffsetMs
  let advanced = 0
  let armed: TimerHandle | undefined

  const now = (): number => base.now() + offset

  const fireDue = (countFired: () => void): void => {
    while (timers.fireNext(now(), countFired) !== undefined) {
      // fireNext ran one callback; loop until nothing is due by now.
    }
  }

  const rearm = (): void => {
    base.clearTimeout(armed)
    armed = undefined
    const due = timers.nextDue()
    if (due === undefined) return
    armed = base.setTimeout(onBaseTimer, Math.max(0, due - now()))
  }

  function onBaseTimer(): void {
    armed = undefined
    try {
      guard(fireDue)
    } finally {
      rearm()
    }
  }

  const schedule = (handle: TimerHandle): TimerHandle => {
    rearm()
    return handle
  }
  const cancel = (handle: TimerHandle | undefined): void => {
    timers.remove(handle)
    rearm()
  }

  return {
    now,
    setTimeout: (callback, delayMs) => schedule(timers.add(callback, now() + toDelay(delayMs))),
    clearTimeout: cancel,
    setInterval: (callback, intervalMs) => {
      const period = toInterval(intervalMs)
      return schedule(timers.add(callback, now() + period, period))
    },
    clearInterval: cancel,
    advance: ms => {
      assertAdvanceMs(ms)
      offset += ms
      advanced += ms
      try {
        guard(fireDue)
      } finally {
        rearm()
      }
    },
    advancedMs: () => advanced,
    pendingTimers: () => timers.size()
  }
}

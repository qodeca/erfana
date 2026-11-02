// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The clock test hook (spec 025 solution design § 12, T1): it moves main's
 * clock, fires what fell due, and waits for every follower.
 */
import { describe, expect, it, vi } from 'vitest'
import { createManualClock, type Clock } from '../../shared/clock'
import { createClockTestHook, installClockTestHook } from './clockHook'

describe('createClockTestHook', () => {
  it('moves the clock, fires due timers and reports the total moved', async () => {
    const clock = createManualClock(1_000)
    const fired = vi.fn()
    clock.setTimeout(fired, 500)
    const hook = createClockTestHook(clock)

    await hook.advance(499)
    expect(fired).not.toHaveBeenCalled()
    await hook.advance(1)
    expect(fired).toHaveBeenCalledTimes(1)
    expect(hook.now()).toBe(1_500)
    expect(hook.advancedMs()).toBe(500)
  })

  it('resolves only after every follower has caught up, each told the new total', async () => {
    const seen: number[] = []
    let release: () => void = () => {}
    const slow = vi.fn(
      (total: number) =>
        new Promise<void>(resolve => {
          seen.push(total)
          release = resolve
        })
    )
    const fast = vi.fn(async (total: number) => {
      seen.push(total)
    })
    const hook = createClockTestHook(createManualClock(), [slow, fast])

    let settled = false
    const advancing = hook.advance(300).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(seen).toEqual([300, 300])
    expect(settled).toBe(false)
    release()
    await advancing
    expect(settled).toBe(true)
  })

  it('rejects, without telling followers, when the move is refused', async () => {
    const follower = vi.fn(async () => {})
    const hook = createClockTestHook(createManualClock(), [follower])
    await expect(hook.advance(-1)).rejects.toThrow(RangeError)
    expect(follower).not.toHaveBeenCalled()
  })
})

describe('installClockTestHook', () => {
  it('puts an offset clock over the base clock in force and drives it', async () => {
    const base = createManualClock(10_000)
    let installed: Clock | undefined
    const hook = installClockTestHook(base, clock => {
      installed = clock
    })
    expect(installed?.now()).toBe(10_000)

    const fired = vi.fn()
    installed?.setTimeout(fired, 500)
    await hook.advance(500)
    expect(fired).toHaveBeenCalledTimes(1)
    expect(installed?.now()).toBe(10_500)
    expect(hook.advancedMs()).toBe(500)
  })

  it('passes on a refused install', () => {
    expect(() =>
      installClockTestHook(createManualClock(), () => {
        throw new Error('too late')
      })
    ).toThrow('too late')
  })
})

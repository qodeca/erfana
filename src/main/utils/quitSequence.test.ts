// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { armLastResortExit, runQuitSequence, SHUTDOWN_LAST_RESORT_MS } from './quitSequence'

afterEach(() => {
  vi.useRealTimers()
})

describe('runQuitSequence', () => {
  it('runs the steps in order and exits once', async () => {
    const order: string[] = []
    const exit = vi.fn(() => order.push('exit'))
    await runQuitSequence(
      [() => void order.push('a'), async () => void order.push('b')],
      exit,
      vi.fn()
    )
    expect(order).toEqual(['a', 'b', 'exit'])
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('exits even when a step throws, reports it, and still runs the later steps', async () => {
    const exit = vi.fn()
    const onError = vi.fn()
    const later = vi.fn()
    const boom = new Error('boom')
    await runQuitSequence(
      [
        () => {
          throw boom
        },
        async () => {
          throw boom
        },
        later
      ],
      exit,
      onError
    )
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith(boom)
    expect(later).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })
})

describe('armLastResortExit', () => {
  it('exits when a step never settles', async () => {
    vi.useFakeTimers()
    const exit = vi.fn()
    armLastResortExit(exit)
    // a step that never settles: the sequence itself never reaches its exit
    void runQuitSequence([() => new Promise<void>(() => undefined)], vi.fn(), vi.fn())

    await vi.advanceTimersByTimeAsync(SHUTDOWN_LAST_RESORT_MS - 1)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('is not unref’d, so it keeps the process alive until the exit', () => {
    const unref = vi.fn()
    const fakeSetTimeout = vi.fn(() => ({ unref })) as unknown as typeof setTimeout
    armLastResortExit(vi.fn(), 10, fakeSetTimeout)
    expect(unref).not.toHaveBeenCalled()
  })
})

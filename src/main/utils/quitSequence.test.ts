// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { armLastResortExit, LAUNCHER_WAIT_MS, runQuitSequence, SHUTDOWN_LAST_RESORT_MS, waitBounded } from './quitSequence'

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

describe('waitBounded (quit-helper launcher, #305)', () => {
  it('returns as soon as the launcher has exited, with the time it took', async () => {
    vi.useFakeTimers({ now: 0 })
    let release: () => void = () => {}
    const launcher = new Promise<void>((resolve) => {
      release = resolve
    })
    const waited = waitBounded(launcher)
    await vi.advanceTimersByTimeAsync(400)
    release()
    await expect(waited).resolves.toEqual({ settled: true, waitedMs: 400 })
  })

  it('gives up after 3 s so a stuck launcher cannot hold up the quit', async () => {
    vi.useFakeTimers({ now: 0 })
    expect(LAUNCHER_WAIT_MS).toBe(3_000)
    const waited = waitBounded(new Promise<void>(() => {}))
    await vi.advanceTimersByTimeAsync(LAUNCHER_WAIT_MS)
    await expect(waited).resolves.toEqual({ settled: false, waitedMs: LAUNCHER_WAIT_MS })
  })

  it('treats a rejected wait as settled and never rejects', async () => {
    await expect(waitBounded(Promise.reject(new Error('boom')), 10)).resolves.toMatchObject({ settled: true })
  })

  it('fits inside the last-resort exit with the lock (1 s) and disposer (2 s) bounds', () => {
    expect(1_000 + 2_000 + LAUNCHER_WAIT_MS).toBeLessThan(SHUTDOWN_LAST_RESORT_MS)
  })
})

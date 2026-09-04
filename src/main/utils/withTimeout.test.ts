// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `withTimeout` had no direct tests while it lived inside
 * `ImageRasterizeWindow` (only `open()` exercised it). Now that the preview's
 * approval path leans on it too, its three promises are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TimeoutError, withTimeout } from './withTimeout'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('passes a value through when the promise settles before the deadline', async () => {
    const result = withTimeout(Promise.resolve(42), 1000, 'Fast thing')
    await expect(result).resolves.toBe(42)
  })

  it('passes a rejection through, as the original error', async () => {
    const result = withTimeout(Promise.reject(new Error('boom')), 1000, 'Failing thing')
    await expect(result).rejects.toThrow('boom')
  })

  it('rejects with a TimeoutError naming the operation when the timer wins', async () => {
    const never = new Promise<void>(() => {})
    const result = withTimeout(never, 250, 'Slow thing')
    const outcome = result.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(251)

    const error = await outcome
    expect(error).toBeInstanceOf(TimeoutError)
    expect((error as Error).message).toBe('Slow thing timed out after 250ms')
  })

  it('clears its timer once the promise settles, so nothing keeps the process alive', async () => {
    await withTimeout(Promise.resolve('done'), 5000, 'Quick')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no unhandled rejection when the loser rejects after the timeout', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      let rejectLate: (e: Error) => void = () => undefined
      const late = new Promise<void>((_r, reject) => {
        rejectLate = reject
      })
      const outcome = withTimeout(late, 100, 'Late').catch(() => 'timed out')
      await vi.advanceTimersByTimeAsync(101)
      expect(await outcome).toBe('timed out')

      rejectLate(new Error('too late'))
      // Fake timers own setImmediate too; a few macrotask turns are enough for
      // an unhandled rejection to be reported.
      await vi.advanceTimersByTimeAsync(10)

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

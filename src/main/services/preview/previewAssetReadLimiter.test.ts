// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Asset-read limiter tests (sd-074b §4.7).
 *
 * The limiter became process-wide, so one preview can no longer multiply the
 * bound by opening more tabs — and it gained a bounded queue, so a page that
 * asks for hundreds of assets sheds rather than parking every other preview's
 * reads forever.
 */
import { describe, expect, it } from 'vitest'
import { createConcurrencyLimiter } from './PreviewProtocolHandler'

describe('asset-read limiter', () => {
  it('admits up to `max` reads immediately', async () => {
    const limiter = createConcurrencyLimiter(2, 4)
    expect(await limiter.acquire()).toBe(true)
    expect(await limiter.acquire()).toBe(true)
  })

  it('queues the next read and hands it the slot on release', async () => {
    const limiter = createConcurrencyLimiter(1, 4)
    await limiter.acquire()

    let admitted = false
    const queued = limiter.acquire().then((ok) => {
      admitted = ok
    })
    expect(admitted).toBe(false)

    limiter.release()
    await queued

    expect(admitted).toBe(true)
  })

  it('sheds once the wait queue is full instead of queueing without bound', async () => {
    const limiter = createConcurrencyLimiter(1, 2)
    await limiter.acquire()

    // Two waiters fill the queue; neither settles yet.
    void limiter.acquire()
    void limiter.acquire()

    // The third would be unbounded growth, so it is refused.
    expect(await limiter.acquire()).toBe(false)
  })

  it('accepts new waiters again once the queue drains', async () => {
    const limiter = createConcurrencyLimiter(1, 1)
    await limiter.acquire()
    const queued = limiter.acquire()
    expect(await limiter.acquire()).toBe(false)

    limiter.release()
    await queued

    // The queue is empty again, so a further waiter is accepted.
    let accepted: boolean | null = null
    void limiter.acquire().then((ok) => {
      accepted = ok
    })
    limiter.release()
    await Promise.resolve()
    await Promise.resolve()
    expect(accepted).toBe(true)
  })

  it('never exceeds `max` active reads', async () => {
    const limiter = createConcurrencyLimiter(2, 8)
    let active = 0
    let peak = 0

    const run = async (): Promise<void> => {
      if (!(await limiter.acquire())) return
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      limiter.release()
    }

    await Promise.all(Array.from({ length: 8 }, run))

    expect(peak).toBeLessThanOrEqual(2)
  })
})

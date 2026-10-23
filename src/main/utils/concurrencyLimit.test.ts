// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { createConcurrencyLimit } from './concurrencyLimit'

/** A task that stays pending until its `finish` is called. */
function deferredTask<T>(value: T) {
  let finish!: () => void
  let fail!: (error: Error) => void
  let started = false
  const done = new Promise<T>((resolve, reject) => {
    finish = () => resolve(value)
    fail = reject
  })
  return {
    task: () => {
      started = true
      return done
    },
    finish: () => finish(),
    fail: (error: Error) => fail(error),
    get started() {
      return started
    }
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createConcurrencyLimit', () => {
  it('keeps at most `max` tasks in flight and starts the rest in order', async () => {
    const limit = createConcurrencyLimit(2)
    const tasks = [deferredTask(1), deferredTask(2), deferredTask(3), deferredTask(4)]
    const results = tasks.map((t) => limit.run(t.task))
    await flush()
    expect(tasks.map((t) => t.started)).toEqual([true, true, false, false])

    tasks[1].finish()
    await flush()
    expect(tasks.map((t) => t.started)).toEqual([true, true, true, false])

    tasks[0].finish()
    tasks[2].finish()
    await flush()
    expect(tasks[3].started).toBe(true)
    tasks[3].finish()
    await expect(Promise.all(results)).resolves.toEqual([1, 2, 3, 4])
  })

  it('frees the slot of a task that fails', async () => {
    const limit = createConcurrencyLimit(1)
    const first = deferredTask(0)
    const second = deferredTask(2)
    const failed = limit.run(first.task)
    const next = limit.run(second.task)
    first.fail(new Error('EACCES'))
    await expect(failed).rejects.toThrow('EACCES')
    await flush()
    expect(second.started).toBe(true)
    second.finish()
    await expect(next).resolves.toBe(2)
  })

  it('keeps the order across queue compactions', async () => {
    const limit = createConcurrencyLimit(1)
    const order: number[] = []
    await Promise.all(Array.from({ length: 5000 }, (_, i) => limit.run(async () => order.push(i))))
    expect(order).toEqual(Array.from({ length: 5000 }, (_, i) => i))
  })

  it('takes a queued task in O(1): a 200,000-deep queue drains without stalling (review of #320)', async () => {
    // With `Array.prototype.shift` this drain is quadratic: ~15 s here, and a
    // walk of 65k queued folders stalled the main process for ~2 s
    const limit = createConcurrencyLimit(16)
    const start = performance.now()
    await Promise.all(Array.from({ length: 200_000 }, () => limit.run(async () => null)))
    expect(performance.now() - start).toBeLessThan(2_000)
  }, 60_000)

  it.each([0, -1, 1.5, Number.NaN])('refuses a limit of %s', (max) => {
    expect(() => createConcurrencyLimit(max)).toThrow('Invalid concurrency limit')
  })
})

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

  it.each([0, -1, 1.5, Number.NaN])('refuses a limit of %s', (max) => {
    expect(() => createConcurrencyLimit(max)).toThrow('Invalid concurrency limit')
  })
})

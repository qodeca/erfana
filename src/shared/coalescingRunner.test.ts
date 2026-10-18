// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the shared single-flight runner (issue #208).
 *
 * Every transition of the state machine is pinned here: main's per-path
 * `readDirectory` and the renderer's `refreshFiles` both rely on it, and a
 * settle-ordering mistake would let two full-tree reads overlap again. The
 * tests drive the runner with deferred promises and microtask flushing only –
 * no timers, no wall-clock waits. Runs in the main (node) vitest project.
 *
 * @see coalescingRunner.ts
 */
import { describe, expect, it, vi } from 'vitest'

import { createCoalescingRunner, type CoalescedRunInfo } from './coalescingRunner'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** Drain queued promise reactions; the runner hands off in a few hops. */
async function flushMicrotasks(ticks = 10): Promise<void> {
  for (let tick = 0; tick < ticks; tick++) {
    await Promise.resolve()
  }
}

/**
 * A task factory that records every invocation and tracks how many tasks are
 * running at once. Each invocation gets its own deferred, settled by the test.
 */
function trackedTasks<T>() {
  const runs: Array<{ info: CoalescedRunInfo; gate: Deferred<T>; label: string }> = []
  let active = 0
  let maxActive = 0
  const task = (label = 'task') => (info: CoalescedRunInfo): Promise<T> => {
    const gate = deferred<T>()
    runs.push({ info, gate, label })
    active++
    maxActive = Math.max(maxActive, active)
    return gate.promise.finally(() => {
      active--
    })
  }
  return {
    runs,
    task,
    get active(): number {
      return active
    },
    get maxActive(): number {
      return maxActive
    }
  }
}

describe('createCoalescingRunner', () => {
  it('runs a task at once when idle and resolves with its value', async () => {
    const runner = createCoalescingRunner<string>()
    const tasks = trackedTasks<string>()

    const result = runner.run(tasks.task())

    expect(tasks.runs).toHaveLength(1)
    expect(tasks.runs[0].info).toEqual({ followUp: false, callers: 1 })
    tasks.runs[0].gate.resolve('tree-1')
    await expect(result).resolves.toBe('tree-1')
  })

  it('queues mid-flight calls into one trailing run that starts after the first settles', async () => {
    const runner = createCoalescingRunner<string>()
    const tasks = trackedTasks<string>()

    const first = runner.run(tasks.task())
    const second = runner.run(tasks.task())
    const third = runner.run(tasks.task())

    // Mid-flight calls never start a task and never join the running one.
    expect(tasks.runs).toHaveLength(1)
    expect(second).toBe(third)
    expect(second).not.toBe(first)

    tasks.runs[0].gate.resolve('first')
    await expect(first).resolves.toBe('first')

    expect(tasks.runs).toHaveLength(2)
    expect(tasks.runs[1].info).toEqual({ followUp: true, callers: 2 })

    tasks.runs[1].gate.resolve('follow-up')
    await expect(second).resolves.toBe('follow-up')
    await expect(third).resolves.toBe('follow-up')
  })

  it('runs the task passed by the most recent joiner as the trailing run', async () => {
    const runner = createCoalescingRunner<string>()
    const tasks = trackedTasks<string>()

    const first = runner.run(tasks.task('leading'))
    void runner.run(tasks.task('stale'))
    const latest = runner.run(tasks.task('latest'))

    tasks.runs[0].gate.resolve('a')
    await first
    expect(tasks.runs.map((run) => run.label)).toEqual(['leading', 'latest'])
    tasks.runs[1].gate.resolve('b')
    await expect(latest).resolves.toBe('b')
  })

  it('never runs two tasks at once and costs exactly two runs for a burst', async () => {
    const runner = createCoalescingRunner<number>()
    const tasks = trackedTasks<number>()
    const BURST = 10

    const promises = Array.from({ length: BURST }, () => runner.run(tasks.task()))
    tasks.runs[0].gate.resolve(1)
    await flushMicrotasks()
    expect(tasks.runs).toHaveLength(2)
    expect(tasks.runs[1].info).toEqual({ followUp: true, callers: BURST - 1 })

    tasks.runs[1].gate.resolve(2)
    const results = await Promise.all(promises)

    expect(results).toEqual([1, ...Array.from({ length: BURST - 1 }, () => 2)])
    expect(tasks.runs).toHaveLength(2)
    expect(tasks.maxActive).toBe(1)
  })

  it('queues a third run back to back when a call arrives during the trailing run', async () => {
    const runner = createCoalescingRunner<string>()
    const tasks = trackedTasks<string>()

    void runner.run(tasks.task())
    const second = runner.run(tasks.task())
    tasks.runs[0].gate.resolve('1')
    await flushMicrotasks()
    expect(tasks.runs).toHaveLength(2)

    const third = runner.run(tasks.task())
    expect(tasks.runs).toHaveLength(2)

    tasks.runs[1].gate.resolve('2')
    await expect(second).resolves.toBe('2')
    expect(tasks.runs).toHaveLength(3)
    expect(tasks.runs[2].info).toEqual({ followUp: true, callers: 1 })

    tasks.runs[2].gate.resolve('3')
    await expect(third).resolves.toBe('3')
    expect(tasks.maxActive).toBe(1)
  })

  it('has the trailing run started by the time the leading caller resumes', async () => {
    const runner = createCoalescingRunner<string>()
    const tasks = trackedTasks<string>()

    const first = runner.run(tasks.task())
    void runner.run(tasks.task())
    tasks.runs[0].gate.resolve('first')

    await first
    // No extra flushing: the settle bookkeeping ran ahead of this continuation.
    expect(tasks.runs).toHaveLength(2)
  })

  it('queues a synchronously re-entrant call instead of starting it alongside', async () => {
    const runner = createCoalescingRunner<string>()
    let active = 0
    let maxActive = 0
    const gates: Array<Deferred<string>> = []
    let inner: Promise<string> | null = null

    const plainTask = (): Promise<string> => {
      const gate = deferred<string>()
      gates.push(gate)
      active++
      maxActive = Math.max(maxActive, active)
      return gate.promise.finally(() => {
        active--
      })
    }
    const reentrantTask = (): Promise<string> => {
      // Calls run() before returning its own promise.
      inner = runner.run(plainTask)
      return plainTask()
    }

    const outer = runner.run(reentrantTask)

    expect(gates).toHaveLength(1)
    expect(active).toBe(1)

    gates[0].resolve('outer')
    await expect(outer).resolves.toBe('outer')
    expect(gates).toHaveLength(2)

    gates[1].resolve('inner')
    await expect(inner).resolves.toBe('inner')
    expect(maxActive).toBe(1)
  })

  it('rejects only the leading caller when the leading run fails; the trailing run still runs', async () => {
    const runner = createCoalescingRunner<string>()
    const tasks = trackedTasks<string>()

    const first = runner.run(tasks.task())
    const joinerA = runner.run(tasks.task())
    const joinerB = runner.run(tasks.task())
    const failure = new Error('root readdir failed')

    tasks.runs[0].gate.reject(failure)
    await expect(first).rejects.toBe(failure)

    expect(tasks.runs).toHaveLength(2)
    tasks.runs[1].gate.resolve('recovered')
    await expect(joinerA).resolves.toBe('recovered')
    await expect(joinerB).resolves.toBe('recovered')
  })

  it('rejects every joiner when the trailing run fails', async () => {
    const runner = createCoalescingRunner<string>()
    const tasks = trackedTasks<string>()

    const first = runner.run(tasks.task())
    const joinerA = runner.run(tasks.task())
    const joinerB = runner.run(tasks.task())
    const failure = new Error('follow-up failed')

    tasks.runs[0].gate.resolve('ok')
    await expect(first).resolves.toBe('ok')
    tasks.runs[1].gate.reject(failure)

    await expect(joinerA).rejects.toBe(failure)
    await expect(joinerB).rejects.toBe(failure)
  })

  it('rejects a synchronously throwing task and returns to idle', async () => {
    const onIdle = vi.fn()
    const runner = createCoalescingRunner<string>({ onIdle })
    const failure = new Error('sync throw')

    const thrown = runner.run(() => {
      throw failure
    })
    await expect(thrown).rejects.toBe(failure)
    expect(onIdle).toHaveBeenCalledTimes(1)

    // Idle again: the next call runs at once as a leading run.
    const tasks = trackedTasks<string>()
    const next = runner.run(tasks.task())
    expect(tasks.runs).toHaveLength(1)
    expect(tasks.runs[0].info).toEqual({ followUp: false, callers: 1 })
    tasks.runs[0].gate.resolve('fresh')
    await expect(next).resolves.toBe('fresh')
  })

  it('calls onIdle once after the last run, not between the leading and trailing runs', async () => {
    const onIdle = vi.fn()
    const runner = createCoalescingRunner<string>({ onIdle })
    const tasks = trackedTasks<string>()

    const first = runner.run(tasks.task())
    const second = runner.run(tasks.task())

    tasks.runs[0].gate.resolve('1')
    await first
    await flushMicrotasks()
    expect(onIdle).not.toHaveBeenCalled()

    tasks.runs[1].gate.resolve('2')
    await second
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('works without options', async () => {
    const runner = createCoalescingRunner<number>()
    await expect(runner.run(async () => 1)).resolves.toBe(1)
    await expect(runner.run(async () => 2)).resolves.toBe(2)
  })
})

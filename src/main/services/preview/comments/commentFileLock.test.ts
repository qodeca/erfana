// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-path comment write lock (docs/designs/html-preview-comments.md §7.6;
 * M-012 at the lock level, M-063 key separation).
 */
import { describe, it, expect } from 'vitest'
import { KeyedAsyncLock } from './commentFileLock'

/** A promise and the function that settles it. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>(resolve => {
    open = resolve
  })
  return { promise, open }
}

/** Let every queued microtask and the next macrotask run. */
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('KeyedAsyncLock', () => {
  it('M-012 runs tasks for one key one at a time, in arrival order', async () => {
    const lock = new KeyedAsyncLock()
    const events: string[] = []
    const first = gate()

    const a = lock.run('k', async () => {
      events.push('a start')
      await first.promise
      events.push('a end')
      return 'a'
    })
    const b = lock.run('k', async () => {
      events.push('b start')
      return 'b'
    })
    await settle()

    expect(events).toEqual(['a start'])
    expect(lock.queued('k')).toBe(2)
    first.open()
    expect(await Promise.all([a, b])).toEqual(['a', 'b'])
    expect(events).toEqual(['a start', 'a end', 'b start'])
    expect(lock.queued('k')).toBe(0)
  })

  it('M-063 keys are compared exactly: Index.html and index.html never wait for each other', async () => {
    const lock = new KeyedAsyncLock()
    const held = gate()
    const events: string[] = []

    const upper = lock.run('/p/Index.html', async () => {
      events.push('Index.html')
      await held.promise
    })
    const lower = lock.run('/p/index.html', async () => {
      events.push('index.html')
    })
    await lower

    expect(events).toEqual(['Index.html', 'index.html'])
    expect(lock.queued('/p/Index.html')).toBe(1)
    expect(lock.queued('/p/index.html')).toBe(0)
    held.open()
    await upper
  })

  it('a task that throws releases the lock for the next one and rejects its own caller', async () => {
    const lock = new KeyedAsyncLock()

    const failing = lock.run('k', async () => {
      throw new Error('boom')
    })
    const next = lock.run('k', async () => 'next')

    await expect(failing).rejects.toThrow('boom')
    expect(await next).toBe('next')
    expect(lock.queued('k')).toBe(0)
  })

  it('a key freed and taken again starts at once', async () => {
    const lock = new KeyedAsyncLock()

    expect(await lock.run('k', async () => 1)).toBe(1)
    expect(await lock.run('k', async () => 2)).toBe(2)
    expect(lock.queued('k')).toBe(0)
  })
})

describe('KeyedAsyncLock.runAll (security review F6: real path + dev:ino)', () => {
  it('M-012 a task holding two keys makes a later task on either key wait, and joins both queues at once', async () => {
    const lock = new KeyedAsyncLock()
    const held = gate()
    const events: string[] = []

    const both = lock.runAll(['/p/a.html', '7:42'], async () => {
      events.push('both')
      await held.promise
    })
    const byPath = lock.runAll(['/p/a.html', '7:43'], async () => {
      events.push('path')
    })
    const byId = lock.runAll(['/q/b.html', '7:42'], async () => {
      events.push('id')
    })
    await settle()

    expect(events).toEqual(['both'])
    expect([lock.queued('/p/a.html'), lock.queued('7:42')]).toEqual([2, 2])
    held.open()
    await Promise.all([both, byPath, byId])
    expect(events).toEqual(['both', 'path', 'id'])
    expect([lock.queued('/p/a.html'), lock.queued('7:42'), lock.queued('7:43')]).toEqual([0, 0, 0])
  })

  it('two tasks naming the same keys in opposite order never deadlock: the first to arrive runs first', async () => {
    const lock = new KeyedAsyncLock()
    const held = gate()
    const events: string[] = []

    const first = lock.runAll(['b', 'a'], async () => {
      events.push('first')
      await held.promise
    })
    const second = lock.runAll(['a', 'b'], async () => {
      events.push('second')
    })
    await settle()
    held.open()
    await Promise.all([first, second])

    expect(events).toEqual(['first', 'second'])
  })

  it('a repeated key counts once, and a throwing task frees every key it held', async () => {
    const lock = new KeyedAsyncLock()

    const failing = lock.runAll(['k', 'k', 'j'], async () => {
      expect(lock.queued('k')).toBe(1)
      throw new Error('boom')
    })

    await expect(failing).rejects.toThrow('boom')
    expect([lock.queued('k'), lock.queued('j')]).toEqual([0, 0])
    expect(await lock.runAll(['j', 'k'], async () => 'free')).toBe('free')
  })
})

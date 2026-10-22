// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LinkTargetCache: remembers `file.exists` answers until the file structure
 * may have changed.
 *
 * @module linkTargetCache.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LinkTargetCache, isStructuralChange } from './linkTargetCache'
import { notifyFileStructureChanged } from '../../services/fileStructureSignal'

let exists: ReturnType<typeof vi.fn>

beforeEach(() => {
  exists = vi.fn().mockResolvedValue(true)
  ;(window as unknown as { api: unknown }).api = { file: { exists } }
})

/** Let queued microtasks (the coalesced notification) run. */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('isStructuralChange', () => {
  it.each([
    [{ summary: { change: 2 } }, false],
    [{ summary: { add: 1 } }, true],
    [{ summary: { change: 1, unlinkDir: 1 } }, true],
    [{ summary: { add: 0, change: 1 } }, false],
    [{ summary: {}, catchUp: true }, true],
    [{}, true]
  ])('%j → %s', (change, expected) => {
    expect(isStructuralChange(change)).toBe(expected)
  })
})

describe('LinkTargetCache', () => {
  it('asks once per path, sharing an answer still in flight', async () => {
    const cache = new LinkTargetCache()
    const [a, b] = await Promise.all([cache.exists('/p/a.md'), cache.exists('/p/a.md')])
    await cache.exists('/p/a.md')
    expect([a, b]).toEqual([true, true])
    expect(exists).toHaveBeenCalledTimes(1)
  })

  it('does not remember a failed check', async () => {
    exists.mockRejectedValueOnce(new Error('ipc down'))
    const cache = new LinkTargetCache()
    await expect(cache.exists('/p/a.md')).rejects.toThrow('ipc down')
    await expect(cache.exists('/p/a.md')).resolves.toBe(true)
    expect(exists).toHaveBeenCalledTimes(2)
  })

  it('forgets everything on invalidate and bumps the generation', async () => {
    const cache = new LinkTargetCache()
    await cache.exists('/p/a.md')
    const before = cache.generation
    cache.invalidate()
    expect(cache.generation).toBe(before + 1)
    await cache.exists('/p/a.md')
    expect(exists).toHaveBeenCalledTimes(2)
  })

  it('sweep keeps only the paths asked about since the previous sweep', async () => {
    const cache = new LinkTargetCache()
    await cache.exists('/p/a.md')
    await cache.exists('/p/b.md')
    cache.sweep()
    await cache.exists('/p/b.md')
    cache.sweep()
    expect(cache.size).toBe(1)
  })

  it('notifies listeners once per burst, and only while subscribed', async () => {
    const cache = new LinkTargetCache()
    const listener = vi.fn()
    const unsubscribe = cache.subscribe(listener)
    cache.invalidate()
    cache.invalidate()
    await flushMicrotasks()
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    notifyFileStructureChanged()
    await flushMicrotasks()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("invalidates on this window's own file operations once subscribed", async () => {
    const cache = new LinkTargetCache()
    const unsubscribe = cache.subscribe(() => {})
    const before = cache.generation
    notifyFileStructureChanged()
    expect(cache.generation).toBe(before + 1)
    unsubscribe()
  })
})

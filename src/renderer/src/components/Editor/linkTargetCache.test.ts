// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LinkTargetCache: remembers `file.exists` answers until the file structure
 * may have changed or they expire, and asks its listeners to re-check once
 * per burst, only while visible.
 *
 * @module linkTargetCache.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LinkTargetCache,
  isStructuralChange,
  LINK_TARGET_MAX_WAIT_MS,
  LINK_TARGET_SETTLE_MS,
  LINK_TARGET_TTL_MS,
  type DirectoryChange
} from './linkTargetCache'
import { notifyFileStructureChanged } from '../../services/fileStructureSignal'

let exists: ReturnType<typeof vi.fn>
let directoryListeners: Array<(change: DirectoryChange) => void>

beforeEach(() => {
  vi.useFakeTimers()
  exists = vi.fn().mockResolvedValue(true)
  directoryListeners = []
  ;(window as unknown as { api: unknown }).api = {
    file: { exists },
    directoryWatch: {
      onDirectoryChanged: (listener: (change: DirectoryChange) => void) => {
        directoryListeners.push(listener)
        return () => {
          directoryListeners = directoryListeners.filter((l) => l !== listener)
        }
      }
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
})

/** A subscribed cache and a counter of re-check requests. */
function subscribed() {
  const cache = new LinkTargetCache()
  const listener = vi.fn()
  const unsubscribe = cache.subscribe(listener)
  return { cache, listener, unsubscribe }
}

describe('isStructuralChange', () => {
  it.each<[DirectoryChange, boolean]>([
    [{ summary: { change: 2 } }, false],
    [{ summary: { add: 1 } }, true],
    [{ summary: { change: 1, unlinkDir: 1 } }, true],
    [{ summary: { add: 0, change: 1 } }, false],
    [{ summary: {}, catchUp: true }, true],
    [{}, true],
    // An explicit flag wins over the summary …
    [{ structural: false, summary: { add: 1 } }, false],
    [{ structural: true, summary: { change: 1 } }, true],
    // … but a catch-up always counts
    [{ structural: false, catchUp: true }, true]
  ])('%j → %s', (change, expected) => {
    expect(isStructuralChange(change)).toBe(expected)
  })
})

describe('LinkTargetCache – answers', () => {
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

  it('a check failing after invalidate() leaves the newer answer in place', async () => {
    let failOld!: (e: Error) => void
    exists.mockImplementationOnce(() => new Promise<boolean>((_, reject) => (failOld = reject)))
    const cache = new LinkTargetCache()
    const old = cache.exists('/p/a.md')
    cache.invalidate()
    await cache.exists('/p/a.md') // the newer answer, remembered
    failOld(new Error('late failure'))
    await expect(old).rejects.toThrow('late failure')

    await cache.exists('/p/a.md')
    expect(exists).toHaveBeenCalledTimes(2)
    expect(cache.size).toBe(1)
  })

  it('forgets everything on invalidate and bumps the generation at once', async () => {
    const cache = new LinkTargetCache()
    await cache.exists('/p/a.md')
    const before = cache.generation
    cache.invalidate()
    expect(cache.generation).toBe(before + 1)
    await cache.exists('/p/a.md')
    expect(exists).toHaveBeenCalledTimes(2)
  })

  it('asks again once an answer is older than the age limit', async () => {
    const cache = new LinkTargetCache()
    await cache.exists('/p/a.md')
    vi.advanceTimersByTime(LINK_TARGET_TTL_MS - 1)
    await cache.exists('/p/a.md')
    expect(exists).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
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
})

describe('LinkTargetCache – re-check requests', () => {
  it('waits for a burst to settle, and tells the listeners once', () => {
    const { cache, listener } = subscribed()
    const version = cache.getVersion()
    cache.invalidate()
    vi.advanceTimersByTime(LINK_TARGET_SETTLE_MS - 1)
    cache.invalidate()
    vi.advanceTimersByTime(LINK_TARGET_SETTLE_MS - 1)
    expect(listener).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(cache.getVersion()).toBe(version + 1)
  })

  it('does not postpone the re-check past the max wait during continuous churn', () => {
    const { cache, listener } = subscribed()
    for (let t = 0; t < LINK_TARGET_MAX_WAIT_MS; t += 100) {
      cache.invalidate()
      vi.advanceTimersByTime(100)
    }
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('hidden: holds every request, then asks once when shown', () => {
    const { cache, listener } = subscribed()
    cache.setVisible(false)
    cache.invalidate()
    cache.invalidate()
    vi.advanceTimersByTime(LINK_TARGET_MAX_WAIT_MS)
    expect(listener).not.toHaveBeenCalled()

    cache.setVisible(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('shown again with nothing new: no re-check', async () => {
    const { cache, listener } = subscribed()
    await cache.exists('/p/a.md')
    cache.setVisible(false)
    cache.setVisible(true)
    expect(listener).not.toHaveBeenCalled()
  })

  it('shown again after an answer expired: drops it and re-checks', async () => {
    const { cache, listener } = subscribed()
    await cache.exists('/p/a.md')
    cache.setVisible(false)
    vi.advanceTimersByTime(LINK_TARGET_TTL_MS)
    cache.setVisible(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(0)
  })

  it('a "missing" answer asks for a re-check when it expires', async () => {
    exists.mockResolvedValue(false)
    const { cache, listener } = subscribed()
    await cache.exists('/p/a.md')
    await vi.advanceTimersByTimeAsync(LINK_TARGET_TTL_MS + LINK_TARGET_SETTLE_MS)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a found answer does not schedule a re-check of its own', async () => {
    const { cache, listener } = subscribed()
    await cache.exists('/p/a.md')
    await vi.advanceTimersByTimeAsync(2 * LINK_TARGET_TTL_MS)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('LinkTargetCache – connection', () => {
  it('invalidates on structural watcher events and on catch-ups, not on content changes', () => {
    const { cache } = subscribed()
    const start = cache.generation
    directoryListeners.forEach((l) => l({ summary: { change: 4 } }))
    expect(cache.generation).toBe(start)
    directoryListeners.forEach((l) => l({ summary: { add: 1 } }))
    directoryListeners.forEach((l) => l({ summary: {}, catchUp: true }))
    directoryListeners.forEach((l) => l({ eventCount: 2 }))
    expect(cache.generation).toBe(start + 3)
  })

  it("invalidates on this window's own file operations once subscribed", () => {
    const { cache, unsubscribe } = subscribed()
    const before = cache.generation
    notifyFileStructureChanged()
    expect(cache.generation).toBe(before + 1)
    unsubscribe()
  })

  it('the last unsubscribe stops listening, cancels pending work and forgets the answers', async () => {
    const { cache, listener, unsubscribe } = subscribed()
    await cache.exists('/p/a.md')
    cache.invalidate()
    await cache.exists('/p/a.md')
    unsubscribe()

    expect(directoryListeners).toHaveLength(0)
    expect(cache.size).toBe(0)
    const generation = cache.generation
    notifyFileStructureChanged()
    expect(cache.generation).toBe(generation)
    vi.advanceTimersByTime(LINK_TARGET_MAX_WAIT_MS)
    expect(listener).not.toHaveBeenCalled()
  })
})

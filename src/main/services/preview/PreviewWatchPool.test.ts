// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the preview watch pool (Issue #74, work item 30).
 *
 * A fake watcher factory stands in for `createSingleFileWatcher`, so the pool's
 * refcounting, per-preview cap and awaited teardown are pinned without chokidar
 * or a real filesystem. One test asserts the preview `awaitWriteFinish`
 * overrides (`stabilityThreshold: 50`) reach the factory.
 */
import { describe, it, expect, vi, type Mock } from 'vitest'
import type { FSWatcher, ChokidarOptions } from 'chokidar'
import {
  createPreviewWatchPool,
  WATCH_CATCH_UP_SLACK_MS,
  type WatchFactory
} from './PreviewWatchPool'
import { createPreviewWatchBudget } from './previewWatchBudget'
import { PREVIEW } from '../../../shared/constants'

interface FakeWatcher {
  path: string
  handlers: {
    onChange: () => void
    onUnlink: () => void
    onError: (e: unknown) => void
    onReady?: () => void
  }
  overrides?: Partial<ChokidarOptions>
  close: Mock
  closed: boolean
}

function makeHarness(closeImpl?: (w: FakeWatcher) => Promise<void>): {
  factory: WatchFactory
  created: FakeWatcher[]
} {
  const created: FakeWatcher[] = []
  const factory: WatchFactory = (path, handlers, overrides) => {
    const watcher: FakeWatcher = {
      path,
      handlers,
      overrides,
      closed: false,
      close: vi.fn(async () => {
        watcher.closed = true
        if (closeImpl) await closeImpl(watcher)
      })
    }
    created.push(watcher)
    return watcher as unknown as FSWatcher
  }
  return { factory, created }
}

describe('createPreviewWatchPool', () => {
  it('passes the preview awaitWriteFinish overrides to the factory', () => {
    const { factory, created } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory })

    pool.acquire('/proj/style.css', () => {})

    expect(created).toHaveLength(1)
    expect(created[0].overrides?.awaitWriteFinish).toEqual({
      stabilityThreshold: PREVIEW.WATCH_STABILITY_MS,
      pollInterval: PREVIEW.WATCH_POLL_INTERVAL_MS
    })
    expect(PREVIEW.WATCH_STABILITY_MS).toBe(50)
  })

  it('creates one watcher per distinct path', () => {
    const { factory, created } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory })

    pool.acquire('/proj/a.css', () => {})
    pool.acquire('/proj/b.css', () => {})

    expect(created).toHaveLength(2)
    expect(pool.size).toBe(2)
  })

  it('refcounts a re-acquired path instead of creating a second watcher', async () => {
    const { factory, created } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory })

    expect(pool.acquire('/proj/a.css', () => {})).toBe(true)
    expect(pool.acquire('/proj/a.css', () => {})).toBe(true)
    expect(created).toHaveLength(1)
    expect(pool.size).toBe(1)

    // First release only decrements; the watcher stays open.
    await pool.release('/proj/a.css')
    expect(created[0].closed).toBe(false)
    expect(pool.size).toBe(1)

    // Second release drops the count to zero and closes it.
    await pool.release('/proj/a.css')
    expect(created[0].close).toHaveBeenCalledTimes(1)
    expect(pool.size).toBe(0)
  })

  it('fires onChange on a change (unlink re-arms via the adapter, tested separately)', () => {
    const { factory, created } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory })
    const onChange = vi.fn()

    pool.acquire('/proj/a.css', onChange)
    // A change fires the reload signal synchronously. An unlink now flows through
    // the re-arming adapter's atomic-save detector (covered in
    // rearmingSingleFileWatch.test.ts), not a synchronous fire here.
    created[0].handlers.onChange()

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps the original handler across a refcount bump', () => {
    const { factory, created } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory })
    const first = vi.fn()
    const second = vi.fn()

    pool.acquire('/proj/a.css', first)
    pool.acquire('/proj/a.css', second)
    created[0].handlers.onChange()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('caps new watches at MAX_WATCHED_FILES and refuses the overflow', () => {
    const { factory, created } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory })

    for (let i = 0; i < PREVIEW.MAX_WATCHED_FILES; i++) {
      expect(pool.acquire(`/proj/file-${i}.css`, () => {})).toBe(true)
    }
    expect(pool.size).toBe(PREVIEW.MAX_WATCHED_FILES)

    // The 17th distinct path is refused and watches nothing.
    expect(pool.acquire('/proj/overflow.css', () => {})).toBe(false)
    expect(created).toHaveLength(PREVIEW.MAX_WATCHED_FILES)
    expect(pool.size).toBe(PREVIEW.MAX_WATCHED_FILES)
  })

  it('honours an injected smaller cap', () => {
    const { factory } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory, maxWatched: 2 })

    expect(pool.acquire('/a', () => {})).toBe(true)
    expect(pool.acquire('/b', () => {})).toBe(true)
    expect(pool.acquire('/c', () => {})).toBe(false)
  })

  it('re-acquires an existing path even at the cap (no new descriptor)', () => {
    const { factory } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory, maxWatched: 1 })

    expect(pool.acquire('/a', () => {})).toBe(true)
    // Cap reached, but re-acquiring the SAME path just bumps the refcount.
    expect(pool.acquire('/a', () => {})).toBe(true)
    expect(pool.size).toBe(1)
  })

  it('releaseAll awaits every close before resolving', async () => {
    let settled = 0
    const { factory, created } = makeHarness(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            settled += 1
            resolve()
          }, 5)
        })
    )
    const pool = createPreviewWatchPool({ createWatcher: factory })

    pool.acquire('/a', () => {})
    pool.acquire('/b', () => {})

    await pool.releaseAll()

    expect(settled).toBe(2)
    expect(created.every((w) => w.closed)).toBe(true)
    expect(pool.size).toBe(0)
  })

  it('close() releases every watcher regardless of refcount', async () => {
    const { factory, created } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory })

    pool.acquire('/a', () => {})
    pool.acquire('/a', () => {}) // refcount 2
    pool.acquire('/b', () => {})

    await pool.close()

    expect(created.every((w) => w.close.mock.calls.length === 1)).toBe(true)
    expect(pool.size).toBe(0)
  })

  it('release of an unknown path is a no-op', async () => {
    const { factory } = makeHarness()
    const pool = createPreviewWatchPool({ createWatcher: factory })

    await expect(pool.release('/never-watched')).resolves.toBeUndefined()
  })

  /**
   * The budget slot is TAKEN in `acquire` and RETURNED only by `closeEntry`,
   * which is reachable only through the entries map. A throw between the two
   * burns the slot permanently, and the module docblock claims the take and the
   * give "are one function apart and cannot drift" — this is the gap where they
   * can (lens review F12).
   *
   * It matters because `acquire` returning false is the degrade-quietly branch:
   * once the shared 64-slot budget is exhausted, every preview silently loses
   * auto-refresh with nothing surfaced anywhere.
   */
  it('returns the budget slot when the watcher factory throws', () => {
    const budget = createPreviewWatchBudget(1)
    const exploding: WatchFactory = () => {
      throw new Error('EMFILE')
    }
    const pool = createPreviewWatchPool({ createWatcher: exploding, budget })

    expect(() => pool.acquire('/p/a.css', vi.fn())).toThrow('EMFILE')

    // The single slot must be back, or the next preview never watches anything.
    expect(budget.tryTake()).toBe(true)
  })

  it('does not leak the slot across repeated failures', () => {
    const budget = createPreviewWatchBudget(2)
    let calls = 0
    const flaky: WatchFactory = (path, handlers, overrides) => {
      calls += 1
      if (calls <= 3) throw new Error('ENOSPC')
      const watcher = { close: vi.fn(async () => {}) }
      void path
      void handlers
      void overrides
      return watcher as unknown as FSWatcher
    }
    const pool = createPreviewWatchPool({ createWatcher: flaky, budget })

    for (const file of ['/p/a.css', '/p/b.css', '/p/c.css']) {
      expect(() => pool.acquire(file, vi.fn())).toThrow('ENOSPC')
    }

    // Three failures must not have consumed the two-slot budget.
    expect(pool.acquire('/p/d.css', vi.fn())).toBe(true)
  })

})

/**
 * A new watch catches up on a save made after the page's load began but before
 * chokidar was listening – the gap the link scan worker widened until the AC24
 * e2e lost its first save every run.
 */
describe('createPreviewWatchPool – a new watch catches up', () => {
  const SINCE = 10_000
  const NOW = 10_500
  const SLACK = WATCH_CATCH_UP_SLACK_MS

  function catchUpHarness(stat: () => Promise<{ mtimeMs: number }>) {
    const { factory, created } = makeHarness()
    const statFile = vi.fn(stat)
    const pool = createPreviewWatchPool({
      createWatcher: factory,
      budget: createPreviewWatchBudget(PREVIEW.MAX_WATCHED_FILES),
      statFile,
      now: () => NOW
    })
    return { pool, created, statFile }
  }

  const stamped = (mtimeMs: number) => async () => ({ mtimeMs })

  /** Let the catch-up's stamp read, and the check after it, run. */
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  it('reports a file saved after the load began, once, when the watch is listening', async () => {
    const { pool, created, statFile } = catchUpHarness(stamped(SINCE + 200))
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange, { changedSince: SINCE })
    await settle()
    // Not before chokidar listens: a save between the read and that would be lost.
    expect(statFile).not.toHaveBeenCalled()

    created[0].handlers.onReady?.()
    await settle()

    expect(statFile).toHaveBeenCalledWith('/proj/a.css')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['unchanged since before the load began', SINCE - SLACK - 1],
    ['stamped in the future', NOW + SLACK + 1]
  ])('reports nothing for a file %s', async (_label, mtimeMs) => {
    const { pool, created } = catchUpHarness(stamped(mtimeMs))
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange, { changedSince: SINCE })

    created[0].handlers.onReady?.()
    await settle()

    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['just before the load began', SINCE - SLACK],
    ['just after the clock now', NOW + SLACK]
  ])("allows a stamp's coarser clock: a file stamped %s is reported", async (_label, mtimeMs) => {
    const { pool, created } = catchUpHarness(stamped(mtimeMs))
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange, { changedSince: SINCE })

    created[0].handlers.onReady?.()
    await settle()

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('checks nothing without a load start, and nothing for a watch already held', async () => {
    const { pool, created, statFile } = catchUpHarness(stamped(SINCE + 200))
    const first = vi.fn()
    pool.acquire('/proj/plain.css', vi.fn())
    pool.acquire('/proj/held.css', first, { changedSince: SINCE })
    // A refcount bump opens no watcher, so it has no gap of its own to check.
    pool.acquire('/proj/held.css', vi.fn(), { changedSince: SINCE })

    expect(created).toHaveLength(2)
    expect(created[0].handlers.onReady).toBeUndefined()
    created[1].handlers.onReady?.()
    await settle()

    expect(statFile).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('reports nothing for a watch released before its stamp was read', async () => {
    let answer!: (stats: { mtimeMs: number }) => void
    const { pool, created } = catchUpHarness(() => new Promise((resolve) => (answer = resolve)))
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange, { changedSince: SINCE })
    created[0].handlers.onReady?.()

    await pool.release('/proj/a.css')
    answer({ mtimeMs: SINCE + 200 })
    await settle()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports nothing when the stamp cannot be read: a delete reaches the watch itself', async () => {
    const gone = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const { pool, created } = catchUpHarness(() => Promise.reject(gone))
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange, { changedSince: SINCE })

    created[0].handlers.onReady?.()
    await settle()

    expect(onChange).not.toHaveBeenCalled()
  })
})

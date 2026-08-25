// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the confining watch-set coordinator (Issue #74, work item 31).
 *
 * A fake pool records acquire/release order and captures each path's change
 * callback; an injected `confine` stands in for the realpath gate. Together they
 * pin the design's load-bearing behaviours without chokidar or a filesystem:
 *
 *   - an out-of-root candidate is dropped, counted, and NEVER acquired,
 *   - a set diff releases removed paths and acquires added ones,
 *   - releases are AWAITED before acquires (no transient FD stacking),
 *   - over-cap candidates are dropped in input priority order, and
 *   - change events coalesce into one signal over the coalesce window.
 */
import { describe, it, expect, vi } from 'vitest'
import type { ConfineVerdict } from './previewPathResolve'
import { createPreviewWatchCoordinator } from './PreviewWatchCoordinator'
import type { IPreviewWatchPool } from './PreviewWatchPool'

const REAL_ROOT = '/proj'

/** A confine that resolves each candidate to itself, save an explicit deny set. */
function makeConfine(
  denied: ReadonlySet<string> = new Set()
): (root: string, candidate: string) => Promise<ConfineVerdict> {
  return async (_root, candidate) => {
    if (denied.has(candidate)) return { ok: false, reason: 'escape' }
    return { ok: true, realTarget: candidate, rel: candidate }
  }
}

interface FakePool extends IPreviewWatchPool {
  readonly log: string[]
  readonly callbacks: Map<string, () => void>
  drainReleases(): void
}

/**
 * @param deferRelease - when true, `release` stays pending until `drainReleases`
 *   is called, so a test can prove the coordinator awaits it before acquiring.
 */
function makeFakePool(deferRelease = false): FakePool {
  const log: string[] = []
  const callbacks = new Map<string, () => void>()
  const pending: Array<() => void> = []
  const held = new Set<string>()

  return {
    log,
    callbacks,
    acquire(filePath, onChange) {
      log.push(`acquire:${filePath}`)
      callbacks.set(filePath, onChange)
      held.add(filePath)
      return true
    },
    release(filePath) {
      log.push(`release-start:${filePath}`)
      const finish = (): void => {
        log.push(`release-done:${filePath}`)
        callbacks.delete(filePath)
        held.delete(filePath)
      }
      if (!deferRelease) {
        finish()
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        pending.push(() => {
          finish()
          resolve()
        })
      })
    },
    async releaseAll() {
      held.clear()
    },
    async close() {
      held.clear()
    },
    get size() {
      return held.size
    },
    drainReleases() {
      pending.splice(0).forEach((fn) => fn())
    }
  }
}

describe('createPreviewWatchCoordinator.setWatchSet', () => {
  it('acquires a watch for each confined candidate', async () => {
    const pool = makeFakePool()
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged: () => {},
      confine: makeConfine()
    })

    const result = await coord.setWatchSet(['/proj/a.css', '/proj/b.js'])

    expect(result.watched).toEqual(['/proj/a.css', '/proj/b.js'])
    expect(result.dropped).toEqual([])
    expect(pool.log).toEqual(['acquire:/proj/a.css', 'acquire:/proj/b.js'])
  })

  it('drops an out-of-root candidate, counts it, and acquires no watch for it', async () => {
    const pool = makeFakePool()
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged: () => {},
      confine: makeConfine(new Set(['/etc/passwd']))
    })

    const result = await coord.setWatchSet(['/proj/a.css', '/etc/passwd'])

    expect(result.watched).toEqual(['/proj/a.css'])
    expect(result.dropped).toEqual([{ candidate: '/etc/passwd', reason: 'out-of-root' }])
    expect(pool.log).toEqual(['acquire:/proj/a.css'])
    expect(pool.log).not.toContain('acquire:/etc/passwd')
  })

  it('dedupes candidates that confine to the same target', async () => {
    const pool = makeFakePool()
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged: () => {},
      confine: async () => ({ ok: true, realTarget: '/proj/same.css', rel: 'same.css' })
    })

    const result = await coord.setWatchSet(['/proj/link-a.css', '/proj/link-b.css'])

    expect(result.watched).toEqual(['/proj/same.css'])
    expect(pool.log).toEqual(['acquire:/proj/same.css'])
  })

  it('diffs the set: releases removed watches and acquires added ones', async () => {
    const pool = makeFakePool()
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged: () => {},
      confine: makeConfine()
    })

    await coord.setWatchSet(['/proj/a.css', '/proj/b.css'])
    pool.log.length = 0

    const result = await coord.setWatchSet(['/proj/b.css', '/proj/c.css'])

    // a released, b unchanged (no churn), c acquired.
    expect(result.watched).toEqual(['/proj/b.css', '/proj/c.css'])
    expect(pool.log).toContain('release-start:/proj/a.css')
    expect(pool.log).toContain('acquire:/proj/c.css')
    expect(pool.log).not.toContain('acquire:/proj/b.css')
    expect(pool.log).not.toContain('release-start:/proj/b.css')
  })

  it('awaits releases before acquiring new watches', async () => {
    const pool = makeFakePool(true)
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged: () => {},
      confine: makeConfine()
    })

    await coord.setWatchSet(['/proj/a.css']) // no deferred release yet (initial)
    pool.log.length = 0

    // Swap a -> b. The release of a is deferred, so the acquire of b must wait.
    const pending = coord.setWatchSet(['/proj/b.css'])
    // Wait on the observable state (the release having started) rather than a
    // wall-clock sleep, so the assertion is deterministic.
    await vi.waitFor(() => expect(pool.log).toContain('release-start:/proj/a.css'))

    expect(pool.log).not.toContain('acquire:/proj/b.css')

    pool.drainReleases()
    await pending

    expect(pool.log).toEqual([
      'release-start:/proj/a.css',
      'release-done:/proj/a.css',
      'acquire:/proj/b.css'
    ])
  })

  it('a dispose mid-setWatchSet does not acquire a watch it would never release', async () => {
    const pool = makeFakePool(true) // deferred releases
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged: () => {},
      confine: makeConfine()
    })

    await coord.setWatchSet(['/proj/a.css']) // establishes watched = { a }
    pool.log.length = 0

    // Swap a -> b, but the release of a is deferred, so this call parks in its
    // release loop BEFORE acquiring b.
    const inFlight = coord.setWatchSet(['/proj/b.css'])
    await vi.waitFor(() => expect(pool.log).toContain('release-start:/proj/a.css'))
    expect(pool.log).not.toContain('acquire:/proj/b.css')

    // A dispose lands while that call is parked. It must wait for the in-flight
    // call to observe `disposed` and unwind before releasing.
    const disposed = coord.dispose()
    let done = false
    void disposed.then(() => {
      done = true
    })

    // The in-flight setWatchSet and the dispose each park on a deferred release
    // in turn; drain repeatedly until both have unwound.
    await vi.waitFor(() => {
      pool.drainReleases()
      expect(done).toBe(true)
    })
    await Promise.all([inFlight, disposed])

    // The disposed coordinator refused to acquire b — no watch is left dangling.
    expect(pool.log).not.toContain('acquire:/proj/b.css')
    expect(pool.size).toBe(0)
  })

  it('drops over-cap candidates in input priority order', async () => {
    const pool = makeFakePool()
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged: () => {},
      confine: makeConfine(),
      maxWatched: 2
    })

    const result = await coord.setWatchSet(['/proj/a.css', '/proj/b.css', '/proj/c.css'])

    expect(result.watched).toEqual(['/proj/a.css', '/proj/b.css'])
    expect(result.dropped).toEqual([{ candidate: '/proj/c.css', reason: 'over-cap' }])
    expect(pool.log).toEqual(['acquire:/proj/a.css', 'acquire:/proj/b.css'])
  })

  it('does not realpath-confine candidates dropped as over-cap', async () => {
    const pool = makeFakePool()
    const confine = vi.fn(makeConfine())
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged: () => {},
      confine,
      maxWatched: 2
    })

    const result = await coord.setWatchSet([
      '/proj/a.css',
      '/proj/b.css',
      '/proj/c.css',
      '/proj/d.css'
    ])

    expect(result.watched).toEqual(['/proj/a.css', '/proj/b.css'])
    expect(result.dropped.map((d) => d.candidate)).toEqual(['/proj/c.css', '/proj/d.css'])
    // The two over-cap candidates were dropped without paying for a confine.
    expect(confine).toHaveBeenCalledTimes(2)
    expect(confine).not.toHaveBeenCalledWith(REAL_ROOT, '/proj/c.css')
  })
})

describe('createPreviewWatchCoordinator change coalescing', () => {
  const makeTimerHarness = (): {
    setTimer: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>
    clearTimer: (h: ReturnType<typeof setTimeout>) => void
    run: () => void
    scheduled: () => boolean
  } => {
    let cb: (() => void) | null = null
    return {
      setTimer: (fn) => {
        cb = fn
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => {
        cb = null
      },
      run: () => {
        const fn = cb
        cb = null
        fn?.()
      },
      scheduled: () => cb !== null
    }
  }

  it('coalesces a burst of change events into one signal', async () => {
    const pool = makeFakePool()
    const timer = makeTimerHarness()
    const onChanged = vi.fn()
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged,
      confine: makeConfine(),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer
    })

    await coord.setWatchSet(['/proj/a.css', '/proj/b.css'])

    // Fire both watchers within the coalesce window.
    pool.callbacks.get('/proj/a.css')?.()
    pool.callbacks.get('/proj/b.css')?.()
    pool.callbacks.get('/proj/a.css')?.() // duplicate collapses

    expect(onChanged).not.toHaveBeenCalled()
    expect(timer.scheduled()).toBe(true)

    timer.run()

    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged.mock.calls[0][0].sort()).toEqual(['/proj/a.css', '/proj/b.css'])
  })

  it('starts a fresh window for the next burst', async () => {
    const pool = makeFakePool()
    const timer = makeTimerHarness()
    const onChanged = vi.fn()
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged,
      confine: makeConfine(),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer
    })

    await coord.setWatchSet(['/proj/a.css'])

    pool.callbacks.get('/proj/a.css')?.()
    timer.run()
    pool.callbacks.get('/proj/a.css')?.()
    timer.run()

    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('dispose releases every watch and cancels a pending signal', async () => {
    const pool = makeFakePool()
    const timer = makeTimerHarness()
    const onChanged = vi.fn()
    const coord = createPreviewWatchCoordinator({
      realRoot: REAL_ROOT,
      pool,
      onChanged,
      confine: makeConfine(),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer
    })

    await coord.setWatchSet(['/proj/a.css'])
    pool.callbacks.get('/proj/a.css')?.()
    pool.log.length = 0

    await coord.dispose()

    expect(pool.log).toContain('release-start:/proj/a.css')
    expect(timer.scheduled()).toBe(false)
    // A late timer run after dispose emits nothing.
    timer.run()
    expect(onChanged).not.toHaveBeenCalled()
  })
})

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
import type { ConfineVerdict } from '../../../shared/ipc/preview-types'
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
    // Drain microtasks (async confine + set diff) up to a macrotask so the
    // release loop has run and parked on the deferred release.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pool.log).toContain('release-start:/proj/a.css')
    expect(pool.log).not.toContain('acquire:/proj/b.css')

    pool.drainReleases()
    await pending

    expect(pool.log).toEqual([
      'release-start:/proj/a.css',
      'release-done:/proj/a.css',
      'acquire:/proj/b.css'
    ])
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

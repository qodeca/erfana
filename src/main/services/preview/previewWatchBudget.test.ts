// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview watch budget tests (sd-074b §4.6).
 *
 * The budget exists because the per-pool cap multiplies by the number of live
 * previews. What matters is that take and give stay symmetric across the pool's
 * three asymmetric paths, so the suite drives it through a real pool.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPreviewWatchBudget } from './previewWatchBudget'
import { createPreviewWatchPool } from './PreviewWatchPool'

/** A watcher factory that never touches chokidar. */
function fakeWatcherDeps(): { createWatcher: ReturnType<typeof vi.fn> } {
  return {
    createWatcher: vi.fn(() => ({
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }))
  }
}

describe('createPreviewWatchBudget', () => {
  it('hands out exactly `limit` slots', () => {
    const budget = createPreviewWatchBudget(2)
    expect(budget.tryTake()).toBe(true)
    expect(budget.tryTake()).toBe(true)
    expect(budget.tryTake()).toBe(false)
    expect(budget.inUse).toBe(2)
  })

  it('never drops below zero on an extra give', () => {
    const budget = createPreviewWatchBudget(1)
    budget.give()
    budget.give()
    expect(budget.inUse).toBe(0)
    expect(budget.tryTake()).toBe(true)
  })
})

describe('watch pools sharing one budget', () => {
  it('stops a second pool once the shared ceiling is reached', () => {
    const budget = createPreviewWatchBudget(2)
    const poolA = createPreviewWatchPool({ ...fakeWatcherDeps(), budget })
    const poolB = createPreviewWatchPool({ ...fakeWatcherDeps(), budget })

    expect(poolA.acquire('/a/one.css', () => {})).toBe(true)
    expect(poolA.acquire('/a/two.css', () => {})).toBe(true)
    // Budget exhausted by the first preview, even though pool B is empty and
    // well under its own per-preview cap.
    expect(poolB.acquire('/b/one.css', () => {})).toBe(false)
    expect(budget.inUse).toBe(2)
  })

  it('returns the slot when a watch is released, freeing the other pool', async () => {
    const budget = createPreviewWatchBudget(1)
    const poolA = createPreviewWatchPool({ ...fakeWatcherDeps(), budget })
    const poolB = createPreviewWatchPool({ ...fakeWatcherDeps(), budget })

    expect(poolA.acquire('/a/one.css', () => {})).toBe(true)
    expect(poolB.acquire('/b/one.css', () => {})).toBe(false)

    await poolA.release('/a/one.css')

    expect(budget.inUse).toBe(0)
    expect(poolB.acquire('/b/one.css', () => {})).toBe(true)
  })

  it('does not spend a second slot when the same path is re-acquired', async () => {
    const budget = createPreviewWatchBudget(2)
    const pool = createPreviewWatchPool({ ...fakeWatcherDeps(), budget })

    pool.acquire('/a/one.css', () => {})
    pool.acquire('/a/one.css', () => {})
    expect(budget.inUse).toBe(1)

    // First release only decrements the refcount, so the slot is still held.
    await pool.release('/a/one.css')
    expect(budget.inUse).toBe(1)

    await pool.release('/a/one.css')
    expect(budget.inUse).toBe(0)
  })

  it('does not spend a slot when the per-preview cap rejects first', () => {
    const budget = createPreviewWatchBudget(10)
    const pool = createPreviewWatchPool({ ...fakeWatcherDeps(), budget, maxWatched: 1 })

    expect(pool.acquire('/a/one.css', () => {})).toBe(true)
    expect(pool.acquire('/a/two.css', () => {})).toBe(false)

    expect(budget.inUse).toBe(1)
  })

  it('returns every slot on releaseAll', async () => {
    const budget = createPreviewWatchBudget(4)
    const pool = createPreviewWatchPool({ ...fakeWatcherDeps(), budget })

    pool.acquire('/a/one.css', () => {})
    pool.acquire('/a/two.css', () => {})
    expect(budget.inUse).toBe(2)

    await pool.releaseAll()

    expect(budget.inUse).toBe(0)
  })
})

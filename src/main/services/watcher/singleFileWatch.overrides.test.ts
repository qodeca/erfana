// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Options-merge tests for the optional `overrides` parameter (Issue #74, item
 * 29). The real-chokidar premise test lives in
 * `singleFileWatch.rename.integration.test.ts`; this file mocks chokidar so it
 * can inspect the exact option object handed to `chokidar.watch`, proving:
 *
 *   - with no overrides the base options are applied byte-for-byte (both
 *     existing call sites are behaviourally unchanged),
 *   - overrides shallow-merge over the base, and
 *   - the security-load-bearing `followSymlinks` invariant
 *     survives an overrides call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChokidarOptions } from 'chokidar'

const watchCalls: Array<{ path: string; options: ChokidarOptions }> = []

vi.mock('chokidar', () => {
  const fakeWatcher = { on: vi.fn(), close: vi.fn(async () => {}) }
  const watch = vi.fn((path: string, options: ChokidarOptions) => {
    watchCalls.push({ path, options })
    return fakeWatcher
  })
  return { default: { watch }, watch }
})

const gateCalls: Array<{ path: string; options: unknown }> = []
vi.mock('./writeFinishGate', () => ({
  createWriteFinishGate: vi.fn((path: string, options: unknown) => {
    gateCalls.push({ path, options })
    return { trigger: vi.fn(), cancel: vi.fn(), isPending: () => false }
  })
}))

const noopHandlers = { onChange: () => {}, onUnlink: () => {}, onError: () => {} }

beforeEach(() => {
  watchCalls.length = 0
  gateCalls.length = 0
})

describe('createSingleFileWatcher options merge', () => {
  it('applies the base options unchanged when no overrides are passed', async () => {
    const { createSingleFileWatcher, SINGLE_FILE_WATCH_OPTIONS } = await import('./singleFileWatch')

    createSingleFileWatcher('/proj/a.md', noopHandlers)

    expect(watchCalls).toHaveLength(1)
    const { options } = watchCalls[0]
    // Every base key reaches chokidar with its production value.
    expect(options).toMatchObject({
      persistent: SINGLE_FILE_WATCH_OPTIONS.persistent,
      ignoreInitial: SINGLE_FILE_WATCH_OPTIONS.ignoreInitial,
      usePolling: SINGLE_FILE_WATCH_OPTIONS.usePolling,
      followSymlinks: false
    })
    // chokidar's own wait is off (it can get stuck, #464); the timings go to the gate
    expect(options.awaitWriteFinish).toBe(false)
    expect(gateCalls).toEqual([{ path: '/proj/a.md', options: { stabilityThreshold: 300, pollInterval: 100 } }])
  })

  it('passes changes straight through when an override turns the wait off', async () => {
    const { createSingleFileWatcher } = await import('./singleFileWatch')

    createSingleFileWatcher('/proj/a.md', noopHandlers, { awaitWriteFinish: false })

    expect(watchCalls[0].options.awaitWriteFinish).toBe(false)
    expect(gateCalls).toHaveLength(0)
  })

  it('copies awaitWriteFinish rather than sharing the constant', async () => {
    const { createSingleFileWatcher, SINGLE_FILE_WATCH_OPTIONS } = await import('./singleFileWatch')

    createSingleFileWatcher('/proj/a.md', noopHandlers)

    expect(watchCalls[0].options.awaitWriteFinish).not.toBe(
      SINGLE_FILE_WATCH_OPTIONS.awaitWriteFinish
    )
  })

  it('shallow-merges overrides over the base options', async () => {
    const { createSingleFileWatcher } = await import('./singleFileWatch')

    createSingleFileWatcher('/proj/style.css', noopHandlers, {
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 }
    })

    const { options } = watchCalls[0]
    expect(options.awaitWriteFinish).toBe(false)
    expect(gateCalls[0].options).toEqual({ stabilityThreshold: 50, pollInterval: 25 })
    // The security invariants are NOT in the overrides, so they survive.
    expect(options.followSymlinks).toBe(false)
  })

  it('does not mutate the shared constant when overrides are passed', async () => {
    const { createSingleFileWatcher, SINGLE_FILE_WATCH_OPTIONS } = await import('./singleFileWatch')
    const before = JSON.stringify(SINGLE_FILE_WATCH_OPTIONS)

    createSingleFileWatcher('/proj/style.css', noopHandlers, {
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 }
    })

    expect(JSON.stringify(SINGLE_FILE_WATCH_OPTIONS)).toBe(before)
  })
})

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
 *   - the security-load-bearing `followSymlinks` / `disableGlobbing` invariants
 *     survive an overrides call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WatchOptions } from 'chokidar'

const watchCalls: Array<{ path: string; options: WatchOptions }> = []

vi.mock('chokidar', () => {
  const fakeWatcher = { on: vi.fn(), close: vi.fn(async () => {}) }
  const watch = vi.fn((path: string, options: WatchOptions) => {
    watchCalls.push({ path, options })
    return fakeWatcher
  })
  return { default: { watch }, watch }
})

const noopHandlers = { onChange: () => {}, onUnlink: () => {}, onError: () => {} }

beforeEach(() => {
  watchCalls.length = 0
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
      followSymlinks: false,
      disableGlobbing: true
    })
    expect(options.awaitWriteFinish).toEqual({ stabilityThreshold: 300, pollInterval: 100 })
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
    expect(options.awaitWriteFinish).toEqual({ stabilityThreshold: 50, pollInterval: 25 })
    // The security invariants are NOT in the overrides, so they survive.
    expect(options.followSymlinks).toBe(false)
    expect(options.disableGlobbing).toBe(true)
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

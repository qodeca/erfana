// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which `stat` failures mean "gone" (#252), with `stat` mocked so every code
 * can be produced on any host. Only ENOENT and ENOTDIR do: a file Windows has
 * locked (EBUSY) or will not let us look at (EPERM) is still there, and the
 * unlink branch must re-arm the watch rather than show a "deleted" banner.
 * The mock hoists to module scope, hence a file of its own.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { FSWatcher } from 'chokidar'

vi.mock('fs/promises', () => ({ stat: vi.fn() }))

import { stat } from 'fs/promises'
import { pathIsPresent } from './pathPresence'
import { resolveDeletedWatch, type AtomicRearmDeps, type RearmableWatch } from './atomicRearm'

const FILE = '/proj/docs/open.md'

/** A `stat` failure the way Node reports it: the errno name in `code`. */
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

const fakeWatcher = (): FSWatcher => ({ close: vi.fn(async () => {}) }) as unknown as FSWatcher

/** The unlink branch's port, with nothing but spies behind it. */
function makeDeps(): AtomicRearmDeps {
  const watched: RearmableWatch = { filePath: FILE, watcher: fakeWatcher(), version: 1, debounceTimer: null }
  return {
    isDisposing: () => false,
    currentVersion: () => 1,
    getWatch: () => watched,
    isPathConfined: async () => true,
    createWatcher: vi.fn(() => fakeWatcher()),
    replaceWatcher: vi.fn(() => true),
    discardWatch: vi.fn(),
    notifyDeleted: vi.fn(),
    notifyWatchDead: vi.fn(),
    emitChange: vi.fn(),
    log: vi.fn()
  }
}

describe('pathIsPresent – stat error codes', () => {
  beforeEach(() => {
    vi.mocked(stat).mockReset()
  })

  it.each(['ENOENT', 'ENOTDIR'])('counts %s as gone', async (code) => {
    vi.mocked(stat).mockRejectedValue(errno(code))
    expect(await pathIsPresent(FILE)).toBe(false)
  })

  it.each(['EPERM', 'EBUSY', 'EACCES', 'EIO'])('counts %s as still there', async (code) => {
    vi.mocked(stat).mockRejectedValue(errno(code))
    expect(await pathIsPresent(FILE)).toBe(true)
  })

  it('counts a failure with no code as still there', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('drive went away'))
    expect(await pathIsPresent(FILE)).toBe(true)
  })
})

describe('resolveDeletedWatch – a file that is locked, not gone', () => {
  beforeEach(() => {
    vi.mocked(stat).mockReset()
  })

  it.each(['EPERM', 'EBUSY'])('re-arms the watch on %s instead of reporting a delete', async (code) => {
    vi.mocked(stat).mockRejectedValue(errno(code))
    const deps = makeDeps()

    await resolveDeletedWatch(FILE, false, deps)

    expect(deps.notifyDeleted).not.toHaveBeenCalled()
    expect(deps.discardWatch).not.toHaveBeenCalled()
    expect(deps.createWatcher).toHaveBeenCalledWith(FILE)
    expect(deps.emitChange).toHaveBeenCalledWith(FILE)
  })

  it('still reports a delete on ENOENT', async () => {
    vi.mocked(stat).mockRejectedValue(errno('ENOENT'))
    const deps = makeDeps()

    await resolveDeletedWatch(FILE, false, deps)

    expect(deps.notifyDeleted).toHaveBeenCalledWith(FILE)
    expect(deps.discardWatch).toHaveBeenCalled()
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What each `stat` failure means (#252), with `stat` and `realpath` mocked so
 * every code can be produced on any host, and the platform stubbed so both
 * rules can be played. ENOENT and ENOTDIR are gone; any other code is
 * unreadable, and an unreadable file is there - except on Windows just after
 * an unlink: a file deleted while another process holds it open answers EPERM
 * or EBUSY to `stat` and to `realpath` alike, and must end in "deleted", not
 * in an "outside the project" error. The confinement check is the real
 * `classifyConfinement`. The mock hoists to module scope, hence a file of its
 * own.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FSWatcher } from 'chokidar'

vi.mock('fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs/promises')>()),
  stat: vi.fn(),
  realpath: vi.fn()
}))

import { realpath, stat } from 'fs/promises'
import { classifyConfinement } from '../../utils/projectConfinement'
import { UNREADABLE_RECHECK_MS, isPresentAfterSettle, pathIsPresent, probePath } from './pathPresence'
import {
  WATCH_DEAD_OUTSIDE_PROJECT,
  resolveDeletedWatch,
  type AtomicRearmDeps,
  type RearmableWatch
} from './atomicRearm'

const PROJECT = path.resolve(path.sep, 'proj')
const FILE = path.join(PROJECT, 'docs', 'open.md')
const DELETE_PENDING = ['EPERM', 'EBUSY']
const OTHER_UNREADABLE = ['EACCES', 'EIO']
const NOT_WINDOWS = ['darwin', 'linux'] as const

/** A `stat` failure the way Node reports it: the errno name in `code`. */
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

const fakeWatcher = (): FSWatcher => ({ close: vi.fn(async () => {}) }) as unknown as FSWatcher

const hostPlatform = process.platform

/** Play another host: the delete-pending rule reads the platform per call. */
function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: hostPlatform, configurable: true })
}

/** `realpath` that resolves every path to itself: nothing is a symlink. */
function resolveAsIs(): void {
  vi.mocked(realpath).mockImplementation((async (p: string) => p) as unknown as typeof realpath)
}

/** `realpath` that fails with `code` for anything but the project root. */
function failRealpath(code: string): void {
  vi.mocked(realpath).mockImplementation((async (p: string) => {
    if (p === PROJECT) return PROJECT
    throw errno(code)
  }) as unknown as typeof realpath)
}

/** The unlink branch's port: spies, plus the real confinement check against PROJECT. */
function makeDeps(): AtomicRearmDeps {
  const watched: RearmableWatch = { filePath: FILE, watcher: fakeWatcher(), version: 1, debounceTimer: null }
  return {
    isDisposing: () => false,
    currentVersion: () => 1,
    getWatch: () => watched,
    isPathConfined: async filePath => {
      const verdict = await classifyConfinement(filePath, PROJECT)
      return verdict === 'inside' || verdict === 'missing'
    },
    createWatcher: vi.fn(() => fakeWatcher()),
    replaceWatcher: vi.fn(() => true),
    discardWatch: vi.fn(),
    notifyDeleted: vi.fn(),
    notifyWatchDead: vi.fn(),
    emitChange: vi.fn(),
    log: vi.fn()
  }
}

/** Run the unlink branch through its re-check waits. */
async function resolveWith(deps: AtomicRearmDeps): Promise<void> {
  const done = resolveDeletedWatch(FILE, false, deps)
  await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS * 4)
  await done
}

/** The watch survived: re-armed and back on the change path, nothing reported deleted or dead. */
function expectRearmed(deps: AtomicRearmDeps): void {
  expect(deps.notifyDeleted).not.toHaveBeenCalled()
  expect(deps.notifyWatchDead).not.toHaveBeenCalled()
  expect(deps.createWatcher).toHaveBeenCalledWith(FILE)
  expect(deps.emitChange).toHaveBeenCalledWith(FILE)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(stat).mockReset()
  vi.mocked(realpath).mockReset()
  // The project root itself always resolves
  failRealpath('ENOENT')
})

afterEach(() => {
  restorePlatform()
  vi.useRealTimers()
})

describe('probePath – stat error codes', () => {
  it.each(['ENOENT', 'ENOTDIR'])('calls %s missing', async (code) => {
    vi.mocked(stat).mockRejectedValue(errno(code))
    expect(await probePath(FILE)).toBe('missing')
    expect(await pathIsPresent(FILE)).toBe(false)
  })

  it.each([...DELETE_PENDING, ...OTHER_UNREADABLE])('calls %s unreadable, which counts as present', async (code) => {
    vi.mocked(stat).mockRejectedValue(errno(code))
    expect(await probePath(FILE)).toBe('unreadable')
    expect(await pathIsPresent(FILE)).toBe(true)
  })

  it('calls a failure with no code unreadable', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('drive went away'))
    expect(await probePath(FILE)).toBe('unreadable')
  })
})

describe('isPresentAfterSettle – the unlink branch’s question', () => {
  describe('on Windows', () => {
    beforeEach(() => stubPlatform('win32'))

    it.each(DELETE_PENDING)('takes %s that persists past the second look as gone', async (code) => {
      vi.mocked(stat).mockRejectedValue(errno(code))
      const answer = isPresentAfterSettle(FILE)
      await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)

      expect(await answer).toBe(false)
      expect(stat).toHaveBeenCalledTimes(2)
    })

    it.each(DELETE_PENDING)('takes %s that clears on the second look as present', async (code) => {
      vi.mocked(stat).mockRejectedValueOnce(errno(code)).mockResolvedValue({} as never)
      const answer = isPresentAfterSettle(FILE)
      await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)

      expect(await answer).toBe(true)
    })

    it.each(OTHER_UNREADABLE)('takes %s as present without a second look', async (code) => {
      vi.mocked(stat).mockRejectedValue(errno(code))

      expect(await isPresentAfterSettle(FILE)).toBe(true)
      expect(stat).toHaveBeenCalledTimes(1)
    })
  })

  describe.each(NOT_WINDOWS)('on %s', (platform) => {
    beforeEach(() => stubPlatform(platform))

    it.each([...DELETE_PENDING, ...OTHER_UNREADABLE])('takes %s as present without a second look', async (code) => {
      vi.mocked(stat).mockRejectedValue(errno(code))

      expect(await isPresentAfterSettle(FILE)).toBe(true)
      expect(stat).toHaveBeenCalledTimes(1)
    })
  })
})

describe('resolveDeletedWatch – an unreadable file after its unlink', () => {
  describe('on Windows', () => {
    beforeEach(() => stubPlatform('win32'))

    it.each(DELETE_PENDING)(
      'ends the watch as deleted when %s does not clear - not as "outside the project"',
      async (code) => {
        vi.mocked(stat).mockRejectedValue(errno(code))
        failRealpath(code)
        const deps = makeDeps()

        await resolveWith(deps)

        expect(deps.notifyDeleted).toHaveBeenCalledWith(FILE)
        expect(deps.notifyWatchDead).not.toHaveBeenCalled()
        expect(deps.discardWatch).toHaveBeenCalledTimes(1)
        // No watch is re-armed on a file that is going away
        expect(deps.createWatcher).not.toHaveBeenCalled()
      }
    )

    it('re-arms the watch when a lock (EBUSY) clears on the second look', async () => {
      vi.mocked(stat).mockRejectedValueOnce(errno('EBUSY')).mockResolvedValue({} as never)
      resolveAsIs()
      const deps = makeDeps()

      await resolveWith(deps)

      expectRearmed(deps)
    })

    it.each(OTHER_UNREADABLE)('keeps watching a file that answers %s', async (code) => {
      vi.mocked(stat).mockRejectedValue(errno(code))
      resolveAsIs()
      const deps = makeDeps()

      await resolveWith(deps)

      expectRearmed(deps)
    })
  })

  describe.each(NOT_WINDOWS)('on %s', (platform) => {
    beforeEach(() => stubPlatform(platform))

    it.each([...DELETE_PENDING, ...OTHER_UNREADABLE])('keeps watching a file that answers %s', async (code) => {
      vi.mocked(stat).mockRejectedValue(errno(code))
      resolveAsIs()
      const deps = makeDeps()

      await resolveWith(deps)

      expectRearmed(deps)
    })
  })

  it('still says "outside the project" for a file that is there but resolves outside it', async () => {
    vi.mocked(stat).mockResolvedValue({} as never)
    vi.mocked(realpath).mockImplementation((async (p: string) =>
      p === PROJECT ? PROJECT : path.resolve(path.sep, 'elsewhere', 'open.md')) as unknown as typeof realpath)
    const deps = makeDeps()

    await resolveWith(deps)

    expect(deps.notifyWatchDead).toHaveBeenCalledWith(FILE, WATCH_DEAD_OUTSIDE_PROJECT)
    expect(deps.notifyDeleted).not.toHaveBeenCalled()
  })

  it('reports a delete on ENOENT straight away', async () => {
    vi.mocked(stat).mockRejectedValue(errno('ENOENT'))
    const deps = makeDeps()

    await resolveDeletedWatch(FILE, false, deps)

    expect(deps.notifyDeleted).toHaveBeenCalledWith(FILE)
    expect(stat).toHaveBeenCalledTimes(1)
  })
})

describe('resolveDeletedWatch – the path is watched again during the second look (#252 review)', () => {
  it('leaves the newer watch alone and closes only its own replacement watcher', async () => {
    stubPlatform('win32')
    // Replacement bound, then: a possible delete pending, and finally gone
    vi.mocked(stat).mockRejectedValueOnce(errno('EPERM')).mockRejectedValue(errno('ENOENT'))
    resolveAsIs()
    const deps = makeDeps()
    let current = deps.getWatch(FILE)
    deps.getWatch = () => current

    const done = resolveDeletedWatch(FILE, true, deps)
    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS / 2)
    expect(deps.createWatcher).toHaveBeenCalledTimes(1)
    const replacement = vi.mocked(deps.createWatcher).mock.results[0]?.value as FSWatcher

    // The tab is reopened (or the project) while the stat waits
    current = { filePath: FILE, watcher: fakeWatcher(), version: 2, debounceTimer: null }
    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)
    await done

    // The newer watch's tab hears no stale verdict, and its entry is not torn down
    expect(deps.notifyDeleted).not.toHaveBeenCalled()
    expect(deps.discardWatch).not.toHaveBeenCalled()
    expect(deps.emitChange).not.toHaveBeenCalled()
    expect(replacement.close).toHaveBeenCalledTimes(1)
    expect(current.watcher.close).not.toHaveBeenCalled()
  })
})

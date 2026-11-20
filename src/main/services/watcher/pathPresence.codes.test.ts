// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What each `stat` failure means (#252), with `stat` and `realpath` mocked so
 * every code can be produced on any host, and the platform stubbed so both
 * rules can be played. ENOENT and ENOTDIR are gone; any other code is
 * unreadable, and an unreadable file is there - except on Windows just after
 * an unlink: a file deleted while another process holds it open answers EPERM
 * or EBUSY to `stat` and to `realpath` alike, and must end in "deleted", not
 * in an "outside the project" error. The re-arm is the real `armWatch` with
 * its confinement check against a project session. The mock hoists to module
 * scope, hence a file of its own.
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
import { UNREADABLE_RECHECK_MS, isPresentAfterSettle, pathIsPresent, probePath } from './pathPresence'
import { resolveDeletedWatch, type AtomicRearmDeps } from './atomicRearm'
import { armWatch } from './armWatch'
import type { WatchEntry } from './watchTypes'
import type { ProjectSessionSnapshot } from '../session/ProjectSession'

const PROJECT = path.resolve(path.sep, 'proj')
const FILE = path.join(PROJECT, 'docs', 'open.md')
const DELETE_PENDING = ['EPERM', 'EBUSY']
const OTHER_UNREADABLE = ['EACCES', 'EIO']
const NOT_WINDOWS = ['darwin', 'linux'] as const

/** A `stat` failure the way Node reports it: the errno name in `code`. */
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

const fakeWatcher = (): FSWatcher => ({ close: vi.fn(async () => {}) }) as unknown as FSWatcher
/** What `stat` answers for a regular file. */
const AFILE = { isFile: () => true } as never
const SESSION: ProjectSessionSnapshot = {
  generation: 1,
  root: PROJECT,
  realRoot: PROJECT,
  caseSensitive: true,
  ownerWebContentsId: null
}

/** A watch entry for `FILE` with a fake watcher. */
function entryFor(): WatchEntry {
  return {
    key: FILE,
    filePath: FILE,
    profile: 'editor',
    watcher: fakeWatcher(),
    suspended: false,
    identity: null,
    arming: null,
    ready: null,
    subs: new Set()
  }
}

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

interface Deps extends AtomicRearmDeps {
  /** The entry the port holds now (a test can swap it). */
  current: WatchEntry | undefined
  readonly entry: WatchEntry
  readonly createWatcher: ReturnType<typeof vi.fn>
}

/** The unlink branch's port: spies, and the real `armWatch` against PROJECT. */
function makeDeps(): Deps {
  const entry = entryFor()
  const createWatcher = vi.fn(() => fakeWatcher())
  const deps: Deps = {
    current: entry,
    entry,
    createWatcher,
    isDisposing: () => false,
    getWatch: () => deps.current,
    rearm: watched =>
      armWatch(watched, {
        session: () => SESSION,
        isCurrent: e => deps.current === e,
        createWatcher: () => createWatcher()
      }),
    discardWatch: vi.fn(),
    notifyDeleted: vi.fn(),
    notifyWatchDead: vi.fn(),
    emitChange: vi.fn(),
    log: vi.fn()
  }
  return deps
}

/** Run the unlink branch through its re-check waits. */
async function resolveWith(deps: AtomicRearmDeps): Promise<void> {
  const done = resolveDeletedWatch(FILE, false, deps)
  await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS * 4)
  await done
}

/** The watch survived: re-armed and back on the change path, nothing reported deleted or dead. */
function expectRearmed(deps: Deps): void {
  expect(deps.notifyDeleted).not.toHaveBeenCalled()
  expect(deps.notifyWatchDead).not.toHaveBeenCalled()
  expect(deps.createWatcher).toHaveBeenCalledTimes(1)
  expect(deps.emitChange).toHaveBeenCalledWith(deps.entry)
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
      vi.mocked(stat).mockRejectedValueOnce(errno(code)).mockResolvedValue(AFILE)
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

        expect(deps.notifyDeleted).toHaveBeenCalledWith(deps.entry)
        expect(deps.notifyWatchDead).not.toHaveBeenCalled()
        expect(deps.discardWatch).toHaveBeenCalledTimes(1)
        // No watch is re-armed on a file that is going away
        expect(deps.createWatcher).not.toHaveBeenCalled()
      }
    )

    it('re-arms the watch when a lock (EBUSY) clears on the second look', async () => {
      vi.mocked(stat).mockRejectedValueOnce(errno('EBUSY')).mockResolvedValue(AFILE)
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
    vi.mocked(stat).mockResolvedValue(AFILE)
    vi.mocked(realpath).mockImplementation((async (p: string) =>
      p === PROJECT ? PROJECT : path.resolve(path.sep, 'elsewhere', 'open.md')) as unknown as typeof realpath)
    const deps = makeDeps()

    await resolveWith(deps)

    expect(deps.notifyWatchDead).toHaveBeenCalledWith(deps.entry, 'outside-project')
    expect(deps.notifyDeleted).not.toHaveBeenCalled()
    expect(deps.createWatcher).not.toHaveBeenCalled()
  })

  it('reports a delete on ENOENT straight away', async () => {
    vi.mocked(stat).mockRejectedValue(errno('ENOENT'))
    const deps = makeDeps()

    await resolveDeletedWatch(FILE, false, deps)

    expect(deps.notifyDeleted).toHaveBeenCalledWith(deps.entry)
    expect(stat).toHaveBeenCalledTimes(1)
  })
})

describe('resolveDeletedWatch – the path is watched again during the second look (#252 review)', () => {
  it('leaves the newer watch alone and closes only its own replacement watcher', async () => {
    stubPlatform('win32')
    // The arm finds a file and binds the replacement, then the check after it:
    // a possible delete pending, and finally gone
    vi.mocked(stat)
      .mockResolvedValueOnce(AFILE)
      .mockRejectedValueOnce(errno('EPERM'))
      .mockRejectedValue(errno('ENOENT'))
    resolveAsIs()
    const deps = makeDeps()

    const done = resolveDeletedWatch(FILE, true, deps)
    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS / 2)
    expect(deps.createWatcher).toHaveBeenCalledTimes(1)
    const replacement = deps.createWatcher.mock.results[0]?.value as FSWatcher

    // The tab is reopened (or the project) while the stat waits
    const newer = entryFor()
    deps.current = newer
    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)
    await done

    // The newer watch's tab hears no stale verdict, and its entry is not torn down
    expect(deps.notifyDeleted).not.toHaveBeenCalled()
    expect(deps.discardWatch).not.toHaveBeenCalled()
    expect(deps.emitChange).not.toHaveBeenCalled()
    expect(replacement.close).toHaveBeenCalledTimes(1)
    expect(newer.watcher?.close).not.toHaveBeenCalled()
  })
})

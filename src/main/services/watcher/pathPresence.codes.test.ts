// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What each `stat` failure means (#252), with `stat` and `realpath` mocked so
 * every code can be produced on any host. ENOENT and ENOTDIR are gone; any
 * other code is unreadable. The unlink branch asks about an unreadable file
 * once more and then takes it as gone - on Windows a file deleted while
 * another process held it open answers EPERM to `stat` and to `realpath`
 * alike, and must end in "deleted", not in an "outside the project" error.
 * The confinement check is the real `classifyConfinement`. The mock hoists to
 * module scope, hence a file of its own.
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

/** A `stat` failure the way Node reports it: the errno name in `code`. */
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

const fakeWatcher = (): FSWatcher => ({ close: vi.fn(async () => {}) }) as unknown as FSWatcher

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

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(stat).mockReset()
  vi.mocked(realpath).mockReset()
  // The project root itself always resolves
  vi.mocked(realpath).mockImplementation((async (p: string) => {
    if (p === PROJECT) return PROJECT
    throw errno('ENOENT')
  }) as unknown as typeof realpath)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('probePath – stat error codes', () => {
  it.each(['ENOENT', 'ENOTDIR'])('calls %s missing', async (code) => {
    vi.mocked(stat).mockRejectedValue(errno(code))
    expect(await probePath(FILE)).toBe('missing')
    expect(await pathIsPresent(FILE)).toBe(false)
  })

  it.each(['EPERM', 'EBUSY', 'EACCES', 'EIO'])('calls %s unreadable, which the probe counts as present', async (code) => {
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
  it('takes a file unreadable twice as gone, and one that clears as present', async () => {
    vi.mocked(stat).mockRejectedValue(errno('EPERM'))
    const stuck = isPresentAfterSettle(FILE)
    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)
    expect(await stuck).toBe(false)

    vi.mocked(stat).mockReset().mockRejectedValueOnce(errno('EBUSY')).mockResolvedValue({} as never)
    const cleared = isPresentAfterSettle(FILE)
    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)
    expect(await cleared).toBe(true)
  })
})

describe('resolveDeletedWatch – a file Windows is still deleting', () => {
  it.each(['EPERM', 'EACCES', 'EIO'])(
    'ends the watch as deleted when %s does not clear - not as "outside the project"',
    async (code) => {
      vi.mocked(stat).mockRejectedValue(errno(code))
      vi.mocked(realpath).mockImplementation((async (p: string) => {
        if (p === PROJECT) return PROJECT
        throw errno(code)
      }) as unknown as typeof realpath)
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
    vi.mocked(realpath).mockImplementation((async (p: string) => p) as unknown as typeof realpath)
    const deps = makeDeps()

    await resolveWith(deps)

    expect(deps.notifyDeleted).not.toHaveBeenCalled()
    expect(deps.createWatcher).toHaveBeenCalledWith(FILE)
    expect(deps.emitChange).toHaveBeenCalledWith(FILE)
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

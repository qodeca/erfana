// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A 1200-file folder delete with three tabs open inside it (#346 review, W2).
 *
 * Every message the main process sends drives renderer work, so a removal
 * burst must cost the renderer one `file-watch:deleted` per open tab and a
 * bounded number of tree broadcasts - not one message per removed path, and
 * no re-armed watch on a file that is going away. The project watcher (fake
 * native backend) and the single-file watches (fake chokidar) are wired the
 * way `src/main/index.ts` wires them; `stat` and `realpath` answer from a
 * small disk model, so the Windows "delete pending" answer (EPERM to both) can
 * be played on any host. Module-scope mocks, hence a file of its own.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const harness = vi.hoisted(() => ({
  sends: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  natives: [] as Array<{ emit(event: string, ...args: unknown[]): boolean }>,
  fileWatchers: [] as Array<{ path: string; handlers: Map<string, (...args: unknown[]) => void> }>,
  /** Path -> 'present' or the errno code `stat` / `realpath` fail with; absent means ENOENT. */
  disk: new Map<string, string>(),
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('./watcher/NativeRecursiveWatcher', async () => {
  const { EventEmitter } = await import('events')
  class FakeNativeRecursiveWatcher extends EventEmitter {
    readonly close = vi.fn(async () => {})
    readonly getPlanStats = vi.fn(() => ({
      handles: 1,
      recursiveWatches: 1,
      splitFolders: 0,
      planCapped: false,
      elapsedMs: 1
    }))

    constructor() {
      super()
      harness.natives.push(this)
    }
  }
  return { NativeRecursiveWatcher: FakeNativeRecursiveWatcher }
})

vi.mock('chokidar', () => {
  const watch = vi.fn((watchedPath: string) => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    harness.fileWatchers.push({ path: watchedPath, handlers })
    const watcher = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        handlers.set(event, listener)
        return watcher
      }),
      close: vi.fn(async () => {})
    }
    return watcher
  })
  return { default: { watch }, watch }
})

vi.mock('fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs/promises')>()
  const answer = async (p: string): Promise<void> => {
    const state = harness.disk.get(p) ?? 'ENOENT'
    if (state === 'present') return
    throw Object.assign(new Error(state), { code: state })
  }
  return {
    ...real,
    stat: vi.fn(async (p: string) => {
      await answer(p)
      return { isFile: () => true, isDirectory: () => false }
    }),
    realpath: vi.fn(async (p: string) => {
      await answer(p)
      return p
    })
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
          isDestroyed: () => false,
          send: (channel: string, payload: Record<string, unknown>) => {
            harness.sends.push({ channel, payload })
          }
        }
      }
    ])
  },
  webContents: { getAllWebContents: vi.fn(() => [{ id: 1, isDestroyed: () => false }]) }
}))

vi.mock('./SettingsService', () => ({
  settingsService: { getDirectoryWatchDepth: vi.fn(async (): Promise<number | undefined> => undefined) }
}))

vi.mock('../utils/pathSecurity', () => ({ isSystemDirectory: vi.fn(() => false) }))

vi.mock('./LoggingService', () => ({ logger: harness.logger }))

import chokidar from 'chokidar'
import { DirectoryWatcherService } from './DirectoryWatcherService'
import { FileWatcherService } from './FileWatcherService'

const ROOT = path.resolve(path.sep, 'work', 'proj')
const BIG = path.join(ROOT, 'big')
const SUBFOLDERS = 12
const FILES_PER_FOLDER = 100
const OWNER = 1
const webContents = { id: OWNER } as unknown as WebContents
/** Long enough for every flush, debounce, atomic-save window and re-check to finish. */
const SETTLE_MS = 10_000
const HOST_PLATFORM = process.platform

const pad = (n: number, width: number): string => String(n).padStart(width, '0')
const sub = (s: number): string => path.join(BIG, `sub${pad(s, 2)}`)
const file = (s: number, f: number): string => path.join(sub(s), `s${pad(s, 2)}-f${pad(f, 3)}.md`)
const OPEN = [file(1, 1), file(6, 50), file(12, 100)]

/** The OS's removal events for `big`, depth-first: each folder's files, then the folder. */
function emitBigRemoval(): void {
  const native = harness.natives.at(-1)
  if (!native) throw new Error('no native watcher was constructed')
  for (let s = 1; s <= SUBFOLDERS; s++) {
    for (let f = 1; f <= FILES_PER_FOLDER; f++) native.emit('unlink', file(s, f))
    native.emit('unlinkDir', sub(s))
  }
  native.emit('unlinkDir', BIG)
}

/** Each open file's own single-file watch hears its unlink, as it does on every OS. */
function fireOwnUnlinks(): void {
  for (const watcher of harness.fileWatchers) watcher.handlers.get('unlink')?.()
}

const count = (channel: string): number => harness.sends.filter(s => s.channel === channel).length

let dws: DirectoryWatcherService
let fws: FileWatcherService

beforeEach(async () => {
  vi.useFakeTimers()
  harness.sends.length = 0
  harness.natives.length = 0
  harness.fileWatchers.length = 0
  harness.disk.clear()
  harness.disk.set(ROOT, 'present')
  for (const open of OPEN) harness.disk.set(open, 'present')
  vi.mocked(chokidar.watch).mockClear()

  dws = new DirectoryWatcherService({ backend: 'native-recursive' })
  fws = new FileWatcherService()
  dws.setProjectPath(ROOT)
  fws.setProjectPath(ROOT)
  // Wired as src/main/index.ts wires them
  dws.onPathsRemoved(removed => fws.handleAncestorRemovals(removed))
  dws.onRemovalsLost((root, isOwnRemoval) => {
    void fws.checkWatchedFilesUnder(root, isOwnRemoval)
  })
  fws.watchUnseenFiles(dws)
  await dws.watchDirectory(ROOT, webContents)
  for (const open of OPEN) await fws.watchFile(open, webContents)
  harness.sends.length = 0
})

afterEach(async () => {
  await fws.dispose()
  await dws.dispose()
  vi.useRealTimers()
})

/** The whole burst costs the renderer one deleted per tab, nothing else per tab, a few tree broadcasts. */
function expectBoundedBurst(): void {
  expect(count('file-watch:deleted')).toBe(OPEN.length)
  expect(new Set(harness.sends.filter(s => s.channel === 'file-watch:deleted').map(s => s.payload.filePath))).toEqual(
    new Set(OPEN)
  )
  expect(count('file-watch:changed')).toBe(0)
  expect(count('file-watch:error')).toBe(0)
  // No watch was re-armed on a file that is going away
  expect(chokidar.watch).toHaveBeenCalledTimes(OPEN.length)
  // Everything else is the coalesced tree broadcast, a handful for 1213 removals
  expect(count('directory-watch:changed')).toBeLessThanOrEqual(3)
  expect(harness.sends.length).toBeLessThanOrEqual(OPEN.length + 3)
}

describe('a 1200-file folder delete with three tabs open inside it', () => {
  it('outside the app: one deleted per tab, whatever the order the watchers hear it in', async () => {
    for (const open of OPEN) harness.disk.delete(open)

    emitBigRemoval()
    fireOwnUnlinks()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expectBoundedBurst()
  })

  it('outside the app on Windows, with the tabs’ files still being deleted (EPERM to stat and realpath)', async () => {
    for (const open of OPEN) harness.disk.set(open, 'EPERM')
    // Only the delete-pending rule reads the platform per event; the watchers
    // were built for the host in beforeEach
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      emitBigRemoval()
      fireOwnUnlinks()
      await vi.advanceTimersByTimeAsync(SETTLE_MS)
    } finally {
      Object.defineProperty(process, 'platform', { value: HOST_PLATFORM, configurable: true })
    }

    expectBoundedBurst()
  })

  it('in the app (paused, noted as its own): the tabs hear it from their own watches only', async () => {
    for (const open of OPEN) harness.disk.delete(open)
    const lost = vi.fn()
    dws.onRemovalsLost(lost)

    dws.pauseWatch(ROOT, OWNER)
    emitBigRemoval()
    fireOwnUnlinks()
    dws.noteInternalChange({ path: BIG, kind: 'removed', subtree: true })
    dws.resumeWatch(ROOT)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expectBoundedBurst()
    expect(lost).not.toHaveBeenCalled()
  })

  it('outside the app during an own pause: reported once, at resume', async () => {
    for (const open of OPEN) harness.disk.delete(open)

    dws.pauseWatch(ROOT, OWNER)
    emitBigRemoval()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(count('file-watch:deleted')).toBe(0)

    dws.resumeWatch(ROOT)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expectBoundedBurst()
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A path watched again while its old watch's unlink check is still waiting on
 * the disk (#346 review).
 *
 * On Windows the unlink branch asks a file that answers EPERM once more after
 * a short wait. If the same project is closed and reopened, and the file
 * watched again, inside that wait, the old watch's verdict must not reach the
 * new one: no `ended` error to the new watch's window, and the new watch stays
 * live in main. Single-file watches are fake chokidar; `stat` and `realpath`
 * answer from a small disk model so the Windows answer can be played on any
 * host. Module-scope mocks, hence a file of its own.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const harness = vi.hoisted(() => ({
  sends: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  fileWatchers: [] as Array<{ path: string; handlers: Map<string, (...args: unknown[]) => void> }>,
  /** Path -> 'present' or the errno code `stat` / `realpath` fail with; absent means ENOENT. */
  disk: new Map<string, string>(),
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

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

vi.mock('./LoggingService', () => ({ logger: harness.logger }))

import chokidar from 'chokidar'
import { FileWatcherService } from './FileWatcherService'
import { UNREADABLE_RECHECK_MS } from './watcher/pathPresence'

const ROOT = path.resolve(path.sep, 'work', 'proj')
const FILE = path.join(ROOT, 'docs', 'open.md')
const webContents = { id: 1 } as unknown as WebContents
/** The atomic-save window before the detector asks the disk. */
const DETECTOR_DELAY_MS = 100
const HOST_PLATFORM = process.platform

let fws: FileWatcherService

beforeEach(async () => {
  vi.useFakeTimers()
  harness.sends.length = 0
  harness.fileWatchers.length = 0
  harness.disk.clear()
  harness.disk.set(ROOT, 'present')
  harness.disk.set(FILE, 'present')
  vi.mocked(chokidar.watch).mockClear()

  fws = new FileWatcherService()
  fws.setProjectPath(ROOT)
  await fws.watchFile(FILE, webContents)
  harness.sends.length = 0
})

afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: HOST_PLATFORM, configurable: true })
  await fws.dispose()
  vi.useRealTimers()
})

describe('a path watched again during the old watch’s unlink re-check', () => {
  it('sends no ended error to the new watch, which stays live', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    // The file answers EPERM: the detector's two looks both say "being deleted",
    // then the unlink branch takes its own first look and waits for a second
    harness.disk.set(FILE, 'EPERM')
    harness.fileWatchers[0].handlers.get('unlink')?.()
    await vi.advanceTimersByTimeAsync(DETECTOR_DELAY_MS + UNREADABLE_RECHECK_MS + UNREADABLE_RECHECK_MS / 2)

    // Inside that wait: the same project is closed and reopened, and the file,
    // back on disk, is watched again
    await fws.stopAll()
    fws.setProjectPath(ROOT)
    harness.disk.set(FILE, 'present')
    await fws.watchFile(FILE, webContents)
    expect(chokidar.watch).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS * 4)

    // The old watch's verdict reached nobody, and nothing re-armed it
    expect(harness.sends.filter(s => s.channel === 'file-watch:error')).toEqual([])
    expect(harness.sends.filter(s => s.channel === 'file-watch:deleted')).toEqual([])
    expect(chokidar.watch).toHaveBeenCalledTimes(2)

    // The new watch is still held and still reports a change
    expect(fws.getStats().totalWatched).toBe(1)
    harness.fileWatchers[1].handlers.get('change')?.()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(harness.sends).toEqual([{ channel: 'file-watch:changed', payload: { filePath: FILE } }])
  })
})

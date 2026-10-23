// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Open files the project watcher cannot speak for (#252).
 *
 * Renaming `.github` while `.github/workflows/ci.yml` was open gave no
 * "deleted" banner: the project watcher filters that folder out, and a
 * single-file watch hears nothing when a folder above the file goes away.
 * `watchUnseenFiles` re-checks such files on a timer; `checkWatchedFilesUnder`
 * re-checks every file under a watch root that lost removals while paused.
 *
 * Real files in `os.tmpdir()`. The rename case uses the real chokidar watch;
 * the others seed watch entries with fake watchers, so no file handle is held
 * and nothing but the code under test can call the unlink branch. Only
 * Electron is mocked, at module scope - hence a file of its own. Waits are
 * condition-based polls, never fixed sleeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { WebContents } from 'electron'
import { SubscriberCounter } from './watcher/SubscriberCounter'

const sends = vi.hoisted(() => [] as Array<{ channel: string; payload: Record<string, unknown> }>)

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
          send: (channel: string, payload: Record<string, unknown>) => sends.push({ channel, payload })
        }
      }
    ])
  }
}))

import { FileWatcherService } from './FileWatcherService'
import { UNSEEN_PROBE_INTERVAL_MS } from './watcher/unseenWatchProbe'

/** Probe interval, the 100 ms atomic-save window and the existence re-check, with CI headroom. */
const EVENT_BUDGET_MS = UNSEEN_PROBE_INTERVAL_MS + 6_000
const webContents = { id: 1 } as unknown as WebContents

interface ServiceInternals {
  watchedFiles: Map<string, unknown>
  switchVersion: number
  handleFileDeleted: (filePath: string) => void
}

describe('FileWatcherService – files the project watcher cannot see (#252)', () => {
  let root: string
  let svc: FileWatcherService

  beforeEach(async () => {
    sends.length = 0
    root = await realpath(await mkdtemp(join(tmpdir(), 'erfana-unseen-')))
    await mkdir(join(root, '.github', 'workflows'), { recursive: true })
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci')
    await writeFile(join(root, 'docs', 'open.md'), '# open')
    await writeFile(join(root, 'docs', 'kept.md'), '# kept')
    svc = new FileWatcherService()
    svc.setProjectPath(root)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await svc.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const internals = (): ServiceInternals => svc as unknown as ServiceInternals
  const deleted = (): string[] =>
    sends.filter(s => s.channel === 'file-watch:deleted').map(s => String(s.payload.filePath))

  /** A watch entry with a fake watcher: no handle, no event of its own. */
  function seedWatch(filePath: string): void {
    internals().watchedFiles.set(filePath, {
      filePath,
      watcher: { close: vi.fn(async () => {}) },
      subscribers: SubscriberCounter.from([webContents.id]),
      isPaused: false,
      debounceTimer: null,
      version: internals().switchVersion
    })
  }

  // Windows refuses to rename a folder while a watch holds a handle inside it (EPERM),
  // so this real-fs rename needs a POSIX host.
  it.skipIf(process.platform === 'win32')(
    'marks an open file deleted when a filtered-out folder above it is renamed',
    async () => {
      const ci = join(root, '.github', 'workflows', 'ci.yml')
      svc.watchUnseenFiles(() => false)
      await svc.watchFile(ci, webContents)

      await rename(join(root, '.github'), join(root, '.github2'))

      await vi.waitFor(() => expect(deleted()).toEqual([ci]), { timeout: EVENT_BUDGET_MS })
      expect(svc.getStats().totalWatched).toBe(0)
    }
  )

  it('leaves a file the project watcher covers to the project watcher', async () => {
    const covered = join(root, 'docs', 'gone-covered.md')
    const unseen = join(root, '.github', 'workflows', 'gone-unseen.yml')
    // Both are missing on disk; the covered one comes first in the round
    seedWatch(covered)
    seedWatch(unseen)
    const handleFileDeleted = vi.spyOn(internals(), 'handleFileDeleted')

    svc.watchUnseenFiles(filePath => filePath === covered)

    await vi.waitFor(() => expect(handleFileDeleted).toHaveBeenCalledWith(unseen), {
      timeout: EVENT_BUDGET_MS
    })
    expect(handleFileDeleted).not.toHaveBeenCalledWith(covered)
  })

  it('re-checks every watched file under a root that lost removals, and only those', async () => {
    const open = join(root, 'docs', 'open.md')
    const kept = join(root, 'docs', 'kept.md')
    const elsewhere = join(root, 'other', 'gone.md')
    seedWatch(open)
    seedWatch(kept)
    seedWatch(elsewhere)
    await rm(open)
    const handleFileDeleted = vi.spyOn(internals(), 'handleFileDeleted')

    await svc.checkWatchedFilesUnder(join(root, 'docs'))

    expect(handleFileDeleted.mock.calls).toEqual([[open]])
  })

  it('checks nothing once disposed', async () => {
    seedWatch(join(root, 'docs', 'gone.md'))
    const handleFileDeleted = vi.spyOn(internals(), 'handleFileDeleted')
    await svc.dispose()

    await svc.checkWatchedFilesUnder(root)

    expect(handleFileDeleted).not.toHaveBeenCalled()
  })

  it('arms the probe for files already watched, and stops it on dispose', async () => {
    vi.useFakeTimers()
    seedWatch(join(root, 'docs', 'open.md'))

    svc.watchUnseenFiles(() => false)
    expect(vi.getTimerCount()).toBe(1)

    await svc.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces an earlier probe instead of running two', () => {
    vi.useFakeTimers()
    seedWatch(join(root, 'docs', 'open.md'))

    svc.watchUnseenFiles(() => false)
    svc.watchUnseenFiles(() => true)

    expect(vi.getTimerCount()).toBe(1)
  })
})

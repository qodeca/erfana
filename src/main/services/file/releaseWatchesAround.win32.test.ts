// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The project tree's Delete with Erfana's own watch handles released (#486),
 * on Windows, with real `fs.watch` handles: a folder holding a file open in a
 * tab (a `FileWatcherService` watch) and a hidden subfolder (which makes the
 * native directory watcher watch the folder's children one by one) probes in
 * use while those handles are open – the platform fact `entryProbe.test.ts`
 * pins – and probes free and moves once they are released. The open file then
 * ends deleted. A handle another program holds (a process's working folder)
 * is not Erfana's and still answers in use.
 *
 * Electron is mocked at module scope, hence a file of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, shell: { trashItem: vi.fn() } }))

import { FileWatcherService } from '../FileWatcherService'
import { NativeRecursiveWatcher } from '../watcher/NativeRecursiveWatcher'
import { ReleasableWatchHandles } from '../watcher/releasableWatchHandles'
import { testSession } from '../watcher/__test__/testSession'
import type { WatchEvent } from '../../../shared/freshness/freshnessTypes'
import { probeEntryAccess } from './entryProbe'
import { releasingWatches, type WatchHandleOwner } from './releaseWatchesAround'

const isHidden = (rel: string): boolean => rel.split('/').some((segment) => segment.startsWith('.'))

describe.runIf(process.platform === 'win32')('Windows: a delete with Erfana’s watch handles released (#486)', () => {
  let base: string
  let docs: string
  let files: FileWatcherService
  let directory: NativeRecursiveWatcher
  let handles: ReleasableWatchHandles
  let owners: WatchHandleOwner[]
  const events: WatchEvent[] = []
  const closers: Array<() => void> = []

  beforeEach(async () => {
    events.length = 0
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-release-')))
    docs = path.join(base, 'docs')
    mkdirSync(path.join(docs, 'deep'), { recursive: true })
    mkdirSync(path.join(docs, '.hidden'))
    writeFileSync(path.join(docs, 'deep', 'open.md'), '# open')

    // The tab's watch on a file below the folder
    files = new FileWatcherService({ session: testSession(base, false) })
    const reply = await files.subscribe({
      owner: { kind: 'process', ownerId: 'tab', onEvent: (event) => events.push(event) },
      watchId: 'w1',
      filePath: path.join(docs, 'deep', 'open.md'),
      profile: 'editor'
    })
    expect(reply.status).toBe('started')

    // The project watcher: the hidden subfolder splits `docs`, so `docs/deep` gets a handle of its own
    handles = new ReleasableWatchHandles()
    directory = new NativeRecursiveWatcher(base, {
      shouldDrop: isHidden,
      splitPaths: ['docs/.hidden'],
      caseSensitive: false,
      fsWatch: handles.fsWatch
    })
    await new Promise<void>((resolve) => directory.once('ready', () => resolve()))
    expect(handles.openBelow(docs, false)).toBeGreaterThan(0)

    owners = [
      files,
      {
        releaseUnder: async (realPath) => {
          const end = handles.releaseBelow(realPath, false)
          return async () => end()
        }
      }
    ]
  })

  afterEach(async () => {
    for (const close of closers.splice(0)) close()
    await directory.close()
    await files.dispose()
    await vi.waitFor(() => rmSync(base, { recursive: true, force: true }), { timeout: 5000, interval: 100 })
  })

  it('with the handles open, the folder probes in use – and releasing either watcher alone is not enough', async () => {
    await expect(probeEntryAccess(docs)).resolves.toBe('in-use')
    for (const owner of owners) {
      let access: string | undefined
      await releasingWatches(async (entry) => {
        access = await probeEntryAccess(entry)
      }, [owner])(docs)
      expect(access).toBe('in-use')
    }
  })

  it('with them released, the folder probes free, moves away, and the open file ends deleted', async () => {
    const probe = releasingWatches(async (entry) => {
      expect(files.openHandlesUnder(entry) + handles.openBelow(entry, false)).toBe(0)
      await expect(probeEntryAccess(entry)).resolves.toBe('free')
    }, owners)
    await probe(docs)

    // The trash stand-in: the Recycle Bin moves a folder by renaming it
    const trash = releasingWatches((entry) => rename(entry, path.join(base, 'trashed')), owners)
    await trash(docs)

    expect(events.map((event) => event.kind)).toEqual(['restarted', 'deleted'])
    expect(files.getStats().totalWatched).toBe(0)
  })

  it('a folder another program holds still probes in use, and every watch follows again after', async () => {
    const child: ChildProcess = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      cwd: path.join(docs, 'deep'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore'
    })
    closers.push(() => child.kill())
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve())
      child.once('error', reject)
    })

    let access: string | undefined
    await releasingWatches(async (entry) => {
      access = await probeEntryAccess(entry)
    }, owners)(docs)

    expect(access).toBe('in-use')
    expect(events.map((event) => event.kind)).toEqual(['restarted'])
    expect(files.openHandlesUnder(docs)).toBe(1)
    expect(handles.openBelow(docs, false)).toBeGreaterThan(0)
  })
})

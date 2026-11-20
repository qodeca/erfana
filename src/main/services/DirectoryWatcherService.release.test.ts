// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * DirectoryWatcherService lets go of its native handles below a folder while
 * the project tree deletes it (#486), through the service: the `fsWatch` the
 * native watcher is built with, `releaseUnder` and `openHandlesUnder`.
 *
 * `NativeRecursiveWatcher` is a fake that records its options (the pattern of
 * `DirectoryWatcherService.native.test.ts`; a separate file so the mocks stay
 * at module scope), and the test opens a real `fs.watch` handle on a real
 * hidden-style subfolder through the `fsWatch` the service handed it – as the
 * real watcher does for a split folder (a `.git` or `node_modules` below). If
 * that wiring broke, every such folder would answer "in use" on Windows; the
 * handle-level rules are in `watcher/releasableWatchHandles.test.ts`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { NativeRecursiveWatcherOptions, NativeWatchHandle } from './watcher'

interface FakeNative {
  readonly root: string
  readonly options: NativeRecursiveWatcherOptions
}

const harness = vi.hoisted(() => ({ natives: [] as FakeNative[] }))

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

    constructor(
      readonly root: string,
      readonly options: NativeRecursiveWatcherOptions
    ) {
      super()
      harness.natives.push(this)
    }
  }
  return { NativeRecursiveWatcher: FakeNativeRecursiveWatcher }
})

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  webContents: { getAllWebContents: vi.fn(() => [{ id: 1, isDestroyed: () => false }]) }
}))

vi.mock('./SettingsService', () => ({
  settingsService: { getDirectoryWatchDepth: vi.fn(async () => undefined) }
}))

vi.mock('../utils/pathSecurity', () => ({ isSystemDirectory: vi.fn(() => false) }))

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { DirectoryWatcherService } from './DirectoryWatcherService'

const webContents = { id: 1 } as unknown as WebContents

function latestNative(): FakeNative {
  const native = harness.natives.at(-1)
  if (!native) throw new Error('no native watcher was constructed')
  return native
}

describe('DirectoryWatcherService release of native handles below a folder (#486)', () => {
  let base: string
  let docs: string
  let deep: string
  let svc: DirectoryWatcherService
  const handles: NativeWatchHandle[] = []

  beforeEach(() => {
    harness.natives.length = 0
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-dwrelease-')))
    docs = path.join(base, 'docs')
    deep = path.join(docs, 'deep')
    mkdirSync(deep, { recursive: true })
    svc = new DirectoryWatcherService({ backend: 'native-recursive' })
    svc.setProjectPath(base)
  })

  afterEach(async () => {
    for (const handle of handles.splice(0)) handle.close()
    await svc.dispose()
    vi.restoreAllMocks()
    rmSync(base, { recursive: true, force: true })
  })

  /** Open a real handle on `docs/deep` through the `fsWatch` the service built the watcher with. */
  async function watchDeep(listener: (eventType: string, filename: string | null) => void): Promise<void> {
    await svc.watchDirectory(base, webContents)
    const { fsWatch } = latestNative().options
    if (!fsWatch) throw new Error('the native watcher was built without the releasable fsWatch')
    handles.push(fsWatch(deep, { recursive: true, persistent: false }, listener))
  }

  it('closes the handle strictly below the folder during the release and opens it again after', async () => {
    const listener = vi.fn()
    await watchDeep(listener)
    expect(svc.openHandlesUnder(docs)).toBe(1)

    const rearm = await svc.releaseUnder(docs)
    expect(svc.openHandlesUnder(docs)).toBe(0)
    expect(svc.openHandlesUnder(deep)).toBe(0) // strictly below: nothing under deep itself either

    await rearm()
    expect(svc.openHandlesUnder(docs)).toBe(1)
    // Nothing in the folder was heard meanwhile, so the watcher is told to re-list
    expect(listener).toHaveBeenCalledWith('rename', null)
  })

  it('keeps a handle on the released folder itself, so its own removal is still heard', async () => {
    await watchDeep(vi.fn())

    const rearm = await svc.releaseUnder(deep)
    expect(svc.openHandlesUnder(docs)).toBe(1)

    await rearm()
    expect(svc.openHandlesUnder(docs)).toBe(1)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DirectoryWatcherService removal listeners (save after a folder rename).
 *
 * A single-file chokidar watch hears nothing when its parent folder is renamed
 * away, so `FileWatcherService` learns about it from the project watcher's
 * removals. These tests pin the hand-off on both backends: a native
 * `unlinkDir` and a chokidar `unlinkDir` each reach `onPathsRemoved` with the
 * absolute path, after coalescing and in the same flush as the broadcast.
 *
 * Both watcher libraries are replaced by fakes driven by hand (module-scope
 * mocks, hence a file of its own per the test-file split policy).
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const harness = vi.hoisted(() => ({
  sends: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  natives: [] as Array<{ emit(event: string, ...args: unknown[]): boolean }>,
  chokidarHandlers: new Map<string, (p: string) => void>(),
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
  const watch = vi.fn(() => {
    const watcher = {
      on: vi.fn((event: string, listener: (p: string) => void) => {
        harness.chokidarHandlers.set(event, listener)
        return watcher
      }),
      close: vi.fn(async () => {})
    }
    return watcher
  })
  return { default: { watch }, watch }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
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
  settingsService: { getDirectoryWatchDepth: vi.fn(async () => undefined) }
}))

vi.mock('../utils/pathSecurity', () => ({ isSystemDirectory: vi.fn(() => false) }))

vi.mock('./LoggingService', () => ({ logger: harness.logger }))

import { DirectoryWatcherService } from './DirectoryWatcherService'

const ROOT = path.join(path.sep, 'work', 'proj')
const FLUSH_MS = 1000
const webContents = { id: 1 } as unknown as WebContents
const inRoot = (...segments: string[]): string => path.join(ROOT, ...segments)

function latestNative(): { emit(event: string, ...args: unknown[]): boolean } {
  const native = harness.natives.at(-1)
  if (!native) throw new Error('no native watcher was constructed')
  return native
}

describe('DirectoryWatcherService.onPathsRemoved', () => {
  const services: DirectoryWatcherService[] = []

  async function start(backend: 'native-recursive' | 'chokidar'): Promise<DirectoryWatcherService> {
    const svc = new DirectoryWatcherService({ backend })
    services.push(svc)
    svc.setProjectPath(ROOT)
    await svc.watchDirectory(ROOT, webContents)
    return svc
  }

  beforeEach(() => {
    vi.useFakeTimers()
    harness.sends.length = 0
    harness.natives.length = 0
    harness.chokidarHandlers.clear()
    harness.logger.error.mockClear()
  })

  afterEach(async () => {
    await Promise.all(services.splice(0).map(svc => svc.dispose()))
    vi.useRealTimers()
  })

  it('reports a renamed folder (native unlinkDir) with its absolute path', async () => {
    const svc = await start('native-recursive')
    const listener = vi.fn()
    svc.onPathsRemoved(listener)

    latestNative().emit('unlinkDir', inRoot('docs'))
    latestNative().emit('addDir', inRoot('docs2'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith([inRoot('docs')])
    expect(harness.sends.filter(s => s.channel === 'directory-watch:changed')).toHaveLength(1)
  })

  it('reports a renamed folder (chokidar unlinkDir) with its absolute path', async () => {
    const svc = await start('chokidar')
    const listener = vi.fn()
    svc.onPathsRemoved(listener)

    harness.chokidarHandlers.get('unlinkDir')?.(inRoot('docs'))
    harness.chokidarHandlers.get('addDir')?.(inRoot('docs2'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).toHaveBeenCalledWith([inRoot('docs')])
  })

  it('reports a file unlink, and coalesces a deleted folder’s children into the folder', async () => {
    const svc = await start('native-recursive')
    const listener = vi.fn()
    svc.onPathsRemoved(listener)

    latestNative().emit('unlink', inRoot('docs', 'open.md'))
    latestNative().emit('unlinkDir', inRoot('docs'))
    latestNative().emit('unlink', inRoot('top.md'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).toHaveBeenCalledTimes(1)
    const removed = listener.mock.calls[0][0] as string[]
    expect(removed).toContain(inRoot('docs'))
    expect(removed).toContain(inRoot('top.md'))
  })

  it('stays quiet for a batch with no removals', async () => {
    const svc = await start('native-recursive')
    const listener = vi.fn()
    svc.onPathsRemoved(listener)

    latestNative().emit('add', inRoot('new.md'))
    latestNative().emit('change', inRoot('old.md'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).not.toHaveBeenCalled()
    expect(harness.sends).toHaveLength(1)
  })

  it('stops reporting once unsubscribed', async () => {
    const svc = await start('native-recursive')
    const listener = vi.fn()
    const unsubscribe = svc.onPathsRemoved(listener)
    unsubscribe()

    latestNative().emit('unlinkDir', inRoot('docs'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).not.toHaveBeenCalled()
  })

  it('logs a throwing listener and still runs the others and the broadcast', async () => {
    const svc = await start('native-recursive')
    const second = vi.fn()
    svc.onPathsRemoved(() => {
      throw new Error('boom')
    })
    svc.onPathsRemoved(second)

    latestNative().emit('unlinkDir', inRoot('docs'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(second).toHaveBeenCalledWith([inRoot('docs')])
    expect(harness.logger.error).toHaveBeenCalledWith('Directory removal listener failed', expect.any(Error))
    expect(harness.sends.filter(s => s.channel === 'directory-watch:changed')).toHaveLength(1)
  })
})

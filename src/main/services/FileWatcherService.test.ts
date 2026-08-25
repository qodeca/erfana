// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SubscriberCounter } from './watcher/SubscriberCounter'

// Capture sends
const sends: Array<{ id: number; channel: string; payload: any }> = []

vi.mock('electron', () => {
  const mkWin = (id: number) => ({
    isDestroyed: () => false,
    webContents: { id, send: (ch: string, p: any) => sends.push({ id, channel: ch, payload: p }) }
  })
  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => [mkWin(1)])
    }
  }
})

describe('FileWatcherService session token guards', () => {
  beforeEach(() => {
    sends.length = 0
  })

  it('drops notifications from previous sessions', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    // Seed watched file with old version 0
    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/readme.md', {
      filePath: '/proj/readme.md',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1]),
      isPaused: false,
      debounceTimer: null,
      version: 0
    })

    // Simulate project switch bumping session
    svc.switchVersion = 1

    // Attempt to notify via private API; should be ignored due to version mismatch
    svc.notifyWebContents('/proj/readme.md', 'file-watch:changed', { filePath: '/proj/readme.md' })

    expect(sends.length).toBe(0)
  })
})

describe('FileWatcherService Issue #59 - WebContents Cleanup', () => {
  beforeEach(() => {
    sends.length = 0
  })

  it('cleanupForWebContentsId increments switchVersion BEFORE cleanup', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    // Record initial switchVersion
    const initialVersion = svc.switchVersion

    // Seed watched file
    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/file.md', {
      filePath: '/proj/file.md',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1]),
      isPaused: false,
      debounceTimer: null,
      version: initialVersion
    })

    // Call cleanupForWebContentsId
    await svc.cleanupForWebContentsId(1)

    // switchVersion should be incremented immediately (before cleanup)
    expect(svc.switchVersion).toBe(initialVersion + 1)
  })

  it('cleanupForWebContentsId removes webContentsId from watched files', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/file.md', {
      filePath: '/proj/file.md',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1, 2]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 1
    await svc.cleanupForWebContentsId(1)

    // webContentsId 1 should be removed, 2 should remain
    const watched = svc.watchedFiles.get('/proj/file.md')
    expect(watched).toBeTruthy()
    expect(watched.subscribers.has(1)).toBe(false)
    expect(watched.subscribers.has(2)).toBe(true)
  })

  it('cleanupForWebContentsId closes watchers with no remaining webContentsIds', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/file.md', {
      filePath: '/proj/file.md',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 1 (last watcher)
    await svc.cleanupForWebContentsId(1)

    // Watcher should be closed and removed
    expect(fakeWatcher.close).toHaveBeenCalled()
    expect(svc.watchedFiles.has('/proj/file.md')).toBe(false)
  })

  it('cleanupForWebContentsId clears debounce timers', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeTimer = setTimeout(() => {}, 10000) // Long timeout that should be cleared

    svc.watchedFiles.set('/proj/file.md', {
      filePath: '/proj/file.md',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1]),
      isPaused: false,
      debounceTimer: fakeTimer,
      version: svc.switchVersion
    })

    // Spy on clearTimeout
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    // Cleanup webContentsId 1
    await svc.cleanupForWebContentsId(1)

    // Timer should be cleared
    expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimer)
  })

  it('cleanupForWebContentsId handles multiple files', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    const fakeWatcher1 = { close: vi.fn(async () => {}) }
    const fakeWatcher2 = { close: vi.fn(async () => {}) }

    svc.watchedFiles.set('/proj/file1.md', {
      filePath: '/proj/file1.md',
      watcher: fakeWatcher1,
      subscribers: SubscriberCounter.from([1]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    svc.watchedFiles.set('/proj/file2.md', {
      filePath: '/proj/file2.md',
      watcher: fakeWatcher2,
      subscribers: SubscriberCounter.from([1]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 1
    await svc.cleanupForWebContentsId(1)

    // Both watchers should be closed
    expect(fakeWatcher1.close).toHaveBeenCalled()
    expect(fakeWatcher2.close).toHaveBeenCalled()
    expect(svc.watchedFiles.size).toBe(0)
  })

  it('cleanupForWebContentsId does not affect other webContentsIds', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/file.md', {
      filePath: '/proj/file.md',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1, 2, 3]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 2
    await svc.cleanupForWebContentsId(2)

    // webContentsId 2 should be removed, 1 and 3 should remain
    const watched = svc.watchedFiles.get('/proj/file.md')
    expect(watched).toBeTruthy()
    expect(watched.subscribers.has(1)).toBe(true)
    expect(watched.subscribers.has(2)).toBe(false)
    expect(watched.subscribers.has(3)).toBe(true)
    // Watcher should NOT be closed (other watchers remain)
    expect(fakeWatcher.close).not.toHaveBeenCalled()
  })

  it('cleanupForWebContentsId handles double cleanup gracefully', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/file.md', {
      filePath: '/proj/file.md',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    // First cleanup
    await svc.cleanupForWebContentsId(1)
    expect(svc.watchedFiles.has('/proj/file.md')).toBe(false)

    // Second cleanup - should not throw
    await expect(svc.cleanupForWebContentsId(1)).resolves.not.toThrow()
  })
})

describe('FileWatcherService subscriber counting (issue #70, D3)', () => {
  beforeEach(() => {
    sends.length = 0
  })

  it('keeps the watch alive when one of two consumers in the same window unsubscribes', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    // Two panels in ONE window watching one path: an image viewer and the
    // Markdown editor. Before subscriber counting the first teardown closed
    // the watcher out from under the second.
    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/icon.svg', {
      filePath: '/proj/icon.svg',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1, 1]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    await svc.unwatchFile('/proj/icon.svg', { id: 1 })

    expect(fakeWatcher.close).not.toHaveBeenCalled()
    expect(svc.watchedFiles.has('/proj/icon.svg')).toBe(true)

    // The surviving consumer still receives events
    svc.notifyWebContents('/proj/icon.svg', 'file-watch:changed', { filePath: '/proj/icon.svg' })
    expect(sends).toEqual([
      { id: 1, channel: 'file-watch:changed', payload: { filePath: '/proj/icon.svg' } }
    ])
  })

  it('closes the watch when the last consumer in the window unsubscribes', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/icon.svg', {
      filePath: '/proj/icon.svg',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1, 1]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    await svc.unwatchFile('/proj/icon.svg', { id: 1 })
    await svc.unwatchFile('/proj/icon.svg', { id: 1 })

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1)
    expect(svc.watchedFiles.has('/proj/icon.svg')).toBe(false)
  })

  it('destroying a webContents drops all its subscriptions at once', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    // A destroyed window cannot release its subscriptions one by one, so the
    // cleanup path must remove the id outright rather than decrement it.
    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/icon.svg', {
      filePath: '/proj/icon.svg',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1, 1, 1]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    await svc.cleanupForWebContentsId(1)

    expect(fakeWatcher.close).toHaveBeenCalled()
    expect(svc.watchedFiles.has('/proj/icon.svg')).toBe(false)
  })

  it('reports one watcher per window in getStats, not one per subscription', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService
    svc.watchedFiles.clear()

    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/icon.svg', {
      filePath: '/proj/icon.svg',
      watcher: fakeWatcher,
      subscribers: SubscriberCounter.from([1, 1, 2]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    expect(svc.getStats()).toEqual({
      totalWatched: 1,
      fileDetails: [{ path: '/proj/icon.svg', watchers: 2 }]
    })
  })
})

describe('FileWatcherService watch cap (issue #70, arch H1)', () => {
  /** Seed a watched entry the service will treat as live. */
  const seed = (svc: any, filePath: string, ids: number[]) => {
    const watcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set(filePath, {
      filePath,
      watcher,
      subscribers: SubscriberCounter.from(ids),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })
    return watcher
  }

  it('lets a second consumer join a watched path with the map at capacity', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'erfana-watch-cap-'))
    const file = join(dir, 'icon.svg')
    const other = join(dir, 'other.svg')
    writeFileSync(file, '<svg/>')
    writeFileSync(other, '<svg/>')

    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService
    svc.watchedFiles.clear()

    // One real watch plus filler up to MAX_WATCHED_FILES.
    const watcher = seed(svc, file, [1])
    while (svc.watchedFiles.size < svc.MAX_WATCHED_FILES) {
      seed(svc, `/proj/filler-${svc.watchedFiles.size}.md`, [1])
    }
    expect(svc.watchedFiles.size).toBe(svc.MAX_WATCHED_FILES)

    // A second panel in the SAME window joins the existing watch. Refusing it
    // here is what reintroduced D3: it would watch nothing, and its unmount
    // would still decrement the count to zero and close the watcher under the
    // first panel.
    await expect(svc.watchFile(file, { id: 1 })).resolves.toBeUndefined()
    expect(svc.watchedFiles.get(file).subscribers.countFor(1)).toBe(2)

    await svc.unwatchFile(file, { id: 1 })

    expect(watcher.close).not.toHaveBeenCalled()
    expect(svc.watchedFiles.has(file)).toBe(true)

    // The cap still governs a NEW entry.
    await expect(svc.watchFile(other, { id: 1 })).rejects.toThrow(
      'Maximum watched files limit reached'
    )

    svc.watchedFiles.clear()
    rmSync(dir, { recursive: true, force: true })
  })
})

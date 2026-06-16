// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
      webContentsIds: new Set([1]),
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
      webContentsIds: new Set([1]),
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
      webContentsIds: new Set([1, 2]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 1
    await svc.cleanupForWebContentsId(1)

    // webContentsId 1 should be removed, 2 should remain
    const watched = svc.watchedFiles.get('/proj/file.md')
    expect(watched).toBeTruthy()
    expect(watched.webContentsIds.has(1)).toBe(false)
    expect(watched.webContentsIds.has(2)).toBe(true)
  })

  it('cleanupForWebContentsId closes watchers with no remaining webContentsIds', async () => {
    const mod = await import('./FileWatcherService')
    const svc: any = mod.fileWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedFiles.set('/proj/file.md', {
      filePath: '/proj/file.md',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
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
      webContentsIds: new Set([1]),
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
      webContentsIds: new Set([1]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    svc.watchedFiles.set('/proj/file2.md', {
      filePath: '/proj/file2.md',
      watcher: fakeWatcher2,
      webContentsIds: new Set([1]),
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
      webContentsIds: new Set([1, 2, 3]),
      isPaused: false,
      debounceTimer: null,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 2
    await svc.cleanupForWebContentsId(2)

    // webContentsId 2 should be removed, 1 and 3 should remain
    const watched = svc.watchedFiles.get('/proj/file.md')
    expect(watched).toBeTruthy()
    expect(watched.webContentsIds.has(1)).toBe(true)
    expect(watched.webContentsIds.has(2)).toBe(false)
    expect(watched.webContentsIds.has(3)).toBe(true)
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
      webContentsIds: new Set([1]),
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



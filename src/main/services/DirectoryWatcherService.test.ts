import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PauseController } from '../utils/PauseController'
import { DebounceManager } from '../utils/DebounceManager'

// Capture sends
const sends: Array<{ id: number; channel: string; payload: any }> = []

vi.mock('electron', () => {
  const mkWin = (id: number) => ({
    isDestroyed: () => false,
    webContents: { id, send: (ch: string, p: any) => sends.push({ id, channel: ch, payload: p }) },
  })
  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => [mkWin(1)])
    }
  }
})

describe('DirectoryWatcherService ENOENT handling', () => {
  beforeEach(() => {
    sends.length = 0
  })

  it('sends project-deleted and remains recoverable (stopAll instead of dispose)', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    // Seed a fake watched directory so notifyWebContents has a target
    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      debounceManager: new DebounceManager(),
      pendingEvents: [],
      version: svc.switchVersion
    })

    // Simulate ENOENT error
    svc.handleWatcherError('/proj', 'ENOENT: no such file or directory')

    // Should notify project-deleted
    expect(sends.some(s => s.channel === 'directory-watch:project-deleted')).toBe(true)
    // stopAll clears watchedDirectories without setting isDisposing
    await new Promise((r) => setTimeout(r, 0))
    expect(svc.watchedDirectories.size).toBe(0)
    expect(svc.isDisposing).toBe(false)
  })

  it('sends generic error for non-ENOENT', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService
    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      isPaused: false,
      debounceTimer: null,
      pendingEvents: [],
      version: svc.switchVersion
    })

    svc.handleWatcherError('/proj', 'EACCES: permission denied')
    expect(sends.some(s => s.channel === 'directory-watch:error')).toBe(true)
  })
})

describe('DirectoryWatcherService session token guards', () => {
  beforeEach(() => {
    sends.length = 0
  })

  it('drops notifications from previous sessions', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    // Seed watched directory with old version 0
    const fakeWatcher = { close: vi.fn(async () => {}) }
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      isPaused: false,
      debounceTimer: null,
      pendingEvents: [],
      version: 0
    })

    // Simulate project switch bumping session
    svc.switchVersion = 1

    // Attempt to notify via private API; should be ignored due to version mismatch
    svc.notifyWebContents('/proj', 'directory-watch:changed', { dirPath: '/proj', eventCount: 1, summary: { add: 1 } })

    expect(sends.length).toBe(0)
  })
})

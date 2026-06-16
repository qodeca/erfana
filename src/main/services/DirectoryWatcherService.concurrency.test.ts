// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PauseController } from '../utils/PauseController'

// Capture sends
const sends: Array<{ id: number; channel: string; payload: any }> = []

// Mock SettingsService to prevent ElectronStore initialization
vi.mock('./SettingsService', () => ({
  settingsService: {
    getDirectoryWatchDepth: vi.fn().mockResolvedValue(undefined)
  }
}))

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

describe('DirectoryWatcherService concurrency control', () => {
  beforeEach(() => {
    sends.length = 0
  })

  it('should increment pauseCount when pause is called', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    // Seed a watched directory
    const fakeWatcher = { close: vi.fn(async () => {}) }
    const pauseController = new PauseController()
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController,
      debounceTimer: null,
      pendingEvents: [],
      version: svc.switchVersion
    })

    // Call pause
    svc.pauseWatch('/proj')

    const watched = svc.watchedDirectories.get('/proj')
    expect(watched.pauseController.getCount()).toBe(1)
    expect(watched.pauseController.isPaused()).toBe(true)
  })

  it('should increment pauseCount for nested pause calls', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const pauseController = new PauseController()
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController,
      debounceTimer: null,
      pendingEvents: [],
      version: svc.switchVersion
    })

    // Call pause multiple times (simulating concurrent operations)
    svc.pauseWatch('/proj')
    svc.pauseWatch('/proj')
    svc.pauseWatch('/proj')

    const watched = svc.watchedDirectories.get('/proj')
    expect(watched.pauseController.getCount()).toBe(3)
    expect(watched.pauseController.isPaused()).toBe(true)
  })

  it('should only resume when pauseCount reaches 0', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const pauseController = new PauseController()
    // Pre-pause 3 times
    pauseController.pause()
    pauseController.pause()
    pauseController.pause()

    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController,
      debounceTimer: null,
      pendingEvents: [],
      version: svc.switchVersion
    })

    // First resume - should still be paused
    svc.resumeWatch('/proj')
    let watched = svc.watchedDirectories.get('/proj')
    expect(watched.pauseController.getCount()).toBe(2)
    expect(watched.pauseController.isPaused()).toBe(true)

    // Second resume - should still be paused
    svc.resumeWatch('/proj')
    watched = svc.watchedDirectories.get('/proj')
    expect(watched.pauseController.getCount()).toBe(1)
    expect(watched.pauseController.isPaused()).toBe(true)

    // Third resume - should finally resume
    svc.resumeWatch('/proj')
    watched = svc.watchedDirectories.get('/proj')
    expect(watched.pauseController.getCount()).toBe(0)
    expect(watched.pauseController.isPaused()).toBe(false)
  })

  it('should not go negative on extra resume calls', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const pauseController = new PauseController()
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController,
      debounceTimer: null,
      pendingEvents: [],
      version: svc.switchVersion
    })

    // Call resume when already at 0
    svc.resumeWatch('/proj')

    const watched = svc.watchedDirectories.get('/proj')
    expect(watched.pauseController.getCount()).toBe(0) // Should not go negative
    expect(watched.pauseController.isPaused()).toBe(false)
  })

  it('should block events when paused regardless of pauseCount value', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const pauseController = new PauseController()
    // Pre-pause twice
    pauseController.pause()
    pauseController.pause()

    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController,
      debounceTimer: null,
      pendingEvents: [],
      version: svc.switchVersion
    })

    // Queue an event while paused
    svc.queueEvent('/proj', { type: 'add', path: '/proj/file.md' })

    // Give time for debounce
    await new Promise((r) => setTimeout(r, 100))

    // Should not have sent any notifications (paused)
    expect(sends.length).toBe(0)

    // Events should be ignored (not queued) when paused
    const watched = svc.watchedDirectories.get('/proj')
    expect(watched.pendingEvents.length).toBe(0)
  })

  it('should update isPaused flag when count reaches 0', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const pauseController = new PauseController()
    // Pre-pause once
    pauseController.pause()

    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController,
      debounceTimer: null,
      pendingEvents: [],
      version: svc.switchVersion
    })

    // Resume (count goes to 0)
    svc.resumeWatch('/proj')

    const watched = svc.watchedDirectories.get('/proj')
    expect(watched.pauseController.getCount()).toBe(0)
    expect(watched.pauseController.isPaused()).toBe(false)
  })
})

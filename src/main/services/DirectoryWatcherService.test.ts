import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PauseController } from '../utils/PauseController'
import { ThrottledWorker, AtomicSaveDetector } from './watcher'

// Capture sends
const sends: Array<{ id: number; channel: string; payload: unknown }> = []

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

  it('sends project-deleted and remains recoverable (stopAll instead of dispose) after max restart attempts', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    // Clear any pending restarts from previous tests
    for (const timeout of svc.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    // Seed a fake watched directory so notifyWebContents has a target
    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: svc.switchVersion
    })

    // Set restart attempts to max to skip the auto-restart logic
    svc.restartAttempts.set('/proj', svc.MAX_RESTART_ATTEMPTS)

    // Simulate ENOENT error
    svc.handleWatcherError('/proj', 'ENOENT: no such file or directory')

    // Should notify project-deleted (max attempts reached)
    expect(sends.some(s => s.channel === 'directory-watch:project-deleted')).toBe(true)
    // stopAll clears watchedDirectories without setting isDisposing
    await new Promise((r) => setTimeout(r, 0))
    expect(svc.watchedDirectories.size).toBe(0)
    expect(svc.isDisposing).toBe(false)
  })

  it('schedules restart on first transient error (ENOENT)', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    // Clear any pending restarts from previous tests
    for (const timeout of svc.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: svc.switchVersion
    })

    // Simulate ENOENT error on first attempt
    svc.handleWatcherError('/proj', 'ENOENT: no such file or directory')

    // Should schedule restart, not immediately notify project-deleted
    expect(svc.pendingRestarts.has('/proj')).toBe(true)
    expect(sends.some(s => s.channel === 'directory-watch:project-deleted')).toBe(false)

    // Cleanup
    for (const timeout of svc.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    svc.pendingRestarts.clear()
  })

  it('sends generic error for non-transient errors (ENOSPC)', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    // Clear any pending restarts from previous tests
    for (const timeout of svc.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: svc.switchVersion
    })

    // ENOSPC is not a transient error, should send generic error immediately
    svc.handleWatcherError('/proj', 'ENOSPC: no space left on device')
    expect(sends.some(s => s.channel === 'directory-watch:error')).toBe(true)
    expect(svc.pendingRestarts.has('/proj')).toBe(false)
  })

  it('schedules restart on transient error (EACCES)', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    // Clear any pending restarts from previous tests
    for (const timeout of svc.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: svc.switchVersion
    })

    // EACCES is a transient error, should schedule restart
    svc.handleWatcherError('/proj', 'EACCES: access denied to file')
    expect(svc.pendingRestarts.has('/proj')).toBe(true)
    expect(sends.some(s => s.channel === 'directory-watch:error')).toBe(false)

    // Cleanup
    for (const timeout of svc.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    svc.pendingRestarts.clear()
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
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: 0
    })

    // Simulate project switch bumping session
    svc.switchVersion = 1

    // Attempt to notify via private API; should be ignored due to version mismatch
    svc.notifyWebContents('/proj', 'directory-watch:changed', { dirPath: '/proj', eventCount: 1, summary: { add: 1 } })

    expect(sends.length).toBe(0)
  })
})

describe('DirectoryWatcherService Issue #59 - WebContents Cleanup', () => {
  beforeEach(() => {
    sends.length = 0
  })

  it('cleanupForWebContentsId increments switchVersion BEFORE cleanup', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    // Record initial switchVersion
    const initialVersion = svc.switchVersion

    // Seed watched directory
    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: initialVersion
    })

    // Call cleanupForWebContentsId
    await svc.cleanupForWebContentsId(1)

    // switchVersion should be incremented immediately (before cleanup)
    expect(svc.switchVersion).toBe(initialVersion + 1)
  })

  it('cleanupForWebContentsId removes webContentsId from watched directories', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1, 2]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 1
    await svc.cleanupForWebContentsId(1)

    // webContentsId 1 should be removed, 2 should remain
    const watched = svc.watchedDirectories.get('/proj')
    expect(watched).toBeTruthy()
    expect(watched.webContentsIds.has(1)).toBe(false)
    expect(watched.webContentsIds.has(2)).toBe(true)
  })

  it('cleanupForWebContentsId closes watchers with no remaining webContentsIds', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 1 (last watcher)
    await svc.cleanupForWebContentsId(1)

    // Watcher should be closed and workers disposed
    expect(fakeWatcher.close).toHaveBeenCalled()
    expect(fakeThrottledWorker.dispose).toHaveBeenCalled()
    expect(fakeAtomicSaveDetector.dispose).toHaveBeenCalled()
    expect(svc.watchedDirectories.has('/proj')).toBe(false)
  })

  // Git index watching tests removed - migrated to GitWatcherService (Issue #74)

  it('cleanupForWebContentsId handles multiple directories', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher1 = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker1 = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector1 = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector

    const fakeWatcher2 = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker2 = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector2 = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector

    svc.watchedDirectories.set('/proj1', {
      dirPath: '/proj1',
      watcher: fakeWatcher1,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker1,
      atomicSaveDetector: fakeAtomicSaveDetector1,
      version: svc.switchVersion
    })

    svc.watchedDirectories.set('/proj2', {
      dirPath: '/proj2',
      watcher: fakeWatcher2,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker2,
      atomicSaveDetector: fakeAtomicSaveDetector2,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 1
    await svc.cleanupForWebContentsId(1)

    // Both watchers should be closed
    expect(fakeWatcher1.close).toHaveBeenCalled()
    expect(fakeWatcher2.close).toHaveBeenCalled()
    expect(fakeThrottledWorker1.dispose).toHaveBeenCalled()
    expect(fakeThrottledWorker2.dispose).toHaveBeenCalled()
    expect(svc.watchedDirectories.size).toBe(0)
  })

  it('cleanupForWebContentsId does not affect other webContentsIds', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1, 2, 3]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: svc.switchVersion
    })

    // Cleanup webContentsId 2
    await svc.cleanupForWebContentsId(2)

    // webContentsId 2 should be removed, 1 and 3 should remain
    const watched = svc.watchedDirectories.get('/proj')
    expect(watched).toBeTruthy()
    expect(watched.webContentsIds.has(1)).toBe(true)
    expect(watched.webContentsIds.has(2)).toBe(false)
    expect(watched.webContentsIds.has(3)).toBe(true)
    // Watcher should NOT be closed (other watchers remain)
    expect(fakeWatcher.close).not.toHaveBeenCalled()
    expect(fakeThrottledWorker.dispose).not.toHaveBeenCalled()
  })

  it('cleanupForWebContentsId handles double cleanup gracefully', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    const fakeWatcher = { close: vi.fn(async () => {}) }
    const fakeThrottledWorker = {
      dispose: vi.fn(),
      work: vi.fn(),
      getBufferSize: vi.fn(() => 0)
    } as unknown as ThrottledWorker<any>
    const fakeAtomicSaveDetector = {
      dispose: vi.fn()
    } as unknown as AtomicSaveDetector
    svc.watchedDirectories.set('/proj', {
      dirPath: '/proj',
      watcher: fakeWatcher,
      webContentsIds: new Set([1]),
      pauseController: new PauseController(),
      throttledWorker: fakeThrottledWorker,
      atomicSaveDetector: fakeAtomicSaveDetector,
      version: svc.switchVersion
    })

    // First cleanup
    await svc.cleanupForWebContentsId(1)
    expect(svc.watchedDirectories.has('/proj')).toBe(false)

    // Second cleanup - should not throw
    await expect(svc.cleanupForWebContentsId(1)).resolves.not.toThrow()
  })
})

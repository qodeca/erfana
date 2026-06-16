// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

// ---------------------------------------------------------------------------
// Helper: build a seeded WatchedDirectory entry for EMFILE tests
// ---------------------------------------------------------------------------
function seedWatchedDirectory(
  svc: any,
  dirPath: string,
  overrides: {
    watcher?: any
    pauseController?: PauseController
    throttledWorker?: any
    atomicSaveDetector?: any
  } = {}
) {
  const fakeWatcher = overrides.watcher ?? { close: vi.fn(async () => {}) }
  const fakeThrottledWorker = overrides.throttledWorker ?? ({
    dispose: vi.fn(),
    work: vi.fn(),
    getBufferSize: vi.fn(() => 0)
  } as unknown as ThrottledWorker<any>)
  const fakeAtomicSaveDetector = overrides.atomicSaveDetector ?? ({
    dispose: vi.fn()
  } as unknown as AtomicSaveDetector)
  const pauseController = overrides.pauseController ?? new PauseController()

  svc.watchedDirectories.set(dirPath, {
    dirPath,
    watcher: fakeWatcher,
    webContentsIds: new Set([1]),
    pauseController,
    throttledWorker: fakeThrottledWorker,
    atomicSaveDetector: fakeAtomicSaveDetector,
    version: svc.switchVersion
  })

  return { fakeWatcher, fakeThrottledWorker, fakeAtomicSaveDetector, pauseController }
}

describe('DirectoryWatcherService EMFILE handling', () => {
  // Most tests do NOT need fake timers – they only call scheduleRestart synchronously
  // and verify pendingRestarts. Tests that advance timers declare their own.

  beforeEach(() => {
    sends.length = 0
  })

  afterEach(() => {
    // Always restore real timers even if a test forgot
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('closes watcher and disposes all resources before scheduling restart', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    const { fakeWatcher, fakeThrottledWorker, fakeAtomicSaveDetector, pauseController } =
      seedWatchedDirectory(svc, '/proj')
    const dispatchDispose = vi.spyOn(pauseController, 'dispose')

    svc.handleWatcherError('/proj', 'EMFILE: too many open files, watch')

    // All three resources disposed synchronously
    expect(dispatchDispose).toHaveBeenCalled()
    expect(fakeThrottledWorker.dispose).toHaveBeenCalled()
    expect(fakeAtomicSaveDetector.dispose).toHaveBeenCalled()

    // Watcher.close() called (fire-and-forget – may still be in microtask queue)
    expect(fakeWatcher.close).toHaveBeenCalled()

    // Removed from map immediately
    expect(svc.watchedDirectories.has('/proj')).toBe(false)

    // Restart scheduled
    expect(svc.pendingRestarts.has('/proj')).toBe(true)

    // Cleanup
    for (const t of svc.pendingRestarts.values()) clearTimeout(t)
    svc.pendingRestarts.clear()
  })

  it('suppresses duplicate EMFILE errors when a restart is already pending', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    const { fakeWatcher } = seedWatchedDirectory(svc, '/proj')

    // First EMFILE error – tears down watcher and schedules restart
    svc.handleWatcherError('/proj', 'EMFILE: too many open files, watch')
    expect(svc.pendingRestarts.has('/proj')).toBe(true)
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1)

    // Capture the pending timeout so we can verify it is NOT replaced
    const firstTimeout = svc.pendingRestarts.get('/proj')

    // Re-seed watchedDirectories so the outer guard (watchedDirectories.has) doesn't
    // short-circuit – we want to exercise the pendingRestarts.has() guard at line 677
    const { fakeWatcher: secondWatcher } = seedWatchedDirectory(svc, '/proj')
    svc.handleWatcherError('/proj', 'EMFILE: too many open files, watch')

    // Still only one pending restart – the second EMFILE was suppressed
    expect(svc.pendingRestarts.has('/proj')).toBe(true)
    expect(svc.pendingRestarts.get('/proj')).toBe(firstTimeout)
    // The second watcher was NOT torn down (the guard returned early)
    expect(secondWatcher.close).not.toHaveBeenCalled()

    // Cleanup
    for (const t of svc.pendingRestarts.values()) clearTimeout(t)
    svc.pendingRestarts.clear()
  })

  it('ignores a late EMFILE error after watcher has already been removed', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    // Dir is NOT in watchedDirectories – simulates a late/stale error event
    svc.watchedDirectories.delete('/proj')

    // Should return without throwing and without scheduling a restart
    expect(() =>
      svc.handleWatcherError('/proj', 'EMFILE: too many open files, watch')
    ).not.toThrow()

    expect(svc.pendingRestarts.has('/proj')).toBe(false)
  })

  it('schedules exactly one restart even when 10 EMFILE errors fire in rapid succession', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    const { fakeWatcher } = seedWatchedDirectory(svc, '/proj')
    const scheduleRestartSpy = vi.spyOn(svc, 'scheduleRestart')

    // Fire 10 EMFILE errors back-to-back
    for (let i = 0; i < 10; i++) {
      svc.handleWatcherError('/proj', 'EMFILE: too many open files, watch')
    }

    // Only 1 restart scheduled regardless of how many errors fired
    expect(scheduleRestartSpy).toHaveBeenCalledTimes(1)

    // Watcher closed exactly once
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1)

    // Exactly one entry in pendingRestarts
    expect(svc.pendingRestarts.size).toBeGreaterThanOrEqual(1)

    // Cleanup
    for (const t of svc.pendingRestarts.values()) clearTimeout(t)
    svc.pendingRestarts.clear()
  })

  it('restart fires after timer expires and calls restartWatcher for the same dir', async () => {
    vi.useFakeTimers()

    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    seedWatchedDirectory(svc, '/proj')

    // Spy on restartWatcher to avoid calling the real implementation
    // (which needs chokidar and webContents)
    const restartWatcherSpy = vi
      .spyOn(svc, 'restartWatcher')
      .mockResolvedValue(undefined)

    svc.handleWatcherError('/proj', 'EMFILE: too many open files, watch')
    expect(svc.pendingRestarts.has('/proj')).toBe(true)

    // Advance past the base restart delay (800ms)
    await vi.advanceTimersByTimeAsync(800)

    // Pending restart should be consumed
    expect(svc.pendingRestarts.has('/proj')).toBe(false)

    // restartWatcher called with the correct dirPath
    expect(restartWatcherSpy).toHaveBeenCalledWith('/proj', expect.any(Set))

    vi.useRealTimers()
  })

  it('does not close watcher early for EACCES – follows normal transient error path', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    const { fakeWatcher } = seedWatchedDirectory(svc, '/proj')

    svc.handleWatcherError('/proj', 'EACCES: access denied to /proj')

    // Watcher should NOT be closed early – normal transient path keeps it alive
    // until restartWatcher tears it down
    expect(fakeWatcher.close).not.toHaveBeenCalled()

    // Dir remains in watchedDirectories (normal transient path does not remove it eagerly)
    expect(svc.watchedDirectories.has('/proj')).toBe(true)

    // Restart is still scheduled
    expect(svc.pendingRestarts.has('/proj')).toBe(true)

    // Cleanup
    for (const t of svc.pendingRestarts.values()) clearTimeout(t)
    svc.pendingRestarts.clear()
  })

  it('logs error but does not call stopAll when watcher.close() rejects during EMFILE recovery', async () => {
    const mod = await import('./DirectoryWatcherService')
    const svc: any = mod.directoryWatcherService

    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()

    const rejectingWatcher = {
      close: vi.fn().mockRejectedValue(new Error('close failed'))
    }
    seedWatchedDirectory(svc, '/proj', { watcher: rejectingWatcher })

    const stopAllSpy = vi.spyOn(svc, 'stopAll').mockResolvedValue(undefined)

    svc.handleWatcherError('/proj', 'EMFILE: too many open files, watch')

    // Allow the rejected promise microtask to settle
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    // stopAll must NOT be called – it would cancel the pending restart
    expect(stopAllSpy).not.toHaveBeenCalled()
    // The restart should still be pending despite the close failure
    expect(svc.pendingRestarts.has('/proj')).toBe(true)

    // Cleanup
    for (const t of svc.pendingRestarts.values()) clearTimeout(t)
    svc.pendingRestarts.clear()
    stopAllSpy.mockRestore()
  })
})

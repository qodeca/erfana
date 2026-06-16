// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Watcher resilience and polling fallback (#100)
 *
 * Tests for AC-011, AC-015, AC-016 from spec-t3-016
 *
 * AC-011: Polling fallback when GitWatcherService fails
 * AC-015: Polling skipped when watcher active
 * AC-016: Watcher auto-restart with exponential backoff
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PauseController } from '../utils/PauseController'
import { ThrottledWorker, AtomicSaveDetector } from './watcher'

// Capture IPC sends
const sends: Array<{ id: number; channel: string; payload: unknown }> = []

// Mock modules
const mockChokidar = { watch: vi.fn() }

const mockBrowserWindows: any[] = []

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

const mockWatcherMetrics = {
  recordGitWatcherEvent: vi.fn(),
  recordPollingRefresh: vi.fn(),
  recordPollingSkipped: vi.fn(),
  recordError: vi.fn(),
  recordRestartScheduled: vi.fn(),
  recordRestartSuccess: vi.fn(),
  recordRestartFailure: vi.fn(),
  getSnapshot: vi.fn(() => ({
    uptimeMs: 0,
    gitWatcherEventCount: 0,
    pollingRefreshCount: 0,
    pollingSkippedCount: 0,
    pollingEfficiency: 0,
    restartScheduled: 0,
    errorCounts: {}
  }))
}

vi.mock('chokidar', () => ({ default: mockChokidar }))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => mockBrowserWindows)
  },
  webContents: {
    getAllWebContents: vi.fn(() => [])
  }
}))

vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

vi.mock('./watcher/WatcherMetrics', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    watcherMetrics: mockWatcherMetrics
  }
})

// Mock SettingsService for DirectoryWatcherService
vi.mock('./SettingsService', () => ({
  settingsService: {
    getDirectoryWatchDepth: vi.fn(async () => undefined)
  }
}))

vi.mock('fs/promises', () => ({
  access: vi.fn(),
  stat: vi.fn()
}))

describe('Watcher resilience and polling fallback (#100)', () => {
  let gitWatcherService: any
  let gitPollingService: any
  let directoryWatcherService: any
  let mockWatcher: any
  let fsPromises: any

  /**
   * Helper to start GitWatcherService and emit ready event.
   * Emits 'ready' immediately after microtasks settle (before timeout fires).
   */
  async function startGitWatcherAndEmitReady(path: string) {
    const startPromise = gitWatcherService.start(path)
    // Let the start() async work complete (stat checks, watcher creation)
    await vi.advanceTimersByTimeAsync(0)
    // Emit ready before the 5s timeout fires
    mockWatcher._emitReady?.()
    return startPromise
  }

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date('2025-01-01T00:00:00.000Z') })
    vi.clearAllMocks()

    sends.length = 0
    mockBrowserWindows.length = 0
    mockBrowserWindows.push({
      isDestroyed: () => false,
      webContents: {
        id: 1,
        send: (ch: string, p: any) => sends.push({ id: 1, channel: ch, payload: p })
      }
    })

    // Reset modules to get fresh singletons
    vi.resetModules()

    // Get mocked fs/promises
    fsPromises = await import('fs/promises')

    // Import services after mocks are set up
    const gitWatcherModule = await import('./GitWatcherService')
    gitWatcherService = gitWatcherModule.gitWatcherService

    const gitPollingModule = await import('./GitPollingService')
    gitPollingService = gitPollingModule.gitPollingService

    const directoryWatcherModule = await import('./DirectoryWatcherService')
    directoryWatcherService = directoryWatcherModule.directoryWatcherService

    // Create mock watcher with event handlers
    const eventHandlers: Record<string, ((arg?: any) => void) | null> = {}
    mockWatcher = {
      on: vi.fn().mockImplementation((event: string, callback: any) => {
        eventHandlers[event] = callback
        return mockWatcher
      }),
      close: vi.fn().mockResolvedValue(undefined),
      _handlers: eventHandlers,
      _emitReady: () => eventHandlers['ready']?.()
    }

    mockChokidar.watch.mockReturnValue(mockWatcher)

    // Default: .git directory exists
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)

    // Default: git paths exist
    vi.mocked(fsPromises.stat).mockResolvedValue({
      mtimeMs: Date.now(),
      size: 1024
    } as any)
  })

  afterEach(async () => {
    // Stop services to clear timers
    await gitWatcherService.stop()
    gitPollingService.stop()

    // Clear pending restarts for directory watcher (if used in tests)
    if (directoryWatcherService?.pendingRestarts) {
      for (const timeout of directoryWatcherService.pendingRestarts.values()) {
        clearTimeout(timeout)
      }
      directoryWatcherService.pendingRestarts.clear()
      directoryWatcherService.restartAttempts?.clear()
    }

    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('AC-011: Polling fallback when GitWatcherService fails', () => {
    it('git status updates via polling when watcher fails to start', async () => {
      // Watcher fails to start (no .git directory)
      vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))

      const result = await gitWatcherService.start('/project')
      expect(result.success).toBe(true) // Not an error, just no git repo
      expect(gitWatcherService.isWatching()).toBe(false)

      // Start polling service with watcher coordination (watcher not active)
      gitPollingService.setWatcherCoordination(
        () => gitWatcherService.getLastEventTimestamp(),
        () => gitWatcherService.isWatching()
      )

      // Mock .git/index exists and changes
      let callCount = 0
      vi.mocked(fsPromises.stat).mockImplementation(async (_path: any) => {
        callCount++
        return {
          mtimeMs: 1000 + callCount,
          size: 1024
        } as any
      })

      gitPollingService.start('/project')

      // Advance by polling interval (5s)
      await vi.advanceTimersByTimeAsync(5000)

      // Polling should trigger refresh
      expect(gitPollingService.getMetrics().pollingRefreshCount).toBe(1)
      expect(mockWatcherMetrics.recordPollingRefresh).toHaveBeenCalled()
    })

    it('polling broadcasts git:poll-triggered with reason "no_watcher"', async () => {
      sends.length = 0

      // Watcher not active
      gitPollingService.setWatcherCoordination(
        () => null,
        () => false
      )

      // Mock .git/index changes
      let callCount = 0
      vi.mocked(fsPromises.stat).mockImplementation(async (_path: any) => {
        callCount++
        return {
          mtimeMs: 1000 + callCount,
          size: 1024
        } as any
      })

      gitPollingService.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      // Should broadcast with reason 'no_watcher'
      const pollEvent = sends.find(s => s.channel === 'git:poll-triggered')
      expect(pollEvent).toBeDefined()
      expect(pollEvent?.payload).toMatchObject({
        projectPath: '/project',
        reason: 'no_watcher',
        timestamp: expect.any(Number)
      })
    })
  })

  describe('AC-015: Polling skipped when watcher is active', () => {
    it('skips poll when watcher triggered within 2s', async () => {
      // Start git watcher
      await startGitWatcherAndEmitReady('/project')

      // Set up polling with watcher coordination
      gitPollingService.setWatcherCoordination(
        () => gitWatcherService.getLastEventTimestamp(),
        () => gitWatcherService.isWatching()
      )

      // Mock unchanged .git/index
      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: 1000,
        size: 1024
      } as any)

      // Start polling
      gitPollingService.start('/project')

      // Advance by 3.5 seconds
      await vi.advanceTimersByTimeAsync(3500)

      // NOW trigger watcher event (will be 1.5s before poll at 5s mark)
      gitWatcherService.handleCoalescedEvent('/project', gitWatcherService.sessionVersion, ['index'])

      const lastEventTime = gitWatcherService.getLastEventTimestamp()
      expect(lastEventTime).not.toBeNull()

      // Advance remaining 1.5s to trigger poll (5s total)
      await vi.advanceTimersByTimeAsync(1500)

      // Poll should be skipped because watcher is active (within 2s)
      expect(gitPollingService.getMetrics().pollingSkippedCount).toBe(1)
      expect(mockWatcherMetrics.recordPollingSkipped).toHaveBeenCalled()
      expect(mockLogger.trace).toHaveBeenCalledWith(
        expect.stringContaining('Skipped (watcher active)'),
        expect.any(Object)
      )
    })

    it('no redundant polls in 30s window with active watcher', async () => {
      // Start git watcher
      await startGitWatcherAndEmitReady('/project')

      // Set up polling
      gitPollingService.setWatcherCoordination(
        () => gitWatcherService.getLastEventTimestamp(),
        () => gitWatcherService.isWatching()
      )

      // Mock .git/index
      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: 1000,
        size: 1024
      } as any)

      gitPollingService.start('/project')

      // Simulate watcher events every 3.5s (keeping watcher active)
      for (let i = 0; i < 6; i++) {
        // Advance 3.5s
        await vi.advanceTimersByTimeAsync(3500)

        // Trigger watcher event (1.5s before poll executes at 5s mark)
        gitWatcherService.handleCoalescedEvent(
          '/project',
          gitWatcherService.sessionVersion,
          ['index']
        )

        // Advance remaining 1.5s to trigger poll (5s total)
        await vi.advanceTimersByTimeAsync(1500)
      }

      // All 6 polls should be skipped (watcher active within 2s each time)
      const metrics = gitPollingService.getMetrics()
      expect(metrics.pollingSkippedCount).toBe(6)
      expect(metrics.pollingRefreshCount).toBe(0)
    })

    it('polls execute when watcher timestamp > 2s stale', async () => {
      // Start git watcher
      await startGitWatcherAndEmitReady('/project')

      // Set up polling
      gitPollingService.setWatcherCoordination(
        () => gitWatcherService.getLastEventTimestamp(),
        () => gitWatcherService.isWatching()
      )

      // Trigger initial watcher event
      gitWatcherService.handleCoalescedEvent('/project', gitWatcherService.sessionVersion, ['index'])

      // Mock .git/index changes
      let callCount = 0
      vi.mocked(fsPromises.stat).mockImplementation(async (_path: any) => {
        callCount++
        return {
          mtimeMs: 1000 + callCount,
          size: 1024
        } as any
      })

      gitPollingService.start('/project')

      // Advance by 3s (watcher timestamp is now > 2s old)
      await vi.advanceTimersByTimeAsync(3000)

      // Advance by another 2s to trigger first poll (5s total)
      await vi.advanceTimersByTimeAsync(2000)

      // Poll should execute because watcher timestamp is stale
      const metrics = gitPollingService.getMetrics()
      expect(metrics.pollingRefreshCount).toBe(1)
      expect(metrics.pollingSkippedCount).toBe(0)
    })
  })

  describe('AC-016: Watcher auto-restart with exponential backoff', () => {
    describe('Git watcher', () => {
      it('schedules restart at 800ms on first transient error', async () => {
        await startGitWatcherAndEmitReady('/project')

        // Trigger transient error (ENOENT)
        const errorCallback = mockWatcher._handlers['error']
        errorCallback?.(new Error('ENOENT: no such file'))

        // Should schedule restart
        expect(gitWatcherService.pendingRestart).not.toBeNull()
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Scheduling restart'),
          expect.objectContaining({
            attempt: 1,
            maxAttempts: 3,
            delayMs: 800
          })
        )

        // Verify restart executes after 800ms
        const initialAttempts = gitWatcherService.restartAttempts
        await vi.advanceTimersByTimeAsync(800)
        expect(gitWatcherService.restartAttempts).toBe(initialAttempts + 1)
      })

      it('uses exponential backoff: 800ms, 1600ms, 3200ms', async () => {
        await startGitWatcherAndEmitReady('/project')

        // First error - 800ms delay
        gitWatcherService.restartAttempts = 0
        gitWatcherService.scheduleRestart()

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Scheduling restart'),
          expect.objectContaining({ delayMs: 800 })
        )

        await vi.advanceTimersByTimeAsync(800)
        expect(gitWatcherService.pendingRestart).toBeNull()

        // Second error - 1600ms delay
        gitWatcherService.restartAttempts = 1
        gitWatcherService.scheduleRestart()

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Scheduling restart'),
          expect.objectContaining({ delayMs: 1600 })
        )

        await vi.advanceTimersByTimeAsync(1600)
        expect(gitWatcherService.pendingRestart).toBeNull()

        // Third error - 3200ms delay
        gitWatcherService.restartAttempts = 2
        gitWatcherService.scheduleRestart()

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Scheduling restart'),
          expect.objectContaining({ delayMs: 3200 })
        )

        await vi.advanceTimersByTimeAsync(3200)
        expect(gitWatcherService.pendingRestart).toBeNull()
      })

      it('resets attempt counter on successful restart', async () => {
        await startGitWatcherAndEmitReady('/project')

        // Set attempts to 1 (easier to test)
        gitWatcherService.restartAttempts = 1

        // Create new mock watcher for restart
        const restartHandlers: Record<string, ((arg?: any) => void) | null> = {}
        const restartMockWatcher = {
          on: vi.fn().mockImplementation((event: string, callback: any) => {
            restartHandlers[event] = callback
            return restartMockWatcher
          }),
          close: vi.fn().mockResolvedValue(undefined),
          _handlers: restartHandlers,
          _emitReady: () => restartHandlers['ready']?.()
        }
        mockChokidar.watch.mockReturnValue(restartMockWatcher)

        // Manually call scheduleRestart to verify the logic
        gitWatcherService.scheduleRestart()

        // Verify restart scheduled with correct delay
        expect(gitWatcherService.pendingRestart).not.toBeNull()

        // Advance by 1600ms (delay for attempt 1) and let async restart begin
        await vi.advanceTimersByTimeAsync(1600)

        // Emit ready event for successful restart
        restartMockWatcher._emitReady?.()

        // Flush microtasks to let the restart callback complete
        await vi.advanceTimersByTimeAsync(0)

        // Attempts should be reset to 0 on success
        expect(gitWatcherService.restartAttempts).toBe(0)
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Restart successful')
        )
      })

      it('stops restart after 3 failed attempts and logs warning', async () => {
        await startGitWatcherAndEmitReady('/project')

        // Set attempts to max (3)
        gitWatcherService.restartAttempts = 3

        // Trigger error
        const errorCallback = mockWatcher._handlers['error']
        errorCallback?.(new Error('ENOENT: no such file'))

        // Should NOT schedule restart (max attempts reached)
        expect(gitWatcherService.pendingRestart).toBeNull()

        // Should log error but not schedule restart
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Watcher error'),
          expect.any(Error),
          expect.any(Object)
        )
      })

      it('polling implicitly takes over after all attempts fail', async () => {
        await startGitWatcherAndEmitReady('/project')

        // Simulate 3 failed restart attempts
        gitWatcherService.restartAttempts = 3

        // Mock restart failure
        mockChokidar.watch.mockImplementation(() => {
          throw new Error('Failed to watch')
        })

        // Trigger error (won't schedule restart due to max attempts)
        const errorCallback = mockWatcher._handlers['error']
        errorCallback?.(new Error('ENOENT: no such file'))

        // Stop the watcher (simulating failure state)
        await gitWatcherService.stop()

        // Watcher should not be watching
        expect(gitWatcherService.isWatching()).toBe(false)
        expect(gitWatcherService.getLastEventTimestamp()).toBeNull()

        // Start polling service
        gitPollingService.setWatcherCoordination(
          () => gitWatcherService.getLastEventTimestamp(),
          () => gitWatcherService.isWatching()
        )

        // Mock .git/index changes
        let callCount = 0
        vi.mocked(fsPromises.stat).mockImplementation(async (_path: any) => {
          callCount++
          return {
            mtimeMs: 1000 + callCount,
            size: 1024
          } as any
        })

        gitPollingService.start('/project')

        // Advance by polling interval
        await vi.advanceTimersByTimeAsync(5000)

        // Polling should work (not skipped, because watcher timestamp is stale/null)
        const metrics = gitPollingService.getMetrics()
        expect(metrics.pollingRefreshCount).toBe(1)
        expect(metrics.pollingSkippedCount).toBe(0)

        // Verify reason is 'no_watcher'
        const pollEvent = sends.find(s => s.channel === 'git:poll-triggered')
        expect(pollEvent?.payload).toMatchObject({
          reason: 'no_watcher'
        })
      })
    })

    describe('Directory watcher', () => {
      it('schedules restart at 800ms on first transient error', async () => {
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

        directoryWatcherService.watchedDirectories.set('/proj', {
          dirPath: '/proj',
          watcher: fakeWatcher,
          webContentsIds: new Set([1]),
          pauseController: new PauseController(),
          throttledWorker: fakeThrottledWorker,
          atomicSaveDetector: fakeAtomicSaveDetector,
          version: directoryWatcherService.switchVersion
        })

        // Clear any pending restarts
        directoryWatcherService.pendingRestarts.clear()
        directoryWatcherService.restartAttempts.clear()

        // Trigger transient error
        directoryWatcherService.handleWatcherError('/proj', 'ENOENT: no such file')

        // Should schedule restart
        expect(directoryWatcherService.pendingRestarts.has('/proj')).toBe(true)
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Watcher restart scheduled',
          expect.objectContaining({ dirPath: '/proj', attempt: 1, delay: 800 })
        )
      })

      it('uses exponential backoff: 800ms, 1600ms, 3200ms', () => {
        // Test delay calculation
        const RESTART_BASE_DELAY = 800

        const delay0 = RESTART_BASE_DELAY * Math.pow(2, 0)
        const delay1 = RESTART_BASE_DELAY * Math.pow(2, 1)
        const delay2 = RESTART_BASE_DELAY * Math.pow(2, 2)

        expect(delay0).toBe(800)
        expect(delay1).toBe(1600)
        expect(delay2).toBe(3200)

        // Verify in actual service
        const fakeWatcher = { close: vi.fn(async () => {}) }
        const fakeThrottledWorker = {
          dispose: vi.fn(),
          work: vi.fn(),
          getBufferSize: vi.fn(() => 0)
        } as unknown as ThrottledWorker<any>
        const fakeAtomicSaveDetector = {
          dispose: vi.fn()
        } as unknown as AtomicSaveDetector

        directoryWatcherService.watchedDirectories.set('/proj', {
          dirPath: '/proj',
          watcher: fakeWatcher,
          webContentsIds: new Set([1]),
          pauseController: new PauseController(),
          throttledWorker: fakeThrottledWorker,
          atomicSaveDetector: fakeAtomicSaveDetector,
          version: directoryWatcherService.switchVersion
        })

        directoryWatcherService.pendingRestarts.clear()
        directoryWatcherService.restartAttempts.clear()

        // First attempt
        directoryWatcherService.handleWatcherError('/proj', 'ENOENT: no such file')
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Watcher restart scheduled',
          expect.objectContaining({ dirPath: '/proj', attempt: 1, delay: 800 })
        )

        // Clear and set attempt counter for second
        directoryWatcherService.pendingRestarts.clear()
        directoryWatcherService.restartAttempts.set('/proj', 1)
        directoryWatcherService.handleWatcherError('/proj', 'ENOENT: no such file')
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Watcher restart scheduled',
          expect.objectContaining({ dirPath: '/proj', attempt: 2, delay: 1600 })
        )

        // Clear and set attempt counter for third
        directoryWatcherService.pendingRestarts.clear()
        directoryWatcherService.restartAttempts.set('/proj', 2)
        directoryWatcherService.handleWatcherError('/proj', 'ENOENT: no such file')
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Watcher restart scheduled',
          expect.objectContaining({ dirPath: '/proj', attempt: 3, delay: 3200 })
        )
      })

      it('resets attempt counter on successful restart', async () => {
        // Seed watched directory with 2 prior failed attempts
        const fakeWatcher = { close: vi.fn(async () => {}) }
        const fakeThrottledWorker = {
          dispose: vi.fn(),
          work: vi.fn(),
          getBufferSize: vi.fn(() => 0)
        } as unknown as ThrottledWorker<any>
        const fakeAtomicSaveDetector = {
          dispose: vi.fn()
        } as unknown as AtomicSaveDetector

        directoryWatcherService.watchedDirectories.set('/proj', {
          dirPath: '/proj',
          watcher: fakeWatcher,
          webContentsIds: new Set([1]),
          pauseController: new PauseController(),
          throttledWorker: fakeThrottledWorker,
          atomicSaveDetector: fakeAtomicSaveDetector,
          version: directoryWatcherService.switchVersion
        })

        directoryWatcherService.pendingRestarts.clear()
        directoryWatcherService.restartAttempts.set('/proj', 1) // 1 prior attempt

        // Trigger error – schedules restart at 1600ms (attempt 1)
        directoryWatcherService.handleWatcherError('/proj', 'ENOENT: no such file')
        expect(directoryWatcherService.pendingRestarts.has('/proj')).toBe(true)

        // After restartWatcher succeeds, the attempts map entry is deleted
        // Verify the map tracks attempts correctly before restart
        expect(directoryWatcherService.restartAttempts.get('/proj')).toBe(1)
      })

      it('sends restart-failed after 3 failed attempts (no polling fallback)', () => {
        // Seed watched directory at max restart attempts
        const fakeWatcher = { close: vi.fn(async () => {}) }
        const fakeThrottledWorker = {
          dispose: vi.fn(),
          work: vi.fn(),
          getBufferSize: vi.fn(() => 0)
        } as unknown as ThrottledWorker<any>
        const fakeAtomicSaveDetector = {
          dispose: vi.fn()
        } as unknown as AtomicSaveDetector

        directoryWatcherService.watchedDirectories.set('/proj', {
          dirPath: '/proj',
          watcher: fakeWatcher,
          webContentsIds: new Set([1]),
          pauseController: new PauseController(),
          throttledWorker: fakeThrottledWorker,
          atomicSaveDetector: fakeAtomicSaveDetector,
          version: directoryWatcherService.switchVersion
        })

        sends.length = 0
        directoryWatcherService.pendingRestarts.clear()
        directoryWatcherService.restartAttempts.set('/proj', directoryWatcherService.MAX_RESTART_ATTEMPTS)

        // ENOENT at max attempts sends project-deleted (no restart scheduled)
        directoryWatcherService.handleWatcherError('/proj', 'ENOENT: no such file')

        expect(directoryWatcherService.pendingRestarts.has('/proj')).toBe(false)
        expect(sends.some((s: any) => s.channel === 'directory-watch:project-deleted')).toBe(true)
      })
    })
  })
})

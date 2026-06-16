// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'

// Mock modules before imports
const mockChokidar = {
  watch: vi.fn()
}

const mockBrowserWindows: any[] = []

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

vi.mock('chokidar', () => ({
  default: mockChokidar
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => mockBrowserWindows)
  }
}))

vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

vi.mock('./watcher/WatcherMetrics', () => ({
  watcherMetrics: {
    recordGitWatcherEvent: vi.fn(),
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
}))

vi.mock('fs/promises', () => ({
  access: vi.fn(),
  stat: vi.fn()
}))

describe('GitWatcherService', () => {
  // Note: GitWatcherService class import unused but kept for future class-level tests
  let service: any
  let mockWatcher: any
  let fsPromises: any
  let WATCHER_READY_TIMEOUT_MS: number

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    mockBrowserWindows.length = 0

    // Reset module to get fresh instance
    vi.resetModules()

    // Get mocked fs/promises
    fsPromises = await import('fs/promises')

    // Import service after mocks are set up
    const module = await import('./GitWatcherService')
    service = module.gitWatcherService
    WATCHER_READY_TIMEOUT_MS = module.WATCHER_READY_TIMEOUT_MS

    // Create mock watcher that stores handlers for manual triggering
    const eventHandlers: Record<string, ((arg?: any) => void) | null> = {}
    mockWatcher = {
      on: vi.fn().mockImplementation((event: string, callback: any) => {
        eventHandlers[event] = callback
        return mockWatcher
      }),
      close: vi.fn().mockResolvedValue(undefined),
      add: vi.fn(),
      unwatch: vi.fn(),
      // Expose handlers for tests - allows triggering 'ready' manually
      _handlers: eventHandlers,
      // Helper to emit ready event
      _emitReady: () => eventHandlers['ready']?.()
    }

    mockChokidar.watch.mockReturnValue(mockWatcher)

    // Default: .git directory exists
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)

    // Default: all git paths exist
    vi.mocked(fsPromises.stat).mockResolvedValue({
      mtimeMs: Date.now(),
      size: 1024
    } as any)
  })

  afterEach(async () => {
    // Stop service to clear health logger interval
    await service.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /**
   * Helper to start service and emit ready event.
   * Emits 'ready' immediately after microtasks settle (before timeout fires),
   * simulating normal chokidar behavior where ready fires quickly.
   */
  async function startServiceAndEmitReady(path: string) {
    const startPromise = service.start(path)
    // Let the start() async work complete (stat checks, watcher creation)
    await vi.advanceTimersByTimeAsync(0)
    // Emit ready before the 5s timeout fires
    mockWatcher._emitReady?.()
    return startPromise
  }

  // The inner git-state watcher is invoked with an ARRAY of paths; the
  // presence watcher (always created, even for non-repos) is invoked with a
  // single `.git` path STRING. These helpers disambiguate the two chokidar
  // calls so tests target the inner watcher specifically.
  function innerWatchCall(): any[] | undefined {
    return mockChokidar.watch.mock.calls.find((c: any[]) => Array.isArray(c[0]))
  }
  function presenceWatchCall(): any[] | undefined {
    return mockChokidar.watch.mock.calls.find((c: any[]) => typeof c[0] === 'string')
  }

  describe('start', () => {
    it('should start watching git paths when .git directory exists', async () => {
      const result = await startServiceAndEmitReady('/project')

      expect(result.success).toBe(true)
      expect(mockChokidar.watch).toHaveBeenCalled()

      const watchedPaths = innerWatchCall()![0]
      expect(watchedPaths).toContain(path.join('/project', '.git', 'index'))
      expect(watchedPaths).toContain(path.join('/project', '.git', 'HEAD'))
      expect(watchedPaths).toContain(path.join('/project', '.git', 'refs', 'heads'))
    })

    it('should not start the inner watcher if no .git directory (but presence watcher runs)', async () => {
      vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))

      const result = await service.start('/project')

      expect(result.success).toBe(true)
      // Inner git-state watcher must NOT be created for a non-repo folder...
      expect(innerWatchCall()).toBeUndefined()
      // ...but the presence watcher IS created so a later `git init` is caught.
      expect(presenceWatchCall()).toBeDefined()
      expect(presenceWatchCall()![0]).toBe(path.join('/project', '.git'))
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No .git directory'),
        expect.any(Object)
      )
    })

    it('should increment session version on start', async () => {
      const version1 = service.sessionVersion

      await startServiceAndEmitReady('/project')

      expect(service.sessionVersion).toBe(version1 + 1)
    })

    it('should stop existing watcher before starting new one', async () => {
      await startServiceAndEmitReady('/project1')
      const firstWatcher = mockWatcher

      // Create new mock watcher for second project
      const secondHandlers: Record<string, ((arg?: any) => void) | null> = {}
      const secondMockWatcher = {
        on: vi.fn().mockImplementation((event: string, callback: any) => {
          secondHandlers[event] = callback
          return secondMockWatcher
        }),
        close: vi.fn().mockResolvedValue(undefined),
        _handlers: secondHandlers,
        _emitReady: () => secondHandlers['ready']?.()
      }
      mockChokidar.watch.mockReturnValue(secondMockWatcher)

      const startPromise = service.start('/project2')
      // Let the start() async work complete, then emit ready
      await vi.advanceTimersByTimeAsync(0)
      secondMockWatcher._emitReady?.()
      await startPromise

      expect(firstWatcher.close).toHaveBeenCalled()
    })

    it('should reset restart attempts on start', async () => {
      service.restartAttempts = 2

      await startServiceAndEmitReady('/project')

      expect(service.restartAttempts).toBe(0)
    })

    it('should clear pending restart timer on start', async () => {
      service.pendingRestart = setTimeout(() => {}, 1000)

      await startServiceAndEmitReady('/project')

      expect(service.pendingRestart).toBeNull()
    })

    it('should filter out non-existent git paths', async () => {
      vi.mocked(fsPromises.stat)
        .mockResolvedValueOnce({ mtimeMs: Date.now(), size: 1024 } as any) // .git/index exists
        .mockResolvedValueOnce({ mtimeMs: Date.now(), size: 1024 } as any) // .git/HEAD exists
        .mockRejectedValueOnce(new Error('ENOENT')) // .git/refs/heads doesn't exist
        .mockRejectedValueOnce(new Error('ENOENT')) // .git/FETCH_HEAD doesn't exist
        .mockRejectedValueOnce(new Error('ENOENT')) // .git/stash doesn't exist

      await startServiceAndEmitReady('/project')

      const watchedPaths = innerWatchCall()![0]
      expect(watchedPaths).toHaveLength(2)
      expect(watchedPaths).toContain(path.join('/project', '.git', 'index'))
      expect(watchedPaths).toContain(path.join('/project', '.git', 'HEAD'))
    })

    it('should not start the inner watcher if .git/index not found (bare repo)', async () => {
      vi.mocked(fsPromises.stat).mockRejectedValue(new Error('ENOENT'))

      const result = await service.start('/project')

      expect(result.success).toBe(true)
      // No inner watcher for a bare/index-less repo, but presence watcher runs.
      expect(innerWatchCall()).toBeUndefined()
      expect(presenceWatchCall()).toBeDefined()
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('.git/index not found'),
        expect.any(Object)
      )
    })

    it('should configure chokidar with correct options', async () => {
      await startServiceAndEmitReady('/project')

      const options = innerWatchCall()![1]
      expect(options).toMatchObject({
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        awaitWriteFinish: false,
        followSymlinks: false,
        depth: 3
      })
    })

    it('should set up event handlers', async () => {
      await startServiceAndEmitReady('/project')

      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function))
      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function))
      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function))
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function))
      expect(mockWatcher.on).toHaveBeenCalledWith('ready', expect.any(Function))
    })

    it('should resolve when watcher emits ready', async () => {
      const result = await startServiceAndEmitReady('/project')

      expect(result.success).toBe(true)
      expect(mockLogger.info).toHaveBeenCalledWith(
        'GitWatcherService: Watcher ready',
        expect.objectContaining({
          projectPath: '/project',
          pathCount: expect.any(Number),
          elapsedMs: expect.any(Number)
        })
      )
    })

    it('should handle errors during watcher creation', async () => {
      mockChokidar.watch.mockImplementation(() => {
        throw new Error('Failed to watch')
      })

      const result = await service.start('/project')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to watch')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('ready/timeout lifecycle (Issue #136)', () => {
    it('should clear timeout when ready fires before timeout', async () => {
      const result = await startServiceAndEmitReady('/project')

      expect(result.success).toBe(true)

      // Advance past the 5s timeout – should NOT produce a warn log
      await vi.advanceTimersByTimeAsync(6000)

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('timeout fallback'),
        expect.any(Object)
      )
    })

    it('should log warn with diagnostic context when timeout fires', async () => {
      const startPromise = service.start('/project')
      // Advance past the 5s timeout without emitting ready
      await vi.advanceTimersByTimeAsync(5000)
      const result = await startPromise

      expect(result.success).toBe(true)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'GitWatcherService: Watcher ready timeout fallback triggered',
        expect.objectContaining({
          projectPath: '/project',
          elapsedMs: expect.any(Number),
          timeoutMs: WATCHER_READY_TIMEOUT_MS,
          pathCount: expect.any(Number)
        })
      )
    })

    it('should start health logger on timeout fallback', async () => {
      const startPromise = service.start('/project')
      await vi.advanceTimersByTimeAsync(5000)
      await startPromise

      // Health logger should be running – advance 5 minutes and check for health log
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'GitStatus: Health summary',
        expect.any(Object)
      )
    })

    it('should log late-ready event when ready fires after timeout', async () => {
      const startPromise = service.start('/project')
      // Let timeout fire first
      await vi.advanceTimersByTimeAsync(5000)
      await startPromise

      // Now emit ready after timeout
      mockWatcher._emitReady?.()

      expect(mockLogger.info).toHaveBeenCalledWith(
        'GitWatcherService: Late ready event received after timeout',
        expect.objectContaining({
          projectPath: '/project',
          elapsedMs: expect.any(Number),
          pathCount: expect.any(Number)
        })
      )
    })

    it('should include elapsedMs in ready log', async () => {
      const startPromise = service.start('/project')
      // Advance a small amount then emit ready
      await vi.advanceTimersByTimeAsync(100)
      mockWatcher._emitReady?.()
      await startPromise

      expect(mockLogger.info).toHaveBeenCalledWith(
        'GitWatcherService: Watcher ready',
        expect.objectContaining({
          elapsedMs: expect.any(Number)
        })
      )
    })

    it('should resolve promise when stop() is called during timeout window', async () => {
      const startPromise = service.start('/project')
      await vi.advanceTimersByTimeAsync(0)

      // Stop before timeout fires (simulates rapid project switch)
      await service.stop()

      // Advance past timeout – promise should resolve, no hang
      await vi.advanceTimersByTimeAsync(WATCHER_READY_TIMEOUT_MS)
      const result = await startPromise

      expect(result.success).toBe(true)
      // No timeout warn log since version guard triggered
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('timeout fallback'),
        expect.any(Object)
      )
    })

    it('should ignore late ready after project switch (stale version)', async () => {
      const startPromise = service.start('/project')
      await vi.advanceTimersByTimeAsync(0)
      const oldWatcher = mockWatcher

      // Stop watcher (simulates project switch)
      await service.stop()
      await vi.advanceTimersByTimeAsync(WATCHER_READY_TIMEOUT_MS)
      await startPromise

      // Emit ready on old watcher – should be silently ignored
      oldWatcher._emitReady?.()

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Late ready event'),
        expect.any(Object)
      )
    })

    it('should bump sessionVersion on scheduleRestart to invalidate old timeout', async () => {
      await startServiceAndEmitReady('/project')

      const versionBefore = service.sessionVersion

      // Trigger transient error to schedule restart
      const errorCallback = mockWatcher._handlers['error']
      errorCallback?.(new Error('ENOENT: no such file'))

      // Advance past restart delay (800ms)
      await vi.advanceTimersByTimeAsync(800)

      // sessionVersion should have incremented
      expect(service.sessionVersion).toBeGreaterThan(versionBefore)
    })
  })

  describe('stop', () => {
    it('should stop active watcher', async () => {
      await startServiceAndEmitReady('/project')

      const result = await service.stop()

      expect(result.success).toBe(true)
      expect(mockWatcher.close).toHaveBeenCalled()
      expect(service.activeWatcher).toBeNull()
    })

    it('should return success if not watching', async () => {
      const result = await service.stop()

      expect(result.success).toBe(true)
    })

    it('should clear pending restart on stop', async () => {
      service.pendingRestart = setTimeout(() => {}, 1000)

      await service.stop()

      expect(service.pendingRestart).toBeNull()
    })

    it('should dispose coalescer before closing watcher', async () => {
      await startServiceAndEmitReady('/project')

      const coalescer = service.activeWatcher.coalescer
      const disposeSpy = vi.spyOn(coalescer, 'dispose')

      await service.stop()

      expect(disposeSpy).toHaveBeenCalled()
    })

    it('should handle errors during stop', async () => {
      await startServiceAndEmitReady('/project')

      mockWatcher.close.mockRejectedValue(new Error('Close failed'))

      const result = await service.stop()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Close failed')
      expect(service.activeWatcher).toBeNull()
    })
  })

  describe('file change handling', () => {
    it('should process git file changes and queue events', async () => {
      await startServiceAndEmitReady('/project')

      const queueSpy = vi.spyOn(service.activeWatcher.coalescer, 'queueEvent')

      // Use the exposed handler from mockWatcher
      const changeCallback = mockWatcher._handlers['change']
      changeCallback?.('/project/.git/index')

      expect(queueSpy).toHaveBeenCalledWith('index')
    })

    it('should ignore stale events from old session', async () => {
      await startServiceAndEmitReady('/project')

      // Simulate session change
      service.sessionVersion++

      const queueSpy = vi.spyOn(service.activeWatcher.coalescer, 'queueEvent')

      // Use the exposed handler from mockWatcher
      const changeCallback = mockWatcher._handlers['change']
      changeCallback?.('/project/.git/index')

      expect(queueSpy).not.toHaveBeenCalled()
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring stale event'),
        expect.any(Object)
      )
    })

    it('should ignore events during disposal', async () => {
      await startServiceAndEmitReady('/project')

      service.isDisposing = true

      const queueSpy = vi.spyOn(service.activeWatcher.coalescer, 'queueEvent')

      // Use the exposed handler from mockWatcher
      const changeCallback = mockWatcher._handlers['change']
      changeCallback?.('/project/.git/index')

      expect(queueSpy).not.toHaveBeenCalled()
    })

    it('should ignore unrecognized git paths', async () => {
      await startServiceAndEmitReady('/project')

      const queueSpy = vi.spyOn(service.activeWatcher.coalescer, 'queueEvent')

      // Use the exposed handler from mockWatcher
      const changeCallback = mockWatcher._handlers['change']
      changeCallback?.('/project/.git/config')

      expect(queueSpy).not.toHaveBeenCalled()
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Unrecognized git path'),
        expect.any(Object)
      )
    })
  })

  describe('IPC broadcast', () => {
    it('should broadcast coalesced events to all windows', async () => {
      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: vi.fn()
        }
      }

      mockBrowserWindows.push(mockWindow)

      await startServiceAndEmitReady('/project')

      // Manually trigger coalesced event
      service.handleCoalescedEvent('/project', service.sessionVersion, ['index', 'head'])

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'git:state-changed',
        expect.objectContaining({
          projectPath: '/project',
          eventTypes: ['index', 'head'],
          timestamp: expect.any(Number)
        })
      )
    })

    it('should skip destroyed windows when broadcasting', async () => {
      const mockWindow1 = {
        isDestroyed: () => true,
        webContents: {
          send: vi.fn()
        }
      }

      const mockWindow2 = {
        isDestroyed: () => false,
        webContents: {
          send: vi.fn()
        }
      }

      mockBrowserWindows.push(mockWindow1, mockWindow2)

      await startServiceAndEmitReady('/project')

      service.handleCoalescedEvent('/project', service.sessionVersion, ['index'])

      expect(mockWindow1.webContents.send).not.toHaveBeenCalled()
      expect(mockWindow2.webContents.send).toHaveBeenCalled()
    })

    it('should update lastEventTimestamp when broadcasting', async () => {
      await startServiceAndEmitReady('/project')

      // Initially null before any events
      expect(service.lastEventTimestamp).toBeNull()

      service.handleCoalescedEvent('/project', service.sessionVersion, ['index'])

      expect(service.lastEventTimestamp).not.toBeNull()
      expect(service.lastEventTimestamp).toBeGreaterThan(0)
    })

    it('should ignore stale coalesced events', async () => {
      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: vi.fn()
        }
      }

      mockBrowserWindows.push(mockWindow)

      await startServiceAndEmitReady('/project')

      const oldVersion = service.sessionVersion - 1

      service.handleCoalescedEvent('/project', oldVersion, ['index'])

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring stale coalesced event')
      )
    })

    it('should suppress IPC errors during broadcast', async () => {
      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: vi.fn().mockImplementation(() => {
            throw new Error('Send failed')
          })
        }
      }

      mockBrowserWindows.push(mockWindow)

      await startServiceAndEmitReady('/project')

      expect(() => {
        service.handleCoalescedEvent('/project', service.sessionVersion, ['index'])
      }).not.toThrow()
    })
  })

  describe('error handling and auto-recovery', () => {
    it('should classify ENOENT as transient error', () => {
      expect(service.classifyError('ENOENT: no such file or directory')).toBe('ENOENT')
    })

    it('should classify EMFILE as transient error', () => {
      expect(service.classifyError('EMFILE: too many open files')).toBe('EMFILE')
    })

    it('should classify EACCES as transient error', () => {
      expect(service.classifyError('EACCES: access denied')).toBe('EACCES')
    })

    it('should classify ESTALE as transient error', () => {
      expect(service.classifyError('ESTALE: stale file handle')).toBe('ESTALE')
    })

    it('should classify unknown errors', () => {
      expect(service.classifyError('Something went wrong')).toBe('UNKNOWN')
    })

    it('should recognize transient errors', () => {
      expect(service.isTransientError('ENOENT')).toBe(true)
      expect(service.isTransientError('EMFILE')).toBe(true)
      expect(service.isTransientError('EACCES')).toBe(true)
      expect(service.isTransientError('ESTALE')).toBe(true)
      expect(service.isTransientError('UNKNOWN')).toBe(false)
    })

    it('should schedule restart on transient error', async () => {
      await startServiceAndEmitReady('/project')

      // Use the exposed handler from mockWatcher
      const errorCallback = mockWatcher._handlers['error']
      errorCallback?.(new Error('ENOENT: no such file'))

      expect(service.pendingRestart).not.toBeNull()
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Scheduling restart'),
        expect.any(Object)
      )
    })

    it('should use exponential backoff for restart delays', async () => {
      await startServiceAndEmitReady('/project')

      service.restartAttempts = 0
      service.scheduleRestart()

      vi.advanceTimersByTime(800)
      expect(service.pendingRestart).toBeNull() // First attempt fired

      service.restartAttempts = 1
      service.scheduleRestart()

      vi.advanceTimersByTime(1600)
      expect(service.pendingRestart).toBeNull() // Second attempt fired

      service.restartAttempts = 2
      service.scheduleRestart()

      vi.advanceTimersByTime(3200)
      expect(service.pendingRestart).toBeNull() // Third attempt fired
    })

    it('should stop restart attempts after max attempts', async () => {
      await startServiceAndEmitReady('/project')

      service.restartAttempts = 3 // MAX_RESTART_ATTEMPTS

      // Use the exposed handler from mockWatcher
      const errorCallback = mockWatcher._handlers['error']
      errorCallback?.(new Error('ENOENT: no such file'))

      expect(service.pendingRestart).toBeNull()
    })

    it('should not schedule restart during disposal', async () => {
      await startServiceAndEmitReady('/project')

      // Stop the watcher to clear activeWatcher.projectPath
      // scheduleRestart() checks for projectPath before scheduling
      await service.stop()

      service.isDisposing = true

      service.scheduleRestart()

      // No projectPath means no restart is scheduled
      expect(service.pendingRestart).toBeNull()
    })
  })

  describe('state queries', () => {
    it('should report watching state correctly', async () => {
      expect(service.isWatching()).toBe(false)

      await startServiceAndEmitReady('/project')

      expect(service.isWatching()).toBe(true)

      await service.stop()

      expect(service.isWatching()).toBe(false)
    })

    it('should return watched path', async () => {
      expect(service.getWatchedPath()).toBeNull()

      await startServiceAndEmitReady('/project')

      expect(service.getWatchedPath()).toBe('/project')

      await service.stop()

      expect(service.getWatchedPath()).toBeNull()
    })

    it('should return last event timestamp', async () => {
      await startServiceAndEmitReady('/project')

      expect(service.getLastEventTimestamp()).toBeNull()

      service.handleCoalescedEvent('/project', service.sessionVersion, ['index'])

      expect(service.getLastEventTimestamp()).toBeGreaterThan(0)
    })
  })

  describe('dispose', () => {
    it('should stop watcher and set disposal flag', async () => {
      await startServiceAndEmitReady('/project')

      await service.dispose()

      expect(service.isDisposing).toBe(true)
      expect(service.activeWatcher).toBeNull()
    })

    it('should be safe to call multiple times', async () => {
      await startServiceAndEmitReady('/project')

      await service.dispose()
      await service.dispose()

      expect(service.activeWatcher).toBeNull()
    })
  })

  describe('cleanupForWebContentsId', () => {
    it('should increment sessionVersion before stopping', async () => {
      await startServiceAndEmitReady('/project')

      const versionBefore = service.sessionVersion

      await service.cleanupForWebContentsId(42)

      expect(service.sessionVersion).toBe(versionBefore + 1)
    })

    it('should stop the active watcher', async () => {
      await startServiceAndEmitReady('/project')

      expect(service.isWatching()).toBe(true)

      await service.cleanupForWebContentsId(42)

      expect(service.isWatching()).toBe(false)
    })

    it('should log cleanup with webContentsId', async () => {
      await service.cleanupForWebContentsId(42)

      expect(mockLogger.info).toHaveBeenCalledWith(
        'GitWatcherService: Cleaned up for webContentsId',
        { webContentsId: 42 }
      )
    })

    it('should be safe when not watching', async () => {
      expect(service.isWatching()).toBe(false)

      await expect(service.cleanupForWebContentsId(42)).resolves.not.toThrow()
    })

    it('should be safe to call multiple times', async () => {
      await startServiceAndEmitReady('/project')

      await service.cleanupForWebContentsId(42)
      await expect(service.cleanupForWebContentsId(42)).resolves.not.toThrow()

      expect(service.isWatching()).toBe(false)
    })
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock modules before imports
const mockBrowserWindows: any[] = []

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

const mockGitWatcherService = {
  isWatching: vi.fn(),
  getLastEventTimestamp: vi.fn()
}

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => mockBrowserWindows)
  }
}))

vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

vi.mock('./GitWatcherService', () => ({
  gitWatcherService: mockGitWatcherService
}))

vi.mock('./watcher/WatcherMetrics', () => ({
  watcherMetrics: {
    recordPollingRefresh: vi.fn(),
    recordPollingSkipped: vi.fn()
  }
}))

vi.mock('fs/promises', () => ({
  stat: vi.fn()
}))

describe('GitPollingService', () => {
  // Note: GitPollingService class import unused but kept for future class-level tests
  let service: any
  let fsPromises: any

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date('2025-01-01T00:00:00.000Z') })

    mockBrowserWindows.length = 0

    // Clear logger mocks (not fs.stat)
    mockLogger.trace.mockClear()
    mockLogger.debug.mockClear()
    mockLogger.info.mockClear()
    mockLogger.warn.mockClear()
    mockLogger.error.mockClear()

    // Get mocked fs/promises (once at start)
    if (!fsPromises) {
      fsPromises = await import('fs/promises')
    }

    // Import service once
    if (!service) {
      const module = await import('./GitPollingService')
      service = module.gitPollingService
    }

    // Reset service state
    service.stop()
    service.isDisposing = false
    service.metrics = {
      pollingRefreshCount: 0,
      pollingSkippedCount: 0,
      lastPollTimestamp: 0,
      lastRefreshTimestamp: 0
    }
    service.lastIndexMtime = 0
    service.lastIndexSize = 0
    service.pollingIntervalMs = 5000
    service.enabled = true

    // Default: watcher not watching
    mockGitWatcherService.isWatching.mockClear().mockReturnValue(false)
    mockGitWatcherService.getLastEventTimestamp.mockClear().mockReturnValue(null)

    // Configure watcher coordination with mocked providers
    service.setWatcherCoordination(
      () => mockGitWatcherService.getLastEventTimestamp(),
      () => mockGitWatcherService.isWatching()
    )

    // Default: .git/index exists with consistent values
    vi.mocked(fsPromises.stat).mockReset().mockResolvedValue({
      mtimeMs: 1000,
      size: 1024
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('start and stop', () => {
    it('should start polling for a project', () => {
      service.start('/project')

      expect(service.isPolling()).toBe(true)
      expect(service.projectPath).toBe('/project')
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Started polling'),
        expect.objectContaining({
          projectPath: '/project'
        })
      )
    })

    it('should stop existing polling before starting new one', () => {
      service.start('/project1')

      const firstTimer = service.pollingTimer

      service.start('/project2')

      expect(service.projectPath).toBe('/project2')
      expect(service.pollingTimer).not.toBe(firstTimer)
    })

    it('should reset metrics on start', () => {
      service.metrics.pollingRefreshCount = 5
      service.metrics.pollingSkippedCount = 10

      service.start('/project')

      expect(service.metrics.pollingRefreshCount).toBe(0)
      expect(service.metrics.pollingSkippedCount).toBe(0)
    })

    it('should reset index tracking on start', () => {
      service.lastIndexMtime = 12345
      service.lastIndexSize = 5678

      service.start('/project')

      expect(service.lastIndexMtime).toBe(0)
      expect(service.lastIndexSize).toBe(0)
    })

    it('should not start if polling is disabled', () => {
      service.setEnabled(false)

      service.start('/project')

      expect(service.isPolling()).toBe(false)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Polling disabled'),
        expect.any(Object)
      )
    })

    it('should stop polling', () => {
      service.start('/project')

      service.stop()

      expect(service.isPolling()).toBe(false)
      expect(service.projectPath).toBeNull()
      expect(service.pollingTimer).toBeNull()
    })

    it('should be safe to stop when not polling', () => {
      expect(() => service.stop()).not.toThrow()
    })

    it('should log metrics on stop', () => {
      service.start('/project')
      service.metrics.pollingRefreshCount = 3
      service.metrics.pollingSkippedCount = 7

      service.stop()

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Stopped polling'),
        expect.objectContaining({
          refreshCount: 3,
          skippedCount: 7
        })
      )
    })
  })

  describe('polling interval', () => {
    it('should use default interval (5 seconds)', () => {
      expect(service.getInterval()).toBe(5000)
    })

    it('should set custom interval', () => {
      service.setInterval(10000)

      expect(service.getInterval()).toBe(10000)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Interval updated'),
        expect.objectContaining({ intervalMs: 10000 })
      )
    })

    it('should clamp interval to minimum (1 second)', () => {
      service.setInterval(500)

      expect(service.getInterval()).toBe(1000)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Interval clamped'),
        expect.objectContaining({
          requested: 500,
          actual: 1000
        })
      )
    })

    it('should clamp interval to maximum (60 seconds)', () => {
      service.setInterval(120000)

      expect(service.getInterval()).toBe(60000)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Interval clamped'),
        expect.any(Object)
      )
    })

    it('should restart polling when interval changes while polling', () => {
      service.start('/project')

      const firstTimer = service.pollingTimer

      service.setInterval(3000)

      expect(service.pollingTimer).not.toBe(firstTimer)
      expect(service.getInterval()).toBe(3000)
    })

    it('should not restart if not currently polling', () => {
      service.setInterval(3000)

      expect(service.isPolling()).toBe(false)
    })
  })

  describe('enabled state', () => {
    it('should be enabled by default', () => {
      expect(service.isEnabled()).toBe(true)
    })

    it('should toggle enabled state', () => {
      service.setEnabled(false)

      expect(service.isEnabled()).toBe(false)

      service.setEnabled(true)

      expect(service.isEnabled()).toBe(true)
    })

    it('should stop polling when disabled', () => {
      service.start('/project')

      service.setEnabled(false)

      expect(service.isPolling()).toBe(false)
    })

    it('should start polling when enabled and project path exists', () => {
      service.projectPath = '/project'
      service.setEnabled(false)

      service.setEnabled(true)

      expect(service.isPolling()).toBe(true)
    })
  })

  describe('poll execution', () => {
    it('should execute poll on timer', async () => {
      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.lastPollTimestamp).toBeGreaterThan(0)
    })

    it('should skip poll if watcher is active (within 2 seconds)', async () => {
      // Timestamp needs to be calculated relative to when poll executes (after 5s)
      // At poll time, Date.now() will be baseTime + 5000ms
      // To be "1 second ago" at poll time, set to (baseTime + 5000 - 1000) = baseTime + 4000
      const baseTime = Date.now()
      const recentTimestamp = baseTime + 4000 // 1 second before poll executes

      mockGitWatcherService.getLastEventTimestamp.mockReturnValue(recentTimestamp)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingSkippedCount).toBe(1)
      expect(mockLogger.trace).toHaveBeenCalledWith(
        expect.stringContaining('Skipped (watcher active)'),
        expect.any(Object)
      )
    })

    it('should poll if watcher event is old (> 2 seconds)', async () => {
      const oldTimestamp = Date.now() - 3000
      mockGitWatcherService.getLastEventTimestamp.mockReturnValue(oldTimestamp)

      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: Date.now() + 1000,
        size: 2048
      } as any)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(1)
    })

    it('should skip poll if .git/index unchanged', async () => {
      const mtime = Date.now()
      const size = 1024

      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: mtime,
        size
      } as any)

      service.start('/project')

      // First poll - triggers refresh (index changed from initial state)
      await vi.advanceTimersByTimeAsync(5000)

      // Second poll - should skip (no change)
      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingSkippedCount).toBe(1)
      expect(mockLogger.trace).toHaveBeenCalledWith(
        expect.stringContaining('Skipped (index unchanged)'),
        expect.any(Object)
      )
    })

    it('should trigger refresh if .git/index mtime changed', async () => {
      const initialMtime = 1000
      let callCount = 0

      // Mock stat to return different values on each call
      vi.mocked(fsPromises.stat).mockImplementation(async (_path: any) => {
        callCount++
        if (callCount === 1) {
          return { mtimeMs: initialMtime, size: 1024 } as any
        }
        return { mtimeMs: initialMtime + 1000, size: 1024 } as any
      })

      service.start('/project')
      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(1)

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(2)
    })

    it('should trigger refresh if .git/index size changed', async () => {
      const mtime = 1000
      let callCount = 0

      // Mock stat to return different values on each call
      vi.mocked(fsPromises.stat).mockImplementation(async (_path: any) => {
        callCount++
        if (callCount === 1) {
          return { mtimeMs: mtime, size: 1024 } as any
        }
        return { mtimeMs: mtime, size: 2048 } as any
      })

      service.start('/project')
      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(1)

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(2)
    })

    it('should skip refresh if .git/index does not exist', async () => {
      vi.mocked(fsPromises.stat).mockRejectedValue(new Error('ENOENT'))

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(0)
      expect(service.metrics.pollingSkippedCount).toBe(1)
    })

    it('should not poll during disposal', async () => {
      service.start('/project')

      service.isDisposing = true

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.lastPollTimestamp).toBe(0)
    })
  })

  describe('IPC broadcast', () => {
    it('should broadcast poll triggered event', async () => {
      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: vi.fn()
        }
      }

      mockBrowserWindows.push(mockWindow)

      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: Date.now(),
        size: 1024
      } as any)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'git:poll-triggered',
        expect.objectContaining({
          projectPath: '/project',
          timestamp: expect.any(Number),
          reason: 'no_watcher'
        })
      )
    })

    it('should send reason "index_changed" when watcher is active', async () => {
      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: vi.fn()
        }
      }

      mockBrowserWindows.push(mockWindow)

      mockGitWatcherService.isWatching.mockReturnValue(true)

      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: Date.now(),
        size: 1024
      } as any)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'git:poll-triggered',
        expect.objectContaining({
          reason: 'index_changed'
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

      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: Date.now(),
        size: 1024
      } as any)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(mockWindow1.webContents.send).not.toHaveBeenCalled()
      expect(mockWindow2.webContents.send).toHaveBeenCalled()
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

      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: 1000,
        size: 1024
      } as any)

      service.start('/project')

      // Should not throw when advancing timers
      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(1)
    })
  })

  describe('metrics', () => {
    it('should track polling metrics', async () => {
      const initialMtime = 1000
      let callCount = 0

      // Mock stat to return different values on each call
      vi.mocked(fsPromises.stat).mockImplementation(async (_path: any) => {
        callCount++
        if (callCount === 1) {
          return { mtimeMs: initialMtime, size: 1024 } as any
        }
        if (callCount === 2) {
          return { mtimeMs: initialMtime, size: 1024 } as any // Same - skipped
        }
        return { mtimeMs: initialMtime + 1000, size: 1024 } as any // Different - triggers
      })

      service.start('/project')
      await vi.advanceTimersByTimeAsync(5000)

      await vi.advanceTimersByTimeAsync(5000)

      await vi.advanceTimersByTimeAsync(5000)

      const metrics = service.getMetrics()

      expect(metrics.pollingRefreshCount).toBe(2) // First poll + third poll
      expect(metrics.pollingSkippedCount).toBe(1) // Second poll skipped
      expect(metrics.lastPollTimestamp).toBeGreaterThan(0)
      expect(metrics.lastRefreshTimestamp).toBeGreaterThan(0)
    })

    it('should return copy of metrics', () => {
      service.metrics.pollingRefreshCount = 5

      const metrics = service.getMetrics()

      metrics.pollingRefreshCount = 10

      expect(service.metrics.pollingRefreshCount).toBe(5)
    })
  })

  describe('dispose', () => {
    it('should stop polling and set disposal flag', () => {
      service.start('/project')

      service.dispose()

      expect(service.isDisposing).toBe(true)
      expect(service.isPolling()).toBe(false)
    })

    it('should be safe to call multiple times', () => {
      service.start('/project')

      service.dispose()
      service.dispose()

      expect(service.isPolling()).toBe(false)
    })
  })

  describe('scheduling', () => {
    it('should reschedule poll after each execution', async () => {
      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: Date.now(),
        size: 1024
      } as any)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.lastPollTimestamp).toBeGreaterThan(0)

      const firstPollTime = service.metrics.lastPollTimestamp

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.lastPollTimestamp).toBeGreaterThan(firstPollTime)
    })

    it('should not schedule if disabled', async () => {
      service.start('/project')

      service.setEnabled(false)

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.isPolling()).toBe(false)
    })

    it('should not schedule next poll if project path is cleared', async () => {
      service.start('/project')

      expect(service.isPolling()).toBe(true)

      // Clear project path before first poll executes
      service.projectPath = null

      // Advance timers - poll executes but doesn't reschedule
      await vi.advanceTimersByTimeAsync(5000)

      // Poll didn't trigger because projectPath was null
      expect(service.metrics.lastPollTimestamp).toBe(0)
    })
  })

  describe('hybrid coordination with watcher', () => {
    it('should skip polling within 2 seconds of watcher event', async () => {
      // Timestamp needs to be calculated relative to when poll executes (after 5s)
      // At poll time, Date.now() will be baseTime + 5000ms
      // To be "1 second ago" at poll time, set to (baseTime + 5000 - 1000) = baseTime + 4000
      const baseTime = Date.now()
      const recentTimestamp = baseTime + 4000 // 1 second before poll executes

      mockGitWatcherService.getLastEventTimestamp.mockReturnValue(recentTimestamp)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingSkippedCount).toBe(1)
    })

    it('should poll if watcher event is exactly 2 seconds old', async () => {
      const oldTimestamp = Date.now() - 2000
      mockGitWatcherService.getLastEventTimestamp.mockReturnValue(oldTimestamp)

      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: 1000,
        size: 1024
      } as any)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(1)
    })

    it('should poll if watcher never emitted event', async () => {
      mockGitWatcherService.getLastEventTimestamp.mockReturnValue(null)

      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: 1000,
        size: 1024
      } as any)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(1)
    })
  })

  describe('differential index check', () => {
    it('should track mtime and size of .git/index', async () => {
      const mtime = 1000
      const size = 1024

      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: mtime,
        size
      } as any)

      service.start('/project')

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.lastIndexMtime).toBe(mtime)
      expect(service.lastIndexSize).toBe(size)
    })

    it('should detect change if both mtime and size change', async () => {
      const initialMtime = 1000
      let callCount = 0

      // Mock stat to return different values on each call
      vi.mocked(fsPromises.stat).mockImplementation(async (_path: any) => {
        callCount++
        if (callCount === 1) {
          return { mtimeMs: initialMtime, size: 1024 } as any
        }
        return { mtimeMs: initialMtime + 1000, size: 2048 } as any
      })

      service.start('/project')
      await vi.advanceTimersByTimeAsync(5000)

      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(2)
    })

    it('should handle stat errors gracefully', async () => {
      vi.mocked(fsPromises.stat).mockRejectedValue(new Error('Permission denied'))

      service.start('/project')

      // Should not throw when stat fails
      await vi.advanceTimersByTimeAsync(5000)

      expect(service.metrics.pollingRefreshCount).toBe(0)
      expect(service.metrics.pollingSkippedCount).toBe(1)
    })
  })

  describe('cleanupForWebContentsId', () => {
    it('should stop polling', () => {
      service.start('/project')

      expect(service.isPolling()).toBe(true)

      service.cleanupForWebContentsId(42)

      expect(service.isPolling()).toBe(false)
    })

    it('should log cleanup with webContentsId', () => {
      service.cleanupForWebContentsId(42)

      expect(mockLogger.info).toHaveBeenCalledWith(
        'GitPollingService: Cleaned up for webContentsId',
        { webContentsId: 42 }
      )
    })

    it('should be safe when not polling', () => {
      expect(service.isPolling()).toBe(false)

      expect(() => service.cleanupForWebContentsId(42)).not.toThrow()
    })

    it('should be safe to call multiple times', () => {
      service.start('/project')

      service.cleanupForWebContentsId(42)
      expect(() => service.cleanupForWebContentsId(42)).not.toThrow()

      expect(service.isPolling()).toBe(false)
    })
  })
})

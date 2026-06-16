// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GitEventCoalescer } from './watcher/GitEventCoalescer'

// ---------------------------------------------------------------------------
// IPC capture
// broadcastToAllWindows (not mocked) calls BrowserWindow.getAllWindows()
// internally, so the electron mock below captures IPC sends through the
// real broadcast path.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Filesystem mocks
// ---------------------------------------------------------------------------
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn(async () => {})
    }))
  }
}))

vi.mock('fs/promises', () => ({
  access: vi.fn(() => Promise.resolve()),
  stat: vi.fn(() => Promise.resolve({ isFile: () => true }))
}))

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------
vi.mock('./LoggingService', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn()
  }
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

// DO NOT mock GitEventCoalescer – use REAL implementation for pipeline integration

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed an active watcher with REAL GitEventCoalescer.
 * Returns the coalescer instance for test assertions.
 */
function seedActiveWatcher(svc: any, projectPath: string): GitEventCoalescer {
  const currentVersion = ++svc.sessionVersion

  const coalescer = new GitEventCoalescer((eventTypes) => {
    svc.handleCoalescedEvent(projectPath, currentVersion, eventTypes)
  }, 150)

  const fakeWatcher = { close: vi.fn(async () => {}), on: vi.fn() }

  svc.activeWatcher = {
    watcher: fakeWatcher,
    projectPath,
    version: currentVersion,
    coalescer
  }

  svc.isDisposing = false
  return coalescer
}

/**
 * Trigger a file change event on the service.
 */
function triggerFileChange(svc: any, filePath: string, eventType: 'change' | 'add' | 'unlink' = 'change'): void {
  svc.handleFileChange(filePath, eventType)
}

/**
 * Extract the payload from the first IPC send.
 */
function firstPayload(): any {
  return sends[0]?.payload
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * GitWatcherService pipeline integration tests (main process only)
 *
 * Scope: handleFileChange -> classifyGitPath -> GitEventCoalescer -> handleCoalescedEvent -> broadcastToAllWindows
 *
 * NOT covered here (requires separate renderer/E2E tests):
 * - Renderer useGitStatus hook (250ms debounce + 500ms cooldown)
 * - GitStatusService.getStatus() call and response
 * - React render of status indicators
 * - Full end-to-end latency budget (1000ms for AC-004/005, 1500ms for AC-006)
 *
 * For AC-018 operation queue serialization, see GitStatusService.test.ts (operation queue tests).
 */
describe('GitWatcherService pipeline integration (main process)', () => {
  let svc: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    sends.length = 0

    const mod = await import('./GitWatcherService')
    svc = mod.gitWatcherService
  })

  afterEach(() => {
    // Health logger is not started by seedActiveWatcher, but clean up defensively
    // in case future tests exercise createWatcher -> ready -> startHealthLogger
    if (svc.healthLogInterval) {
      clearInterval(svc.healthLogInterval)
      svc.healthLogInterval = null
    }
    if (svc.activeWatcher?.coalescer) {
      svc.activeWatcher.coalescer.dispose()
    }
    svc.activeWatcher = null
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // AC-004: git add – main process emits IPC within coalesce window
  // (Full AC requires renderer + E2E verification of indicator change within 1000ms)
  // -------------------------------------------------------------------------
  describe('AC-004: git add – main process emits IPC within coalesce window', () => {
    it('emits git:state-changed IPC after 150ms coalesce window on .git/index change', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')

      // Just before coalesce window expires
      vi.advanceTimersByTime(149)
      expect(sends.length).toBe(0)

      // Cross the 150ms boundary
      vi.advanceTimersByTime(2)
      expect(sends.length).toBe(1)

      expect(sends[0].channel).toBe('git:state-changed')
      const payload = firstPayload()
      expect(payload.eventTypes).toContain('index')
      expect(payload.projectPath).toBe('/proj')
      expect(payload.timestamp).toEqual(expect.any(Number))
      expect(payload.correlationId).toMatch(/^git-\d+-[a-z0-9]+$/)
    })

    it('does not emit IPC before coalesce window expires', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')

      vi.advanceTimersByTime(100)
      expect(sends.length).toBe(0)
    })

    it('main process pipeline completes within 150ms (well under 1000ms AC budget)', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')

      vi.advanceTimersByTime(150)
      expect(sends.length).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC-005: git commit – main process coalesces index+HEAD into single IPC
  // (Full AC requires renderer + E2E verification of indicator clearing within 1000ms)
  // -------------------------------------------------------------------------
  describe('AC-005: git commit – main process coalesces index+HEAD into single IPC', () => {
    it('coalesces .git/index and .git/HEAD changes into single IPC broadcast', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')
      triggerFileChange(svc, '/proj/.git/HEAD')

      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(1)
      const payload = firstPayload()
      expect(payload.eventTypes).toContain('index')
      expect(payload.eventTypes).toContain('head')
      expect(payload.eventTypes).toHaveLength(2)
    })

    it('deduplicates repeated .git/index changes during commit', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')
      triggerFileChange(svc, '/proj/.git/index') // git commit may write index multiple times
      triggerFileChange(svc, '/proj/.git/HEAD')

      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(1)
      const types = firstPayload().eventTypes
      expect(types.filter((t: string) => t === 'index')).toHaveLength(1) // deduplicated
      expect(types).toContain('head')
    })
  })

  // -------------------------------------------------------------------------
  // AC-006: git checkout – main process coalesces multi-file changes
  // (Full AC requires renderer + E2E verification of tree+status update within 1500ms)
  // -------------------------------------------------------------------------
  describe('AC-006: git checkout – main process coalesces multi-file changes', () => {
    it('coalesces HEAD, index, and refs changes into single IPC broadcast', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/HEAD')
      triggerFileChange(svc, '/proj/.git/index')
      triggerFileChange(svc, '/proj/.git/refs/heads/feature-branch')

      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(1)
      const payload = firstPayload()
      expect(payload.eventTypes).toContain('head')
      expect(payload.eventTypes).toContain('index')
      expect(payload.eventTypes).toContain('refs')
    })

    it('resets debounce on each new event – events 50ms apart', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/HEAD')          // t=0
      vi.advanceTimersByTime(50)                          // t=50
      triggerFileChange(svc, '/proj/.git/index')           // t=50, debounce resets
      vi.advanceTimersByTime(50)                          // t=100
      triggerFileChange(svc, '/proj/.git/refs/heads/main') // t=100, debounce resets
      vi.advanceTimersByTime(149)                         // t=249, last event + 149ms
      expect(sends.length).toBe(0)                        // Window not yet expired
      vi.advanceTimersByTime(2)                           // t=251, last event + 151ms
      expect(sends.length).toBe(1)

      const payload = firstPayload()
      expect(payload.eventTypes).toContain('head')
      expect(payload.eventTypes).toContain('index')
      expect(payload.eventTypes).toContain('refs')
    })
  })

  // -------------------------------------------------------------------------
  // AC-018: rapid git events – coalescer deduplication
  // NOTE: This tests the coalescing aspect of AC-018 only. The operation queue
  // serialization that prevents index.lock errors is tested in
  // GitStatusService.test.ts (operation queue tests).
  // -------------------------------------------------------------------------
  describe('AC-018: rapid git events – coalescer deduplication', () => {
    it('deduplicates two rapid .git/index changes into single IPC', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')    // t=0, first git add
      vi.advanceTimersByTime(50)                     // t=50
      triggerFileChange(svc, '/proj/.git/index')    // t=50, second git add (debounce resets)
      vi.advanceTimersByTime(150)                    // t=200, coalesce fires

      expect(sends.length).toBe(1)
      expect(firstPayload().eventTypes).toEqual(['index'])
    })

    it('merges two different rapid git events into one broadcast', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')    // t=0
      vi.advanceTimersByTime(80)                     // t=80
      triggerFileChange(svc, '/proj/.git/HEAD')     // t=80 (within 100ms of first)
      vi.advanceTimersByTime(150)                    // t=230

      expect(sends.length).toBe(1)
      const payload = firstPayload()
      expect(payload.eventTypes).toContain('index')
      expect(payload.eventTypes).toContain('head')
    })
  })

  // -------------------------------------------------------------------------
  // Event classification – all 5 git event types and path rejection
  // -------------------------------------------------------------------------
  describe('Event classification – git path routing', () => {
    it('routes FETCH_HEAD changes to fetch event type', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/FETCH_HEAD')
      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(1)
      expect(firstPayload().eventTypes).toContain('fetch')
    })

    it('routes stash changes to stash event type', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/stash')
      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(1)
      expect(firstPayload().eventTypes).toContain('stash')
    })

    it('silently drops unrecognized git paths', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/COMMIT_EDITMSG')
      triggerFileChange(svc, '/proj/.git/config')
      triggerFileChange(svc, '/proj/.git/objects/ab/cdef1234')
      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Correlation ID and payload tracing
  // -------------------------------------------------------------------------
  describe('Correlation ID and payload tracing', () => {
    it('generates correlation ID in git-{timestamp}-{random} format', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')
      vi.advanceTimersByTime(150)

      const payload = firstPayload()
      expect(payload.correlationId).toMatch(/^git-\d+-[a-z0-9]+$/)
    })

    it('generates unique correlation IDs for consecutive events', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')
      vi.advanceTimersByTime(150)

      triggerFileChange(svc, '/proj/.git/HEAD')
      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(2)
      const id1 = (sends[0].payload as any).correlationId
      const id2 = (sends[1].payload as any).correlationId
      expect(id1).not.toBe(id2)
    })
  })

  // -------------------------------------------------------------------------
  // WatcherMetrics integration
  // -------------------------------------------------------------------------
  describe('WatcherMetrics integration', () => {
    it('records git watcher event via WatcherMetrics on coalesced emit', async () => {
      const { watcherMetrics: metrics } = await import('./watcher/WatcherMetrics')
      vi.mocked(metrics.recordGitWatcherEvent).mockClear()
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')
      vi.advanceTimersByTime(150)

      expect(metrics.recordGitWatcherEvent).toHaveBeenCalledOnce()
    })
  })

  // -------------------------------------------------------------------------
  // Polling coordination – lastEventTimestamp
  // -------------------------------------------------------------------------
  describe('Polling coordination – lastEventTimestamp', () => {
    it('updates lastEventTimestamp after coalesced event', () => {
      seedActiveWatcher(svc, '/proj')
      expect(svc.getLastEventTimestamp()).toBeNull()

      triggerFileChange(svc, '/proj/.git/index')
      vi.advanceTimersByTime(150)

      expect(svc.getLastEventTimestamp()).toEqual(expect.any(Number))
    })
  })

  // -------------------------------------------------------------------------
  // Stale event guard – session token prevents cross-project leakage
  // -------------------------------------------------------------------------
  describe('Stale event guard – session token prevents cross-project leakage', () => {
    it('drops coalesced events when session version has advanced', () => {
      seedActiveWatcher(svc, '/projA')
      const staleVersion = svc.sessionVersion

      // Simulate project switch – sessionVersion advances
      seedActiveWatcher(svc, '/projB')

      // Simulate what happens when projA's coalescer fires after the switch:
      // the callback captured projA's path and version, but sessionVersion has moved on
      svc.handleCoalescedEvent('/projA', staleVersion, ['index'])

      expect(sends.length).toBe(0) // Dropped: staleVersion !== current sessionVersion
    })

    it('processes events from current session version', () => {
      seedActiveWatcher(svc, '/proj')

      triggerFileChange(svc, '/proj/.git/index')
      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Disposal guards – isDisposing prevents event processing
  // -------------------------------------------------------------------------
  describe('Disposal guards – isDisposing prevents event processing', () => {
    it('drops file change events when service is disposing', () => {
      seedActiveWatcher(svc, '/proj')
      svc.isDisposing = true

      triggerFileChange(svc, '/proj/.git/index')
      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(0)
    })

    it('drops coalesced events when service is disposing', () => {
      seedActiveWatcher(svc, '/proj')
      svc.isDisposing = true

      svc.handleCoalescedEvent('/proj', svc.sessionVersion, ['index'])

      expect(sends.length).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Circuit breaker – coalescer auto-disposes after repeated callback failures
  // -------------------------------------------------------------------------
  describe('Circuit breaker – coalescer auto-disposes after repeated failures', () => {
    it('trips after 5 consecutive callback errors, subsequent events ignored', () => {
      const currentVersion = ++svc.sessionVersion
      let callCount = 0

      const coalescer = new GitEventCoalescer(() => {
        callCount++
        throw new Error('simulated broadcast failure')
      }, 150)

      svc.activeWatcher = {
        watcher: { close: vi.fn(async () => {}), on: vi.fn() },
        projectPath: '/proj',
        version: currentVersion,
        coalescer
      }
      svc.isDisposing = false

      // Trigger 5 errors to trip the circuit breaker (MAX_CALLBACK_ERRORS = 5)
      for (let i = 0; i < 5; i++) {
        triggerFileChange(svc, '/proj/.git/index')
        vi.advanceTimersByTime(150)
      }

      expect(callCount).toBe(5)

      // 6th event: coalescer is disposed, callback not invoked
      triggerFileChange(svc, '/proj/.git/index')
      vi.advanceTimersByTime(150)

      expect(callCount).toBe(5) // No new callback invocation
      expect(sends.length).toBe(0) // No IPC sent (callback always threw)
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('no-ops when no active watcher exists', () => {
      // svc.activeWatcher is null after vi.resetModules() fresh import
      triggerFileChange(svc, '/proj/.git/index')
      vi.advanceTimersByTime(150)

      expect(sends.length).toBe(0)
    })
  })
})

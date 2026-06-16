// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach } from 'vitest'
import { WatcherMetrics } from './WatcherMetrics'

describe('WatcherMetrics', () => {
  let metrics: WatcherMetrics

  beforeEach(() => {
    metrics = new WatcherMetrics(30000)
  })

  describe('event tracking', () => {
    it('should track received events', () => {
      metrics.recordEventReceived()
      metrics.recordEventReceived()
      metrics.recordEventReceived()

      const snapshot = metrics.getSnapshot()
      expect(snapshot.eventsReceived).toBe(3)
    })

    it('should track batch received events', () => {
      metrics.recordEventsReceived(10)

      const snapshot = metrics.getSnapshot()
      expect(snapshot.eventsReceived).toBe(10)
    })

    it('should track emitted events', () => {
      metrics.recordEventsReceived(10)
      metrics.recordEventsEmitted(5)

      const snapshot = metrics.getSnapshot()
      expect(snapshot.eventsEmitted).toBe(5)
    })

    it('should track coalesced events', () => {
      metrics.recordEventsReceived(10)
      metrics.recordEventsCoalesced(3)
      metrics.recordEventsEmitted(7)

      const snapshot = metrics.getSnapshot()
      expect(snapshot.eventsCoalesced).toBe(3)
    })

    it('should calculate coalesce efficiency', () => {
      metrics.recordEventsReceived(100)
      metrics.recordEventsCoalesced(75)
      metrics.recordEventsEmitted(25)

      const snapshot = metrics.getSnapshot()
      expect(snapshot.coalesceEfficiency).toBe(75) // 75% saved
    })
  })

  describe('buffer tracking', () => {
    it('should track current buffer size', () => {
      metrics.recordEventsReceived(5)
      expect(metrics.getSnapshot().currentBufferSize).toBe(5)

      metrics.recordEventsEmitted(2)
      expect(metrics.getSnapshot().currentBufferSize).toBe(3)
    })

    it('should track buffer overflows', () => {
      metrics.recordBufferOverflow(100)

      const snapshot = metrics.getSnapshot()
      expect(snapshot.bufferOverflows).toBe(1)
    })

    it('should report max buffer size', () => {
      const snapshot = metrics.getSnapshot()
      expect(snapshot.maxBufferSize).toBe(30000)
    })

    it('should allow direct buffer size setting', () => {
      metrics.setBufferSize(500)
      expect(metrics.getSnapshot().currentBufferSize).toBe(500)
    })
  })

  describe('error tracking', () => {
    it('should track errors by type', () => {
      metrics.recordError('ENOENT')
      metrics.recordError('ENOENT')
      metrics.recordError('EMFILE')

      const snapshot = metrics.getSnapshot()
      expect(snapshot.errorCounts).toEqual({
        ENOENT: 2,
        EMFILE: 1
      })
    })
  })

  describe('watcher tracking', () => {
    it('should track active watchers', () => {
      metrics.setActiveWatchers(5)

      const snapshot = metrics.getSnapshot()
      expect(snapshot.activeWatchers).toBe(5)
    })
  })

  describe('throughput calculation', () => {
    it('should track events per second', () => {
      // Record some events
      metrics.recordEventsReceived(10)

      const snapshot = metrics.getSnapshot()
      // Throughput is calculated over 5 second window
      expect(snapshot.eventsPerSecond).toBeGreaterThanOrEqual(0)
    })

    it('should track peak throughput', () => {
      metrics.recordEventsReceived(100)

      const snapshot = metrics.getSnapshot()
      expect(snapshot.peakEventsPerSecond).toBeGreaterThanOrEqual(0)
    })
  })

  describe('reset', () => {
    it('should reset all counters', () => {
      metrics.recordEventsReceived(100)
      metrics.recordEventsEmitted(50)
      metrics.recordEventsCoalesced(50)
      metrics.recordError('ENOENT')
      metrics.setActiveWatchers(5)

      metrics.reset()

      const snapshot = metrics.getSnapshot()
      expect(snapshot.eventsReceived).toBe(0)
      expect(snapshot.eventsEmitted).toBe(0)
      expect(snapshot.eventsCoalesced).toBe(0)
      expect(snapshot.errorCounts).toEqual({})
      expect(snapshot.bufferOverflows).toBe(0)
    })
  })

  describe('formatted stats', () => {
    it('should return formatted stats string', () => {
      metrics.recordEventsReceived(100)
      metrics.recordEventsEmitted(80)
      metrics.recordEventsCoalesced(20)
      metrics.setActiveWatchers(3)

      const formatted = metrics.getFormattedStats()

      expect(formatted).toContain('[Watcher Metrics]')
      expect(formatted).toContain('Events:')
      expect(formatted).toContain('Efficiency:')
      expect(formatted).toContain('Active watchers: 3')
    })
  })

  describe('uptime tracking', () => {
    it('should track uptime', () => {
      const snapshot = metrics.getSnapshot()
      expect(snapshot.uptimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should track last reset time', () => {
      const before = Date.now()
      metrics.reset()
      const after = Date.now()

      const snapshot = metrics.getSnapshot()
      expect(snapshot.lastResetTime).toBeGreaterThanOrEqual(before)
      expect(snapshot.lastResetTime).toBeLessThanOrEqual(after)
    })
  })

  describe('restart tracking', () => {
    it('should increment restartScheduled counter', () => {
      metrics.recordRestartScheduled()
      metrics.recordRestartScheduled()
      metrics.recordRestartScheduled()

      const snapshot = metrics.getSnapshot()
      expect(snapshot.restartScheduled).toBe(3)
    })

    it('should increment restartSuccess counter', () => {
      metrics.recordRestartSuccess()
      metrics.recordRestartSuccess()

      const snapshot = metrics.getSnapshot()
      expect(snapshot.restartSuccess).toBe(2)
    })

    it('should increment restartFailure counter', () => {
      metrics.recordRestartFailure()
      metrics.recordRestartFailure()
      metrics.recordRestartFailure()
      metrics.recordRestartFailure()

      const snapshot = metrics.getSnapshot()
      expect(snapshot.restartFailure).toBe(4)
    })

    it('should include restart stats in snapshot', () => {
      metrics.recordRestartScheduled()
      metrics.recordRestartSuccess()
      metrics.recordRestartFailure()

      const snapshot = metrics.getSnapshot()
      expect(snapshot.restartScheduled).toBe(1)
      expect(snapshot.restartSuccess).toBe(1)
      expect(snapshot.restartFailure).toBe(1)
    })

    it('should reset restart stats on reset', () => {
      metrics.recordRestartScheduled()
      metrics.recordRestartScheduled()
      metrics.recordRestartSuccess()
      metrics.recordRestartFailure()

      metrics.reset()

      const snapshot = metrics.getSnapshot()
      expect(snapshot.restartScheduled).toBe(0)
      expect(snapshot.restartSuccess).toBe(0)
      expect(snapshot.restartFailure).toBe(0)
    })
  })
})

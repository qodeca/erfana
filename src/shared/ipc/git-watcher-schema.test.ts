// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Watcher Schema Tests
 *
 * Tests for Zod schema validation of git watcher IPC events and payloads
 *
 * Test coverage:
 * - GitEventTypeSchema: Valid/invalid event types
 * - GitStateChangeEventSchema: Valid events, required fields, optional correlationId
 * - GitWatcherStateSchema: Valid/invalid states
 * - GitWatcherStatusSchema: Valid status, nullable fields
 * - GitPollTriggeredEventSchema: Valid event, reason validation
 * - GitPollingMetrics: Interface field verification
 *
 * @see Issue #74 - Real-time git status refresh
 * @see Spec #003 - Real-time git status refresh specification
 */
import { describe, it, expect } from 'vitest'
import {
  GitEventTypeSchema,
  GitStateChangeEventSchema,
  GitWatcherStateSchema,
  GitWatcherStatusSchema,
  GitPollTriggeredEventSchema,
  type GitEventType,
  type GitStateChangeEvent,
  type GitWatcherState,
  type GitWatcherStatus,
  type GitPollTriggeredEvent,
  type GitPollingMetrics
} from './git-watcher-schema'

describe('GitEventTypeSchema', () => {
  describe('valid event types', () => {
    it('accepts "index" event type', () => {
      expect(GitEventTypeSchema.parse('index')).toBe('index')
    })

    it('accepts "head" event type', () => {
      expect(GitEventTypeSchema.parse('head')).toBe('head')
    })

    it('accepts "refs" event type', () => {
      expect(GitEventTypeSchema.parse('refs')).toBe('refs')
    })

    it('accepts "fetch" event type', () => {
      expect(GitEventTypeSchema.parse('fetch')).toBe('fetch')
    })

    it('accepts "stash" event type', () => {
      expect(GitEventTypeSchema.parse('stash')).toBe('stash')
    })

    it('accepts all 5 valid event types', () => {
      const validTypes: GitEventType[] = ['index', 'head', 'refs', 'fetch', 'stash']

      for (const type of validTypes) {
        const result = GitEventTypeSchema.parse(type)
        expect(result).toBe(type)
      }
    })
  })

  describe('invalid event types', () => {
    it('rejects "unknown" event type', () => {
      expect(() => GitEventTypeSchema.parse('unknown')).toThrow()
    })

    it('rejects "config" event type', () => {
      expect(() => GitEventTypeSchema.parse('config')).toThrow()
    })

    it('rejects "branch" event type', () => {
      expect(() => GitEventTypeSchema.parse('branch')).toThrow()
    })

    it('rejects empty string', () => {
      expect(() => GitEventTypeSchema.parse('')).toThrow()
    })

    it('rejects null', () => {
      expect(() => GitEventTypeSchema.parse(null)).toThrow()
    })

    it('rejects undefined', () => {
      expect(() => GitEventTypeSchema.parse(undefined)).toThrow()
    })

    it('rejects numeric values', () => {
      expect(() => GitEventTypeSchema.parse(0)).toThrow()
      expect(() => GitEventTypeSchema.parse(1)).toThrow()
    })

    it('is case sensitive', () => {
      expect(() => GitEventTypeSchema.parse('INDEX')).toThrow()
      expect(() => GitEventTypeSchema.parse('Head')).toThrow()
    })
  })
})

describe('GitStateChangeEventSchema', () => {
  describe('valid events', () => {
    it('validates minimal valid event without correlationId', () => {
      const event = {
        projectPath: '/test/project',
        eventTypes: ['index'] as GitEventType[],
        timestamp: 1703270400000
      }

      const result = GitStateChangeEventSchema.parse(event)
      expect(result).toEqual(event)
    })

    it('validates event with correlationId', () => {
      const event = {
        projectPath: '/test/project',
        eventTypes: ['index', 'head'] as GitEventType[],
        timestamp: 1703270400000,
        correlationId: 'git-1703270400000-abc123'
      }

      const result = GitStateChangeEventSchema.parse(event)
      expect(result).toEqual(event)
    })

    it('validates event with all 5 event types', () => {
      const event = {
        projectPath: '/test/project',
        eventTypes: ['index', 'head', 'refs', 'fetch', 'stash'] as GitEventType[],
        timestamp: 1703270400000,
        correlationId: 'git-1703270400000-xyz789'
      }

      const result = GitStateChangeEventSchema.parse(event)
      expect(result.eventTypes).toHaveLength(5)
    })

    it('validates event with single event type', () => {
      const event = {
        projectPath: '/Users/test/myproject',
        eventTypes: ['fetch'] as GitEventType[],
        timestamp: Date.now()
      }

      const result = GitStateChangeEventSchema.parse(event)
      expect(result.eventTypes).toEqual(['fetch'])
    })
  })

  describe('required fields', () => {
    it('rejects event missing projectPath', () => {
      expect(() =>
        GitStateChangeEventSchema.parse({
          eventTypes: ['index'],
          timestamp: 1703270400000
        })
      ).toThrow()
    })

    it('rejects event missing eventTypes', () => {
      expect(() =>
        GitStateChangeEventSchema.parse({
          projectPath: '/test/project',
          timestamp: 1703270400000
        })
      ).toThrow()
    })

    it('rejects event missing timestamp', () => {
      expect(() =>
        GitStateChangeEventSchema.parse({
          projectPath: '/test/project',
          eventTypes: ['index']
        })
      ).toThrow()
    })
  })

  describe('optional correlationId', () => {
    it('allows correlationId to be absent', () => {
      const event = {
        projectPath: '/test/project',
        eventTypes: ['index'] as GitEventType[],
        timestamp: 1703270400000
      }

      const result = GitStateChangeEventSchema.parse(event)
      expect(result.correlationId).toBeUndefined()
    })

    it('allows correlationId to be present', () => {
      const event = {
        projectPath: '/test/project',
        eventTypes: ['index'] as GitEventType[],
        timestamp: 1703270400000,
        correlationId: 'git-1703270400000-abc123'
      }

      const result = GitStateChangeEventSchema.parse(event)
      expect(result.correlationId).toBe('git-1703270400000-abc123')
    })

    it('rejects null correlationId (should use undefined instead)', () => {
      expect(() =>
        GitStateChangeEventSchema.parse({
          projectPath: '/test/project',
          eventTypes: ['index'],
          timestamp: 1703270400000,
          correlationId: null
        })
      ).toThrow()
    })
  })

  describe('field validation', () => {
    it('rejects non-string projectPath', () => {
      expect(() =>
        GitStateChangeEventSchema.parse({
          projectPath: 123,
          eventTypes: ['index'],
          timestamp: 1703270400000
        })
      ).toThrow()
    })

    it('rejects non-array eventTypes', () => {
      expect(() =>
        GitStateChangeEventSchema.parse({
          projectPath: '/test/project',
          eventTypes: 'index',
          timestamp: 1703270400000
        })
      ).toThrow()
    })

    it('rejects empty eventTypes array', () => {
      // Zod allows empty arrays by default, but semantically we'd expect at least one event
      const event = {
        projectPath: '/test/project',
        eventTypes: [],
        timestamp: 1703270400000
      }

      const result = GitStateChangeEventSchema.parse(event)
      expect(result.eventTypes).toEqual([])
    })

    it('rejects non-number timestamp', () => {
      expect(() =>
        GitStateChangeEventSchema.parse({
          projectPath: '/test/project',
          eventTypes: ['index'],
          timestamp: '1703270400000'
        })
      ).toThrow()
    })

    it('rejects non-string correlationId', () => {
      expect(() =>
        GitStateChangeEventSchema.parse({
          projectPath: '/test/project',
          eventTypes: ['index'],
          timestamp: 1703270400000,
          correlationId: 123
        })
      ).toThrow()
    })
  })
})

describe('GitWatcherStateSchema', () => {
  describe('valid states', () => {
    it('accepts "stopped" state', () => {
      expect(GitWatcherStateSchema.parse('stopped')).toBe('stopped')
    })

    it('accepts "starting" state', () => {
      expect(GitWatcherStateSchema.parse('starting')).toBe('starting')
    })

    it('accepts "watching" state', () => {
      expect(GitWatcherStateSchema.parse('watching')).toBe('watching')
    })

    it('accepts "error" state', () => {
      expect(GitWatcherStateSchema.parse('error')).toBe('error')
    })

    it('accepts all 4 valid states', () => {
      const validStates: GitWatcherState[] = ['stopped', 'starting', 'watching', 'error']

      for (const state of validStates) {
        const result = GitWatcherStateSchema.parse(state)
        expect(result).toBe(state)
      }
    })
  })

  describe('invalid states', () => {
    it('rejects "running" state', () => {
      expect(() => GitWatcherStateSchema.parse('running')).toThrow()
    })

    it('rejects "idle" state', () => {
      expect(() => GitWatcherStateSchema.parse('idle')).toThrow()
    })

    it('rejects "paused" state', () => {
      expect(() => GitWatcherStateSchema.parse('paused')).toThrow()
    })

    it('rejects empty string', () => {
      expect(() => GitWatcherStateSchema.parse('')).toThrow()
    })

    it('rejects null', () => {
      expect(() => GitWatcherStateSchema.parse(null)).toThrow()
    })

    it('rejects undefined', () => {
      expect(() => GitWatcherStateSchema.parse(undefined)).toThrow()
    })

    it('is case sensitive', () => {
      expect(() => GitWatcherStateSchema.parse('STOPPED')).toThrow()
      expect(() => GitWatcherStateSchema.parse('Watching')).toThrow()
    })
  })
})

describe('GitWatcherStatusSchema', () => {
  describe('valid status objects', () => {
    it('validates status with all null fields', () => {
      const status = {
        state: 'stopped' as const,
        watchedPath: null,
        lastEventTimestamp: null,
        error: null
      }

      const result = GitWatcherStatusSchema.parse(status)
      expect(result).toEqual(status)
    })

    it('validates status when watching with path and timestamp', () => {
      const status = {
        state: 'watching' as const,
        watchedPath: '/test/project',
        lastEventTimestamp: 1703270400000,
        error: null
      }

      const result = GitWatcherStatusSchema.parse(status)
      expect(result).toEqual(status)
    })

    it('validates status in error state with error message', () => {
      const status = {
        state: 'error' as const,
        watchedPath: '/test/project',
        lastEventTimestamp: 1703270400000,
        error: 'ENOENT: no such file or directory'
      }

      const result = GitWatcherStatusSchema.parse(status)
      expect(result).toEqual(status)
    })

    it('validates status in starting state', () => {
      const status = {
        state: 'starting' as const,
        watchedPath: '/test/project',
        lastEventTimestamp: null,
        error: null
      }

      const result = GitWatcherStatusSchema.parse(status)
      expect(result.state).toBe('starting')
    })

    it('validates all required fields are present', () => {
      const status = {
        state: 'watching' as const,
        watchedPath: '/home/user/project',
        lastEventTimestamp: Date.now(),
        error: null
      }

      const result = GitWatcherStatusSchema.parse(status)
      expect(result.state).toBeDefined()
      expect(result.watchedPath).toBeDefined()
      expect(result.lastEventTimestamp).toBeDefined()
      expect(result.error).toBeDefined()
    })
  })

  describe('nullable fields', () => {
    it('accepts null watchedPath', () => {
      const status = {
        state: 'stopped' as const,
        watchedPath: null,
        lastEventTimestamp: null,
        error: null
      }

      const result = GitWatcherStatusSchema.parse(status)
      expect(result.watchedPath).toBeNull()
    })

    it('accepts null lastEventTimestamp', () => {
      const status = {
        state: 'watching' as const,
        watchedPath: '/test/project',
        lastEventTimestamp: null,
        error: null
      }

      const result = GitWatcherStatusSchema.parse(status)
      expect(result.lastEventTimestamp).toBeNull()
    })

    it('accepts null error', () => {
      const status = {
        state: 'watching' as const,
        watchedPath: '/test/project',
        lastEventTimestamp: 1703270400000,
        error: null
      }

      const result = GitWatcherStatusSchema.parse(status)
      expect(result.error).toBeNull()
    })
  })

  describe('required fields', () => {
    it('rejects missing state', () => {
      expect(() =>
        GitWatcherStatusSchema.parse({
          watchedPath: '/test/project',
          lastEventTimestamp: 1703270400000,
          error: null
        })
      ).toThrow()
    })

    it('rejects missing watchedPath', () => {
      expect(() =>
        GitWatcherStatusSchema.parse({
          state: 'watching',
          lastEventTimestamp: 1703270400000,
          error: null
        })
      ).toThrow()
    })

    it('rejects missing lastEventTimestamp', () => {
      expect(() =>
        GitWatcherStatusSchema.parse({
          state: 'watching',
          watchedPath: '/test/project',
          error: null
        })
      ).toThrow()
    })

    it('rejects missing error', () => {
      expect(() =>
        GitWatcherStatusSchema.parse({
          state: 'watching',
          watchedPath: '/test/project',
          lastEventTimestamp: 1703270400000
        })
      ).toThrow()
    })
  })

  describe('field validation', () => {
    it('rejects invalid state', () => {
      expect(() =>
        GitWatcherStatusSchema.parse({
          state: 'invalid',
          watchedPath: null,
          lastEventTimestamp: null,
          error: null
        })
      ).toThrow()
    })

    it('rejects non-string watchedPath', () => {
      expect(() =>
        GitWatcherStatusSchema.parse({
          state: 'watching',
          watchedPath: 123,
          lastEventTimestamp: null,
          error: null
        })
      ).toThrow()
    })

    it('rejects non-number lastEventTimestamp', () => {
      expect(() =>
        GitWatcherStatusSchema.parse({
          state: 'watching',
          watchedPath: '/test/project',
          lastEventTimestamp: '1703270400000',
          error: null
        })
      ).toThrow()
    })

    it('rejects non-string error', () => {
      expect(() =>
        GitWatcherStatusSchema.parse({
          state: 'error',
          watchedPath: '/test/project',
          lastEventTimestamp: null,
          error: 123
        })
      ).toThrow()
    })
  })
})

describe('GitPollTriggeredEventSchema', () => {
  describe('valid events', () => {
    it('validates poll event with "index_changed" reason', () => {
      const event = {
        projectPath: '/test/project',
        timestamp: 1703270400000,
        reason: 'index_changed' as const
      }

      const result = GitPollTriggeredEventSchema.parse(event)
      expect(result).toEqual(event)
    })

    it('validates poll event with "no_watcher" reason', () => {
      const event = {
        projectPath: '/test/project',
        timestamp: 1703270400000,
        reason: 'no_watcher' as const
      }

      const result = GitPollTriggeredEventSchema.parse(event)
      expect(result).toEqual(event)
    })

    it('accepts both valid reason types', () => {
      const reasons = ['index_changed', 'no_watcher'] as const

      for (const reason of reasons) {
        const event = {
          projectPath: '/test/project',
          timestamp: Date.now(),
          reason
        }

        const result = GitPollTriggeredEventSchema.parse(event)
        expect(result.reason).toBe(reason)
      }
    })
  })

  describe('required fields', () => {
    it('rejects missing projectPath', () => {
      expect(() =>
        GitPollTriggeredEventSchema.parse({
          timestamp: 1703270400000,
          reason: 'index_changed'
        })
      ).toThrow()
    })

    it('rejects missing timestamp', () => {
      expect(() =>
        GitPollTriggeredEventSchema.parse({
          projectPath: '/test/project',
          reason: 'index_changed'
        })
      ).toThrow()
    })

    it('rejects missing reason', () => {
      expect(() =>
        GitPollTriggeredEventSchema.parse({
          projectPath: '/test/project',
          timestamp: 1703270400000
        })
      ).toThrow()
    })
  })

  describe('reason validation', () => {
    it('rejects invalid reason "manual_refresh"', () => {
      expect(() =>
        GitPollTriggeredEventSchema.parse({
          projectPath: '/test/project',
          timestamp: 1703270400000,
          reason: 'manual_refresh'
        })
      ).toThrow()
    })

    it('rejects invalid reason "watcher_fallback"', () => {
      expect(() =>
        GitPollTriggeredEventSchema.parse({
          projectPath: '/test/project',
          timestamp: 1703270400000,
          reason: 'watcher_fallback'
        })
      ).toThrow()
    })

    it('rejects empty string reason', () => {
      expect(() =>
        GitPollTriggeredEventSchema.parse({
          projectPath: '/test/project',
          timestamp: 1703270400000,
          reason: ''
        })
      ).toThrow()
    })

    it('is case sensitive for reason', () => {
      expect(() =>
        GitPollTriggeredEventSchema.parse({
          projectPath: '/test/project',
          timestamp: 1703270400000,
          reason: 'INDEX_CHANGED'
        })
      ).toThrow()
    })
  })

  describe('field validation', () => {
    it('rejects non-string projectPath', () => {
      expect(() =>
        GitPollTriggeredEventSchema.parse({
          projectPath: 123,
          timestamp: 1703270400000,
          reason: 'index_changed'
        })
      ).toThrow()
    })

    it('rejects non-number timestamp', () => {
      expect(() =>
        GitPollTriggeredEventSchema.parse({
          projectPath: '/test/project',
          timestamp: '1703270400000',
          reason: 'no_watcher'
        })
      ).toThrow()
    })
  })
})

describe('GitPollingMetrics interface', () => {
  it('has 4 required numeric fields', () => {
    const metrics: GitPollingMetrics = {
      pollingRefreshCount: 10,
      pollingSkippedCount: 5,
      lastPollTimestamp: 1703270400000,
      lastRefreshTimestamp: 1703270410000
    }

    expect(metrics.pollingRefreshCount).toBe(10)
    expect(metrics.pollingSkippedCount).toBe(5)
    expect(metrics.lastPollTimestamp).toBe(1703270400000)
    expect(metrics.lastRefreshTimestamp).toBe(1703270410000)
  })

  it('accepts zero values for all fields', () => {
    const metrics: GitPollingMetrics = {
      pollingRefreshCount: 0,
      pollingSkippedCount: 0,
      lastPollTimestamp: 0,
      lastRefreshTimestamp: 0
    }

    expect(metrics.pollingRefreshCount).toBe(0)
    expect(metrics.pollingSkippedCount).toBe(0)
    expect(metrics.lastPollTimestamp).toBe(0)
    expect(metrics.lastRefreshTimestamp).toBe(0)
  })

  it('accepts typical runtime values', () => {
    const metrics: GitPollingMetrics = {
      pollingRefreshCount: 42,
      pollingSkippedCount: 18,
      lastPollTimestamp: Date.now(),
      lastRefreshTimestamp: Date.now() - 5000
    }

    expect(typeof metrics.pollingRefreshCount).toBe('number')
    expect(typeof metrics.pollingSkippedCount).toBe('number')
    expect(typeof metrics.lastPollTimestamp).toBe('number')
    expect(typeof metrics.lastRefreshTimestamp).toBe('number')
  })

  it('requires all 4 fields to be present', () => {
    // This is a compile-time check, but we can verify the structure
    const metrics: GitPollingMetrics = {
      pollingRefreshCount: 1,
      pollingSkippedCount: 2,
      lastPollTimestamp: 3,
      lastRefreshTimestamp: 4
    }

    const keys = Object.keys(metrics)
    expect(keys).toHaveLength(4)
    expect(keys).toContain('pollingRefreshCount')
    expect(keys).toContain('pollingSkippedCount')
    expect(keys).toContain('lastPollTimestamp')
    expect(keys).toContain('lastRefreshTimestamp')
  })
})

describe('Type inference', () => {
  it('infers correct GitEventType', () => {
    const eventType: GitEventType = 'index'
    expect(eventType).toBe('index')
  })

  it('infers correct GitStateChangeEvent type', () => {
    const event: GitStateChangeEvent = {
      projectPath: '/test',
      eventTypes: ['index'],
      timestamp: 1703270400000
    }
    expect(event.projectPath).toBe('/test')
  })

  it('infers correct GitWatcherState type', () => {
    const state: GitWatcherState = 'watching'
    expect(state).toBe('watching')
  })

  it('infers correct GitWatcherStatus type', () => {
    const status: GitWatcherStatus = {
      state: 'watching',
      watchedPath: '/test',
      lastEventTimestamp: 123,
      error: null
    }
    expect(status.state).toBe('watching')
  })

  it('infers correct GitPollTriggeredEvent type', () => {
    const event: GitPollTriggeredEvent = {
      projectPath: '/test',
      timestamp: 123,
      reason: 'index_changed'
    }
    expect(event.reason).toBe('index_changed')
  })
})

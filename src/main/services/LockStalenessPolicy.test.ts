// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import {
  createLockStalenessPolicy,
  HEARTBEAT_STALE_MS,
  STALE_TIMEOUT_MS,
  CLOCK_SKEW_BUFFER_MS
} from './LockStalenessPolicy'
import type { Clock } from '../utils/Clock'
import type { ProcessLiveness } from '../utils/ProcessLiveness'
import type { LockInfo } from '../../shared/ipc/project-lock-schema'

vi.mock('./LoggingService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const FIXED_NOW = 1_700_000_000_000 // arbitrary epoch ms

function makeDeps(overrides?: Partial<{ now: number; alive: boolean; hostname: string }>) {
  const now = overrides?.now ?? FIXED_NOW
  const alive = overrides?.alive ?? true
  const hostname = overrides?.hostname ?? 'test-machine.local'
  const clock: Clock = { now: () => now, nowIso: () => new Date(now).toISOString() }
  const liveness: ProcessLiveness = { isAlive: () => alive }
  return { clock, liveness, currentHostname: hostname }
}

function makeLock(overrides: Partial<LockInfo> = {}): LockInfo {
  return {
    instanceId: '550e8400-e29b-41d4-a716-446655440000',
    pid: 99999,
    timestamp: new Date(FIXED_NOW - 1000).toISOString(),
    hostname: 'test-machine.local',
    path: '/test/project',
    focus_request: false,
    lastHeartbeat: new Date(FIXED_NOW - 1000).toISOString(),
    ...overrides
  }
}

describe('LockStalenessPolicy', () => {
  describe('same-host branch', () => {
    it('returns true when PID is dead', () => {
      const policy = createLockStalenessPolicy(makeDeps({ alive: false }))
      expect(policy.isStale(makeLock())).toBe(true)
    })

    it('returns false when PID alive and heartbeat fresh', () => {
      const policy = createLockStalenessPolicy(makeDeps())
      expect(policy.isStale(makeLock())).toBe(false)
    })

    it('returns true when PID alive but heartbeat older than HEARTBEAT_STALE_MS', () => {
      const policy = createLockStalenessPolicy(makeDeps())
      const stale = makeLock({
        lastHeartbeat: new Date(FIXED_NOW - HEARTBEAT_STALE_MS - 1).toISOString()
      })
      expect(policy.isStale(stale)).toBe(true)
    })

    it('does NOT treat heartbeat as stale at exactly HEARTBEAT_STALE_MS boundary (strict >)', () => {
      const policy = createLockStalenessPolicy(makeDeps())
      const atBoundary = makeLock({
        lastHeartbeat: new Date(FIXED_NOW - HEARTBEAT_STALE_MS).toISOString()
      })
      expect(policy.isStale(atBoundary)).toBe(false)
    })

    it('falls back to timestamp when lastHeartbeat is missing', () => {
      const policy = createLockStalenessPolicy(makeDeps())
      const legacy = makeLock({
        lastHeartbeat: undefined,
        timestamp: new Date(FIXED_NOW - 60_000).toISOString()
      })
      expect(policy.isStale(legacy)).toBe(true)
    })

    it('treats unparseable heartbeat as stale (NaN guard)', () => {
      const policy = createLockStalenessPolicy(makeDeps())
      const malformed = makeLock({ lastHeartbeat: 'not-a-real-date' })
      expect(policy.isStale(malformed)).toBe(true)
    })
  })

  describe('cross-host branch', () => {
    it('returns false when timestamp within timeout', () => {
      const policy = createLockStalenessPolicy(makeDeps({ hostname: 'this-host' }))
      const lock = makeLock({
        hostname: 'other-host',
        timestamp: new Date(FIXED_NOW - 1000).toISOString()
      })
      expect(policy.isStale(lock)).toBe(false)
    })

    it('returns true when timestamp older than STALE_TIMEOUT_MS + CLOCK_SKEW_BUFFER_MS', () => {
      const policy = createLockStalenessPolicy(makeDeps({ hostname: 'this-host' }))
      const lock = makeLock({
        hostname: 'other-host',
        timestamp: new Date(FIXED_NOW - STALE_TIMEOUT_MS - CLOCK_SKEW_BUFFER_MS - 1).toISOString()
      })
      expect(policy.isStale(lock)).toBe(true)
    })

    it('treats unparseable cross-host timestamp as stale', () => {
      const policy = createLockStalenessPolicy(makeDeps({ hostname: 'this-host' }))
      const lock = makeLock({ hostname: 'other-host', timestamp: 'invalid' })
      expect(policy.isStale(lock)).toBe(true)
    })
  })
})

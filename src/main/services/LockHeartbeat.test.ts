// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LockHeartbeat.test.ts
 *
 * Unit tests for the extracted LockHeartbeat service.
 *
 * Coverage:
 * - start triggers a heartbeat write after HEARTBEAT_INTERVAL_MS + poll tick
 * - powerMonitor 'suspend' prevents poll writes
 * - powerMonitor 'resume' triggers an immediate write to every active lock
 * - powerMonitor 'unlock-screen' also triggers refreshAll
 * - ownership lost (different instanceId) → onOwnershipLost called, timer cleared
 * - lock file deleted → onOwnershipLost called, timer cleared
 * - write failure → lastHeartbeatAt does NOT advance
 * - re-entrance guard: slow write does not cause overlapping writes
 * - focus_request: onFocusRequest hook is called and flag is cleared
 * - disposeAll: clears timers, isDisposing prevents further writes
 * - isDisposing re-check before write (dispose-race guard)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { LockInfo } from '../../shared/ipc/project-lock-schema'
import type { Clock } from '../utils/Clock'
import type { LockHeartbeatDeps } from './LockHeartbeat'
import { createLockHeartbeat, HEARTBEAT_INTERVAL_MS, POLL_INTERVAL_MS } from './LockHeartbeat'

vi.mock('../utils/atomicWrite', () => ({
  atomicWriteJSON: vi.fn()
}))

vi.mock('./LoggingService', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { atomicWriteJSON } from '../utils/atomicWrite'

const mockedAtomicWriteJSON = vi.mocked(atomicWriteJSON)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeFakeClock(startMs = 1_000_000): Clock & { advance(ms: number): void } {
  let now = startMs
  return {
    now: () => now,
    nowIso: () => new Date(now).toISOString(),
    advance(ms: number) {
      now += ms
    }
  }
}

function makeDefaultLockInfo(overrides: Partial<LockInfo> = {}): LockInfo {
  return {
    instanceId: 'test-instance-id',
    pid: process.pid,
    timestamp: new Date(1_000_000).toISOString(),
    hostname: 'test-host',
    path: '/test/project',
    focus_request: false,
    lastHeartbeat: new Date(1_000_000).toISOString(),
    ...overrides
  }
}

interface TestBed {
  clock: ReturnType<typeof makeFakeClock>
  powerMonitor: EventEmitter
  readLockFile: ReturnType<typeof vi.fn>
  onOwnershipLost: ReturnType<typeof vi.fn>
  onFocusRequest: ReturnType<typeof vi.fn>
  deps: LockHeartbeatDeps
}

function makeBed(): TestBed {
  const clock = makeFakeClock()
  const powerMonitor = new EventEmitter()
  const readLockFile = vi.fn<[string], Promise<LockInfo | null>>()
  const onOwnershipLost = vi.fn<[string], void>()
  const onFocusRequest = vi.fn<[LockInfo, string], Promise<void>>().mockResolvedValue(undefined)
  const deps: LockHeartbeatDeps = {
    clock,
    powerMonitor,
    readLockFile,
    onOwnershipLost,
    onFocusRequest
  }
  return { clock, powerMonitor, readLockFile, onOwnershipLost, onFocusRequest, deps }
}

const PROJECT_PATH = '/test/project'
const LOCK_PATH = '/test/locks/abc123.lock'
const LOCK_HASH = 'abc123'
const INSTANCE_ID = 'test-instance-id'

describe('LockHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockedAtomicWriteJSON.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Heartbeat timing
  // ───────────────────────────────────────────────────────────────────────────

  describe('heartbeat timing', () => {
    it('does NOT write a heartbeat before HEARTBEAT_INTERVAL_MS has elapsed', async () => {
      const { clock, readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockResolvedValue(lockInfo)

      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      // Advance less than HEARTBEAT_INTERVAL_MS (just under 5000ms with one tick)
      clock.advance(HEARTBEAT_INTERVAL_MS - 1)
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      expect(mockedAtomicWriteJSON).not.toHaveBeenCalled()
    })

    it('writes a heartbeat after HEARTBEAT_INTERVAL_MS has elapsed and a poll tick fires', async () => {
      const { clock, readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockResolvedValue(lockInfo)

      const handle = service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      // Advance clock past the interval so the next tick will write
      clock.advance(HEARTBEAT_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      expect(mockedAtomicWriteJSON).toHaveBeenCalledWith(
        LOCK_PATH,
        expect.objectContaining({ lastHeartbeat: expect.any(String) })
      )
      // lastHeartbeatAt advances on success
      expect(handle.lastHeartbeatAt()).toBeGreaterThan(1_000_000)

      handle.stop()
    })

    it('does not advance lastHeartbeatAt when the heartbeat write fails', async () => {
      const { clock, readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockResolvedValue(lockInfo)

      mockedAtomicWriteJSON.mockRejectedValue(new Error('EPERM: simulated'))

      const handle = service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })
      const initialTs = handle.lastHeartbeatAt()

      clock.advance(HEARTBEAT_INTERVAL_MS * 2 + POLL_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

      // Writes all failed — lastHeartbeatAt must not advance
      expect(handle.lastHeartbeatAt()).toBe(initialTs)

      handle.stop()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // powerMonitor: suspend / resume
  // ───────────────────────────────────────────────────────────────────────────

  describe('powerMonitor integration', () => {
    it('suspend prevents heartbeat writes during polling ticks', async () => {
      const { clock, powerMonitor, readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockResolvedValue(lockInfo)

      const handle = service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      powerMonitor.emit('suspend')

      // Advance well past HEARTBEAT_INTERVAL_MS
      clock.advance(HEARTBEAT_INTERVAL_MS + POLL_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

      expect(mockedAtomicWriteJSON).not.toHaveBeenCalled()

      handle.stop()
    })

    it('resume writes an immediate heartbeat to every active lock', async () => {
      const { clock, powerMonitor, readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockResolvedValue(lockInfo)

      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      powerMonitor.emit('suspend')
      // Advance well past heartbeat interval while suspended (no writes expected)
      clock.advance(HEARTBEAT_INTERVAL_MS + 1)
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
      expect(mockedAtomicWriteJSON).not.toHaveBeenCalled()

      // Resume must trigger an immediate write
      powerMonitor.emit('resume')
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      expect(mockedAtomicWriteJSON).toHaveBeenCalledWith(
        LOCK_PATH,
        expect.objectContaining({ lastHeartbeat: expect.any(String) })
      )
    })

    it('unlock-screen also triggers refreshAll (immediate write)', async () => {
      const { clock, powerMonitor, readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockResolvedValue(lockInfo)

      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      powerMonitor.emit('lock-screen')
      clock.advance(HEARTBEAT_INTERVAL_MS + 1)
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
      expect(mockedAtomicWriteJSON).not.toHaveBeenCalled()

      powerMonitor.emit('unlock-screen')
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      expect(mockedAtomicWriteJSON).toHaveBeenCalledWith(
        LOCK_PATH,
        expect.objectContaining({ lastHeartbeat: expect.any(String) })
      )
    })

    it('refreshAll covers multiple active locks', async () => {
      const readLockFile = vi.fn<[string], Promise<LockInfo | null>>()
      const deps: LockHeartbeatDeps = {
        clock: makeFakeClock(),
        powerMonitor: new EventEmitter(),
        readLockFile,
        onOwnershipLost: vi.fn()
      }
      const service = createLockHeartbeat(deps)

      const lockInfo1 = makeDefaultLockInfo({ path: '/test/project1' })
      const lockInfo2 = makeDefaultLockInfo({ path: '/test/project2' })

      readLockFile.mockImplementation((lockPath) => {
        if (lockPath === '/locks/1.lock') return Promise.resolve(lockInfo1)
        if (lockPath === '/locks/2.lock') return Promise.resolve(lockInfo2)
        return Promise.resolve(null)
      })

      service.start({ projectPath: '/test/project1', lockPath: '/locks/1.lock', lockHash: 'h1', instanceId: INSTANCE_ID })
      service.start({ projectPath: '/test/project2', lockPath: '/locks/2.lock', lockHash: 'h2', instanceId: INSTANCE_ID })

      await service.refreshAll()

      expect(mockedAtomicWriteJSON).toHaveBeenCalledTimes(2)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Ownership loss
  // ───────────────────────────────────────────────────────────────────────────

  describe('ownership loss', () => {
    it('calls onOwnershipLost and stops polling when lock file is deleted', async () => {
      const { readLockFile, onOwnershipLost, deps } = makeBed()
      const service = createLockHeartbeat(deps)

      readLockFile.mockResolvedValue(null)

      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      expect(onOwnershipLost).toHaveBeenCalledWith(PROJECT_PATH)

      // Subsequent ticks must NOT trigger further reads (timer was cleared)
      vi.clearAllMocks()
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
      expect(readLockFile).not.toHaveBeenCalled()
    })

    it('calls onOwnershipLost when a different instanceId is found in the lock file', async () => {
      const { readLockFile, onOwnershipLost, deps } = makeBed()
      const service = createLockHeartbeat(deps)

      const stolenLock = makeDefaultLockInfo({ instanceId: 'other-instance' })
      readLockFile.mockResolvedValue(stolenLock)

      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      expect(onOwnershipLost).toHaveBeenCalledWith(PROJECT_PATH)

      // Timer should be cleared — no more reads
      vi.clearAllMocks()
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
      expect(readLockFile).not.toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Focus request
  // ───────────────────────────────────────────────────────────────────────────

  describe('focus_request handling', () => {
    it('calls onFocusRequest hook and clears focus_request in the lock file', async () => {
      const { readLockFile, onFocusRequest, deps } = makeBed()
      const service = createLockHeartbeat(deps)

      const lockWithFocus = makeDefaultLockInfo({ focus_request: true, requester_pid: 88888 })
      readLockFile.mockResolvedValue(lockWithFocus)

      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      expect(onFocusRequest).toHaveBeenCalledWith(lockWithFocus, PROJECT_PATH)
      expect(mockedAtomicWriteJSON).toHaveBeenCalledWith(
        LOCK_PATH,
        expect.objectContaining({ focus_request: false, requester_pid: undefined })
      )
    })

    it('does not call onFocusRequest when it is not provided', async () => {
      const readLockFile = vi.fn<[string], Promise<LockInfo | null>>()
      const deps: LockHeartbeatDeps = {
        clock: makeFakeClock(),
        powerMonitor: new EventEmitter(),
        readLockFile,
        onOwnershipLost: vi.fn()
        // onFocusRequest intentionally omitted
      }
      const service = createLockHeartbeat(deps)

      const lockWithFocus = makeDefaultLockInfo({ focus_request: true, requester_pid: 12345 })
      readLockFile.mockResolvedValue(lockWithFocus)

      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      // atomicWriteJSON still runs (clearing the flag) and does not throw
      expect(mockedAtomicWriteJSON).toHaveBeenCalledWith(
        LOCK_PATH,
        expect.objectContaining({ focus_request: false })
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Re-entrance guard
  // ───────────────────────────────────────────────────────────────────────────

  describe('re-entrance guard', () => {
    it('skips a polling tick if the previous tick has not finished (slow write)', async () => {
      const { clock, readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockResolvedValue(lockInfo)

      let concurrentInvocations = 0
      let maxConcurrent = 0
      mockedAtomicWriteJSON.mockImplementation(async () => {
        concurrentInvocations++
        maxConcurrent = Math.max(maxConcurrent, concurrentInvocations)
        // Simulate slow disk: 1500ms write
        await new Promise<void>((resolve) => setTimeout(resolve, 1500))
        concurrentInvocations--
      })

      const handle = service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      clock.advance(HEARTBEAT_INTERVAL_MS * 2)
      await vi.advanceTimersByTimeAsync(10_000)

      expect(maxConcurrent).toBeLessThanOrEqual(1)

      handle.stop()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // handle.stop()
  // ───────────────────────────────────────────────────────────────────────────

  describe('handle.stop()', () => {
    it('stops polling after stop() is called', async () => {
      const { clock, readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockResolvedValue(lockInfo)

      const handle = service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      handle.stop()

      vi.clearAllMocks()
      clock.advance(HEARTBEAT_INTERVAL_MS + POLL_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

      expect(readLockFile).not.toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // disposeAll
  // ───────────────────────────────────────────────────────────────────────────

  describe('disposeAll', () => {
    it('stops all timers and prevents further writes', async () => {
      const { clock, readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockResolvedValue(lockInfo)

      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      await service.disposeAll()

      vi.clearAllMocks()
      clock.advance(HEARTBEAT_INTERVAL_MS + POLL_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

      expect(readLockFile).not.toHaveBeenCalled()
      expect(mockedAtomicWriteJSON).not.toHaveBeenCalled()
    })

    it('prevents refreshAll from running after disposeAll', async () => {
      const { readLockFile, deps } = makeBed()
      const service = createLockHeartbeat(deps)
      readLockFile.mockResolvedValue(makeDefaultLockInfo())

      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      await service.disposeAll()
      mockedAtomicWriteJSON.mockClear()

      await service.refreshAll()

      expect(mockedAtomicWriteJSON).not.toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dispose-race guard (isDisposing re-check before write)
  // ───────────────────────────────────────────────────────────────────────────

  describe('dispose-race guard', () => {
    it('skips the heartbeat write when isDisposing flips mid-flight', async () => {
      const { clock, readLockFile, deps } = makeBed()

      // We need to grab the service object to flip isDisposing.
      // createLockHeartbeat uses a closure, so we simulate this by
      // having readLockFile pause until after we call disposeAll.
      let resolveRead!: () => void
      const blockedRead = new Promise<void>((res) => {
        resolveRead = res
      })

      let writeCountAfterDispose = 0
      const originalImpl = mockedAtomicWriteJSON.getMockImplementation()
      mockedAtomicWriteJSON.mockImplementation(async (...args) => {
        // By the time we write, disposeAll has already been called
        writeCountAfterDispose++
        if (originalImpl) await originalImpl(...args)
      })

      const lockInfo = makeDefaultLockInfo()
      readLockFile.mockImplementation(async () => {
        await blockedRead
        return lockInfo
      })

      const service = createLockHeartbeat(deps)
      service.start({ projectPath: PROJECT_PATH, lockPath: LOCK_PATH, lockHash: LOCK_HASH, instanceId: INSTANCE_ID })

      // Advance clock so the tick will want to write
      clock.advance(HEARTBEAT_INTERVAL_MS + POLL_INTERVAL_MS)
      // Trigger one tick (readLockFile is now paused)
      const tickPromise = vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      // Flip isDisposing while the tick is mid-flight
      await service.disposeAll()

      // Unblock the read
      resolveRead()
      await tickPromise
      await Promise.resolve()
      await Promise.resolve()

      // The write guard should have prevented it
      expect(writeCountAfterDispose).toBe(0)
    })
  })
})

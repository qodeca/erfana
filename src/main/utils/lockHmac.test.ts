// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn<[], boolean>(() => true),
  encryptString: vi.fn<[string], Buffer>((s) => Buffer.from('mock-key:' + s))
}))

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage
}))

vi.mock('../services/LoggingService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { signLock, verifyLock, _resetForTesting } from './lockHmac'
import type { LockInfo } from '../../shared/ipc/project-lock-schema'

const baseLock: LockInfo = {
  instanceId: '550e8400-e29b-41d4-a716-446655440000',
  pid: 12345,
  timestamp: '2026-06-07T20:00:00.000Z',
  hostname: 'test-machine.local',
  path: '/test/project',
  focus_request: false,
  lastHeartbeat: '2026-06-07T20:00:00.000Z'
}

describe('lockHmac', () => {
  beforeEach(() => {
    _resetForTesting()
    mockSafeStorage.isEncryptionAvailable.mockReset()
    mockSafeStorage.encryptString.mockReset()
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    mockSafeStorage.encryptString.mockImplementation((s) => Buffer.from('mock-key:' + s))
  })

  it('signLock + verifyLock roundtrip → valid', () => {
    const hmac = signLock(baseLock)
    expect(hmac).toBeDefined()
    expect(hmac).toMatch(/^[0-9a-f]{64}$/)
    const result = verifyLock({ ...baseLock, hmac: hmac! })
    expect(result).toBe('valid')
  })

  it('verifyLock returns invalid when a signed field is tampered', () => {
    const hmac = signLock(baseLock)!
    const tampered: LockInfo = { ...baseLock, pid: 99999, hmac }
    expect(verifyLock(tampered)).toBe('invalid')
  })

  it('verifyLock returns invalid when path is tampered', () => {
    const hmac = signLock(baseLock)!
    const tampered: LockInfo = { ...baseLock, path: '/other/project', hmac }
    expect(verifyLock(tampered)).toBe('invalid')
  })

  it('verifyLock returns missing when hmac is absent (legacy lock)', () => {
    const legacy: LockInfo = { ...baseLock }
    delete (legacy as Partial<LockInfo>).hmac
    expect(verifyLock(legacy)).toBe('missing')
  })

  it('signLock returns undefined when safeStorage is unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)
    expect(signLock(baseLock)).toBeUndefined()
  })

  it('verifyLock returns no-key when safeStorage is unavailable but hmac is present', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)
    const fakeHmac = 'a'.repeat(64)
    expect(verifyLock({ ...baseLock, hmac: fakeHmac })).toBe('no-key')
  })

  it('safeStorage availability is checked only once (key derivation is cached)', () => {
    signLock(baseLock)
    signLock(baseLock)
    signLock(baseLock)
    expect(mockSafeStorage.isEncryptionAvailable).toHaveBeenCalledTimes(1)
    expect(mockSafeStorage.encryptString).toHaveBeenCalledTimes(1)
  })

  it('handles safeStorage throws gracefully (returns no-key)', () => {
    mockSafeStorage.encryptString.mockImplementation(() => { throw new Error('safe-storage failure') })
    expect(signLock(baseLock)).toBeUndefined()
    // After a throw, getKey caches the failed state — next call won't retry
    expect(signLock(baseLock)).toBeUndefined()
    expect(mockSafeStorage.encryptString).toHaveBeenCalledTimes(1)
  })

  it('signs and verifies focus_request changes correctly', () => {
    const withFocus: LockInfo = { ...baseLock, focus_request: true, requester_pid: 7777 }
    const hmac = signLock(withFocus)!
    expect(verifyLock({ ...withFocus, hmac })).toBe('valid')
    // Tampering focus_request invalidates
    expect(verifyLock({ ...withFocus, focus_request: false, hmac })).toBe('invalid')
  })
})

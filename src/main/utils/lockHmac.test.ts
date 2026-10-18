// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Randomized like Windows DPAPI: the same plaintext encrypts differently each call.
const randomizedEncrypt = (s: string): Buffer =>
  Buffer.from(`${Math.random().toString(36).slice(2)}|${s}`)
const randomizedDecrypt = (b: Buffer): string => b.toString().split('|').slice(1).join('|')

const mockSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn<[], boolean>(() => true),
  encryptString: vi.fn<[string], Buffer>(),
  decryptString: vi.fn<[Buffer], string>()
}))

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage
}))

// In-memory stand-in for the secret file
const files = vi.hoisted(() => new Map<string, Buffer>())

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn((path: string) => {
    const data = files.get(path)
    if (!data) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return data
  }),
  writeFileSync: vi.fn((path: string, data: Buffer, opts?: { flag?: string }) => {
    if (opts?.flag === 'wx' && files.has(path)) {
      throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    }
    files.set(path, data)
  })
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
    mockSafeStorage.decryptString.mockReset()
    files.clear()
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    mockSafeStorage.encryptString.mockImplementation(randomizedEncrypt)
    mockSafeStorage.decryptString.mockImplementation(randomizedDecrypt)
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

  it('signature is stable across calls and restarts with a randomized encrypt mock', () => {
    const first = signLock(baseLock)
    // Simulate a restart (or a second instance): fresh in-process cache, same secret file
    _resetForTesting()
    const second = signLock(baseLock)
    expect(second).toBe(first)
    expect(verifyLock({ ...baseLock, hmac: first! })).toBe('valid')
  })

  it('stores the secret encrypted, never as the readable key', () => {
    signLock(baseLock)
    const [stored] = [...files.values()]
    expect(stored.toString()).toContain('|')
    expect(mockSafeStorage.encryptString).toHaveBeenCalledTimes(1)
    expect(mockSafeStorage.encryptString.mock.calls[0][0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('regenerates the secret when the stored one cannot be decrypted', () => {
    signLock(baseLock)
    mockSafeStorage.decryptString.mockImplementationOnce(() => {
      throw new Error('keychain reset')
    })
    _resetForTesting()
    expect(signLock(baseLock)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('migration: a lock signed with the legacy ciphertext key still verifies', async () => {
    // Older builds used encryptString('erfana-lock-hmac-v1') itself as the HMAC key
    const legacyKey = Buffer.from('legacy-ciphertext')
    mockSafeStorage.encryptString.mockImplementation((s) =>
      s === 'erfana-lock-hmac-v1' ? legacyKey : randomizedEncrypt(s)
    )
    const { createHmac } = await import('node:crypto')
    const legacyHmac = createHmac('sha256', legacyKey)
      .update(
        JSON.stringify({
          instanceId: baseLock.instanceId,
          pid: baseLock.pid,
          timestamp: baseLock.timestamp,
          hostname: baseLock.hostname,
          path: baseLock.path,
          focus_request: baseLock.focus_request,
          requester_pid: baseLock.requester_pid,
          lastHeartbeat: baseLock.lastHeartbeat
        })
      )
      .digest('hex')

    expect(verifyLock({ ...baseLock, hmac: legacyHmac })).toBe('valid')
    // New signatures no longer use the legacy key
    expect(signLock(baseLock)).not.toBe(legacyHmac)
    expect(verifyLock({ ...baseLock, hmac: 'f'.repeat(64) })).toBe('invalid')
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

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Purpose-bound signing (spec 025, ADR 0009 decisions 3, 6, 7 and 11), run per
 * `safeStorage` backend. Split from lockHmac.test.ts because these tests move
 * `process.platform`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn<() => boolean>(() => true),
  encryptString: vi.fn<(...args: [string]) => Buffer>((s) => Buffer.from(`enc|${s}`)),
  decryptString: vi.fn<(...args: [Buffer]) => string>((b) => b.toString().slice(4)),
  getSelectedStorageBackend: vi.fn<() => string>(() => 'gnome_libsecret')
}))
vi.mock('electron', () => ({ safeStorage: mockSafeStorage }))

const files = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn((path: string) => {
    const data = files.get(path)
    if (!data) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return data
  }),
  writeFileSync: vi.fn((path: string, data: Buffer) => files.set(path, data)),
  linkSync: vi.fn((from: string, to: string) => {
    if (files.has(to)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    files.set(to, files.get(from)!)
  }),
  unlinkSync: vi.fn((path: string) => files.delete(path))
}))
vi.mock('../services/LoggingService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  _resetForTesting,
  hasHmacKey,
  signForPurpose,
  signLock,
  verifyForPurpose,
  verifyLock
} from './lockHmac'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setBackend(platform: NodeJS.Platform, backend: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  mockSafeStorage.getSelectedStorageBackend.mockReturnValue(backend)
}

const KEYED: Array<[NodeJS.Platform, string]> = [
  ['darwin', 'keychain'],
  ['win32', 'dpapi'],
  ['linux', 'gnome_libsecret'],
  ['linux', 'kwallet'],
  ['linux', 'kwallet5'],
  ['linux', 'kwallet6']
]

describe('lockHmac purpose signing', () => {
  beforeEach(() => {
    _resetForTesting()
    files.clear()
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform)
  })

  describe.each(KEYED)('on %s with the %s backend', (platform, backend) => {
    beforeEach(() => setBackend(platform, backend))

    it('has a key and round-trips a signature', () => {
      expect(hasHmacKey()).toBe(true)
      const digest = signForPurpose('browser-profile-marker', 'body')
      expect(digest).toMatch(/^[0-9a-f]{64}$/)
      expect(verifyForPurpose('browser-profile-marker', 'body', digest)).toBe('valid')
    })

    it('refuses a changed body', () => {
      const digest = signForPurpose('browser-profile-marker', 'body')
      expect(verifyForPurpose('browser-profile-marker', 'body2', digest)).toBe('invalid')
    })

    it('binds a digest to its purpose', () => {
      const digest = signForPurpose('browser-profile-marker', 'body')
      expect(verifyForPurpose('browser-pending-delete', 'body', digest)).toBe('invalid')
    })
  })

  describe('on Linux with the basic_text backend (no key, ADR 0009 decision 7)', () => {
    beforeEach(() => setBackend('linux', 'basic_text'))

    it('has no key, signs nothing and verifies nothing', () => {
      expect(hasHmacKey()).toBe(false)
      expect(signForPurpose('browser-profile-marker', 'body')).toBeUndefined()
      expect(verifyForPurpose('browser-profile-marker', 'body', 'ab'.repeat(32))).toBe('no-key')
    })
  })

  it('has no key when safeStorage encryption is unavailable', () => {
    setBackend('win32', 'dpapi')
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)
    expect(hasHmacKey()).toBe(false)
    expect(signForPurpose('p', 'body')).toBeUndefined()
  })

  it('reports a missing digest before looking for a key', () => {
    setBackend('linux', 'basic_text')
    expect(verifyForPurpose('p', 'body', undefined)).toBe('missing')
    expect(verifyForPurpose('p', 'body', '')).toBe('missing')
  })

  it('never lets a purpose digest pass as a lock signature, or the reverse', () => {
    setBackend('darwin', 'keychain')
    const lock = {
      instanceId: '550e8400-e29b-41d4-a716-446655440000',
      pid: 1,
      timestamp: '2026-11-02T00:00:00.000Z',
      hostname: 'h',
      path: '/p',
      focus_request: false,
      lastHeartbeat: '2026-11-02T00:00:00.000Z'
    }
    const lockDigest = signLock(lock)
    const body = JSON.stringify(lock)
    expect(verifyForPurpose('project-lock', body, lockDigest)).toBe('invalid')
    expect(verifyLock({ ...lock, hmac: signForPurpose('project-lock', body) })).toBe('invalid')
  })

  it('rejects a digest of the wrong length without throwing', () => {
    setBackend('darwin', 'keychain')
    expect(verifyForPurpose('p', 'body', 'abc')).toBe('invalid')
  })
})

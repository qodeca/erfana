// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ApiKeyService
 *
 * Tests API key storage, retrieval, and encryption via Electron safeStorage.
 *
 * @see Issue #75 - Media import with transcription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

// =============================================================================
// Test constants – platform-safe home directory for assertions
// =============================================================================

const MOCK_HOME = path.join(os.tmpdir(), 'erfana-test-home')

// =============================================================================
// Mock electron
// =============================================================================

const mockSafeStorage = {
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  encryptStringAsync: vi.fn(async (str: string) => Buffer.from(`encrypted:${str}`)),
  decryptStringAsync: vi.fn(async (buf: Buffer) => {
    const text = buf.toString()
    if (!text.startsWith('encrypted:')) throw new Error('Decryption failed')
    return { result: text.replace('encrypted:', ''), shouldReEncrypt: false }
  })
}

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage
}))

// =============================================================================
// Mock fs/promises
// =============================================================================

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockUnlink = vi.fn()
const mockAccess = vi.fn()
const mockMkdir = vi.fn()

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  unlink: mockUnlink,
  access: mockAccess,
  mkdir: mockMkdir
}))

// =============================================================================
// Mock os
// =============================================================================

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const { join } = await import('path')
  return {
    ...actual,
    homedir: () => join(actual.tmpdir(), 'erfana-test-home')
  }
})

// =============================================================================
// Mock LoggingService
// =============================================================================

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}

vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

// =============================================================================
// Tests
// =============================================================================

describe('ApiKeyService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSafeStorage.isAsyncEncryptionAvailable.mockResolvedValue(true)
    mockSafeStorage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)
    mockAccess.mockResolvedValue(undefined)
  })

  // ===========================================================================
  // storeKey tests
  // ===========================================================================

  describe('storeKey', () => {
    it('should encrypt and store API key', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.storeKey('openai', 'sk-test-key-123')

      expect(mockSafeStorage.encryptStringAsync).toHaveBeenCalledWith('sk-test-key-123')
      expect(mockWriteFile).toHaveBeenCalledWith(
        path.join(MOCK_HOME, '.erfana', 'openai-api-key.enc'),
        expect.any(Buffer),
        { mode: 0o600 }
      )
    })

    it('should create directory before storing', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.storeKey('openai', 'sk-test-key')

      expect(mockMkdir).toHaveBeenCalledWith(path.join(MOCK_HOME, '.erfana'), { recursive: true, mode: 0o700 })
    })

    it('should refuse to store (no plaintext write) when encryption is unavailable', async () => {
      mockSafeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false)

      const { createApiKeyService } = await import('./ApiKeyService')
      const { ApiKeyEncryptionUnavailableError } = await import('./apiKeyErrors')
      const service = createApiKeyService()

      await expect(service.storeKey('openai', 'sk-test-key')).rejects.toBeInstanceOf(
        ApiKeyEncryptionUnavailableError
      )

      expect(mockSafeStorage.encryptStringAsync).not.toHaveBeenCalled()
      expect(mockWriteFile).not.toHaveBeenCalled()
      expect(service.hasKey('openai')).toBe(false)
    })

    it.skipIf(process.platform !== 'linux')(
      'should refuse to store when Linux uses the basic_text backend',
      async () => {
        mockSafeStorage.getSelectedStorageBackend.mockReturnValue('basic_text')

        const { createApiKeyService } = await import('./ApiKeyService')
        const service = createApiKeyService()

        await expect(service.storeKey('openai', 'sk-test-key')).rejects.toThrow(/not saved/)
        expect(mockWriteFile).not.toHaveBeenCalled()
      }
    )

    it('should mark key as known after storing', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      expect(service.hasKey('openai')).toBe(false)

      await service.storeKey('openai', 'sk-test-key')

      expect(service.hasKey('openai')).toBe(true)
    })
  })

  // ===========================================================================
  // getKey tests
  // ===========================================================================

  describe('getKey', () => {
    it('should decrypt and return stored key', async () => {
      const encrypted = Buffer.from('encrypted:sk-test-key')
      mockReadFile.mockResolvedValue(encrypted)

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      const key = await service.getKey('openai')

      expect(key).toBe('sk-test-key')
      expect(mockSafeStorage.decryptStringAsync).toHaveBeenCalledWith(encrypted)
    })

    it('should return null when key file does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      mockAccess.mockRejectedValue(error)

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      const key = await service.getKey('openai')

      expect(key).toBeNull()
      expect(mockReadFile).not.toHaveBeenCalled()
    })

    it('migration: reads a legacy plaintext file and rewrites it encrypted', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('sk-plaintext-key'))

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      const key = await service.getKey('openai')

      expect(key).toBe('sk-plaintext-key')
      expect(mockWriteFile).toHaveBeenCalledWith(
        path.join(MOCK_HOME, '.erfana', 'openai-api-key.enc'),
        Buffer.from('encrypted:sk-plaintext-key'),
        { mode: 0o600 }
      )
    })

    it('migration: leaves a legacy plaintext file readable when encryption is unavailable', async () => {
      mockSafeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false)
      mockReadFile.mockResolvedValue(Buffer.from('sk-plaintext-key'))

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      expect(await service.getKey('openai')).toBe('sk-plaintext-key')
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('returns null for an encrypted file when encryption is unavailable', async () => {
      mockSafeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false)
      mockReadFile.mockResolvedValue(Buffer.from([0x76, 0x31, 0x30, 0x01, 0x02, 0xff]))

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      expect(await service.getKey('openai')).toBeNull()
    })

    it('re-encrypts when the OS asks for it', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('encrypted:sk-old'))
      mockSafeStorage.decryptStringAsync.mockResolvedValueOnce({
        result: 'sk-old',
        shouldReEncrypt: true
      })

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      expect(await service.getKey('openai')).toBe('sk-old')
      expect(mockWriteFile).toHaveBeenCalledTimes(1)
    })

    it('should return null and log error on read failure', async () => {
      mockReadFile.mockRejectedValue(new Error('Permission denied'))

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      const key = await service.getKey('openai')

      expect(key).toBeNull()
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to read API key',
        expect.any(Error)
      )
    })
  })

  // ===========================================================================
  // hasKey tests
  // ===========================================================================

  describe('hasKey', () => {
    it('should return false for unknown service', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      expect(service.hasKey('openai')).toBe(false)
    })

    it('should return true after storeKey', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.storeKey('openai', 'sk-key')

      expect(service.hasKey('openai')).toBe(true)
    })

    it('should return false after clearKey', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.storeKey('openai', 'sk-key')
      await service.clearKey('openai')

      expect(service.hasKey('openai')).toBe(false)
    })
  })

  // ===========================================================================
  // clearKey tests
  // ===========================================================================

  describe('clearKey', () => {
    it('should delete the key file', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.clearKey('openai')

      expect(mockUnlink).toHaveBeenCalledWith(path.join(MOCK_HOME, '.erfana', 'openai-api-key.enc'))
    })

    it('should handle ENOENT gracefully (file does not exist)', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      mockUnlink.mockRejectedValue(error)

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      // Should not throw
      await expect(service.clearKey('openai')).resolves.toBeUndefined()
      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('should log error for non-ENOENT failures', async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      mockUnlink.mockRejectedValue(error)

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.clearKey('openai')

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to clear API key',
        expect.any(Error)
      )
    })

    it('should remove from known keys cache', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.storeKey('openai', 'sk-key')
      expect(service.hasKey('openai')).toBe(true)

      await service.clearKey('openai')
      expect(service.hasKey('openai')).toBe(false)
    })
  })

  // ===========================================================================
  // initializeCache tests
  // ===========================================================================

  describe('initializeCache', () => {
    it('should populate cache for existing keys', async () => {
      mockAccess.mockResolvedValue(undefined)

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.initializeCache(['openai', 'anthropic'])

      expect(service.hasKey('openai')).toBe(true)
      expect(service.hasKey('anthropic')).toBe(true)
    })

    it('should not cache missing keys', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.initializeCache(['openai'])

      expect(service.hasKey('openai')).toBe(false)
    })
  })

  // ===========================================================================
  // serviceName validation
  // ===========================================================================

  describe('serviceName validation', () => {
    it('should reject service names with path traversal characters', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await expect(service.storeKey('../etc/passwd', 'key')).rejects.toThrow('Invalid service name')
    })

    it('should reject service names with slashes', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await expect(service.storeKey('foo/bar', 'key')).rejects.toThrow('Invalid service name')
    })

    it('should reject service names with uppercase letters', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await expect(service.storeKey('OpenAI', 'key')).rejects.toThrow('Invalid service name')
    })

    it('should accept valid service names', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.storeKey('openai', 'sk-key')
      expect(mockWriteFile).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Singleton pattern
  // ===========================================================================

  describe('singleton', () => {
    it('should export singleton instance', async () => {
      const { apiKeyService } = await import('./ApiKeyService')

      expect(apiKeyService).toBeDefined()
      expect(typeof apiKeyService.storeKey).toBe('function')
      expect(typeof apiKeyService.getKey).toBe('function')
      expect(typeof apiKeyService.hasKey).toBe('function')
      expect(typeof apiKeyService.clearKey).toBe('function')
    })
  })

  // ===========================================================================
  // Multiple services
  // ===========================================================================

  describe('multiple services', () => {
    it('should store keys independently per service', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.storeKey('openai', 'sk-openai')
      await service.storeKey('anthropic', 'sk-anthropic')

      expect(service.hasKey('openai')).toBe(true)
      expect(service.hasKey('anthropic')).toBe(true)

      expect(mockWriteFile).toHaveBeenCalledWith(
        path.join(MOCK_HOME, '.erfana', 'openai-api-key.enc'),
        expect.any(Buffer),
        { mode: 0o600 }
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        path.join(MOCK_HOME, '.erfana', 'anthropic-api-key.enc'),
        expect.any(Buffer),
        { mode: 0o600 }
      )
    })

    it('should clear keys independently', async () => {
      const { createApiKeyService } = await import('./ApiKeyService')
      const service = createApiKeyService()

      await service.storeKey('openai', 'sk-openai')
      await service.storeKey('anthropic', 'sk-anthropic')

      await service.clearKey('openai')

      expect(service.hasKey('openai')).toBe(false)
      expect(service.hasKey('anthropic')).toBe(true)
    })
  })
})

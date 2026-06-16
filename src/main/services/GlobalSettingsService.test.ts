// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * GlobalSettingsService Tests
 *
 * @see Issue #50 - global settings service
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GlobalSettingsService } from './GlobalSettingsService'
import { ErrorCode } from '../../shared/errors'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
  copyFile: vi.fn(),
  constants: { R_OK: 4 }
}))

// Mock os.homedir
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock-home')
}))

// Mock LoggingService
vi.mock('./LoggingService', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn()
  }
}))

import { readFile, writeFile, mkdir, access, copyFile } from 'fs/promises'
import { logger } from './LoggingService'

describe('GlobalSettingsService', () => {
  let service: GlobalSettingsService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new GlobalSettingsService()
  })

  describe('constructor', () => {
    it('sets settings path to ~/.erfana/settings.json', () => {
      expect(service.getSettingsPath()).toBe('/mock-home/.erfana/settings.json')
    })

    it('initializes with default settings', () => {
      const settings = service.getSettings()
      expect(settings.logging.level).toBe('info')
    })
  })

  describe('initialize()', () => {
    it('creates ~/.erfana/ directory if missing', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(mkdir).mockResolvedValue(undefined)

      await service.initialize()

      expect(mkdir).toHaveBeenCalledWith('/mock-home/.erfana', { recursive: true })
    })

    it('loads existing valid settings file', async () => {
      const settingsContent = JSON.stringify({
        logging: { level: 'debug' }
      })

      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readFile).mockResolvedValue(settingsContent)

      await service.initialize()

      const settings = service.getSettings()
      expect(settings.logging.level).toBe('debug')
    })

    it('uses defaults when file is missing', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await service.initialize()

      const settings = service.getSettings()
      expect(settings.logging.level).toBe('info')
    })

    it('creates initial settings file when missing', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await service.initialize()

      expect(writeFile).toHaveBeenCalledWith(
        '/mock-home/.erfana/settings.json',
        expect.stringContaining('"logging"'),
        'utf-8'
      )
    })

    it('recovers from JSON parse errors (backup + reset)', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readFile).mockResolvedValue('{ invalid json }')
      vi.mocked(copyFile).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await service.initialize()

      expect(copyFile).toHaveBeenCalledWith(
        '/mock-home/.erfana/settings.json',
        '/mock-home/.erfana/settings.json.bak'
      )
      expect(logger.warn).toHaveBeenCalledWith(
        'Global settings file corrupted',
        expect.objectContaining({
          reason: 'Invalid JSON',
          action: 'reset to defaults'
        })
      )

      const settings = service.getSettings()
      expect(settings.logging.level).toBe('info')
    })

    it('recovers from Zod validation errors', async () => {
      const invalidSettings = JSON.stringify({
        logging: { level: 'invalid-level' }
      })

      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readFile).mockResolvedValue(invalidSettings)
      vi.mocked(copyFile).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await service.initialize()

      expect(copyFile).toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        'Global settings file corrupted',
        expect.objectContaining({
          reason: 'Validation failed',
          action: 'reset to defaults'
        })
      )

      const settings = service.getSettings()
      expect(settings.logging.level).toBe('info')
    })

    it('throws AppError when directory creation fails', async () => {
      const mkdirError = new Error('Permission denied')
      vi.mocked(mkdir).mockRejectedValue(mkdirError)

      await expect(service.initialize()).rejects.toMatchObject({
        code: ErrorCode.GLOBAL_SETTINGS_DIR_CREATE_FAILED,
        message: expect.stringContaining('Permission denied')
      })
    })
  })

  describe('getSettings()', () => {
    it('returns current settings synchronously', () => {
      const settings = service.getSettings()
      expect(settings).toBeDefined()
      expect(settings.logging).toBeDefined()
    })

    it('returns cached settings after initialization', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ logging: { level: 'warn' } }))

      await service.initialize()

      const settings = service.getSettings()
      expect(settings.logging.level).toBe('warn')
    })
  })

  describe('getSetting()', () => {
    it('returns logging config', () => {
      const logging = service.getSetting('logging')
      expect(logging).toBeDefined()
      expect(logging.level).toBe('info')
    })

    it('returns $schema when present', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ $schema: 'test-schema' })
      )

      await service.initialize()

      const schema = service.getSetting('$schema')
      expect(schema).toBe('test-schema')
    })
  })

  describe('setSetting()', () => {
    beforeEach(async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(writeFile).mockResolvedValue(undefined)
      await service.initialize()
      vi.clearAllMocks() // Clear init calls
    })

    it('validates value against schema', async () => {
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await expect(
        service.setSetting('logging', { level: 'invalid-level' } as any)
      ).rejects.toMatchObject({
        code: ErrorCode.GLOBAL_SETTINGS_VALIDATION_FAILED
      })

      expect(writeFile).not.toHaveBeenCalled()
    })

    it('persists to disk', async () => {
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await service.setSetting('logging', { level: 'debug' })

      expect(writeFile).toHaveBeenCalledWith(
        '/mock-home/.erfana/settings.json',
        expect.stringContaining('"debug"'),
        'utf-8'
      )
    })

    it('updates in-memory settings', async () => {
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await service.setSetting('logging', { level: 'error' })

      const settings = service.getSettings()
      expect(settings.logging.level).toBe('error')
    })

    it('notifies listeners', async () => {
      vi.mocked(writeFile).mockResolvedValue(undefined)

      const listener = vi.fn()
      service.onSettingsChanged(listener)

      await service.setSetting('logging', { level: 'warn' })

      expect(listener).toHaveBeenCalledWith({
        settings: expect.objectContaining({ logging: { level: 'warn' } }),
        changedKey: 'logging',
        previousValue: { level: 'info' }
      })
    })

    it('skips $schema updates (metadata only)', async () => {
      await service.setSetting('$schema', 'new-schema')

      expect(writeFile).not.toHaveBeenCalled()
    })

    it('rejects invalid values with AppError', async () => {
      // 'verbose' is not a valid level (valid: trace, debug, info, warn, error, fatal)
      await expect(
        service.setSetting('logging', { level: 'verbose' } as any)
      ).rejects.toMatchObject({
        code: ErrorCode.GLOBAL_SETTINGS_VALIDATION_FAILED,
        message: expect.stringContaining('Invalid settings value')
      })
    })

    it('includes validation details in error message', async () => {
      try {
        await service.setSetting('logging', { level: 'bad' } as any)
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.message).toContain('logging.level')
      }
    })

    it('throws AppError on write failure', async () => {
      const writeError = new Error('Disk full')
      vi.mocked(writeFile).mockRejectedValue(writeError)

      await expect(
        service.setSetting('logging', { level: 'debug' })
      ).rejects.toMatchObject({
        code: ErrorCode.GLOBAL_SETTINGS_WRITE_FAILED,
        message: expect.stringContaining('Disk full')
      })
    })
  })

  describe('resetSettings()', () => {
    beforeEach(async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ logging: { level: 'debug' } }))
      vi.mocked(writeFile).mockResolvedValue(undefined)
      await service.initialize()
      vi.clearAllMocks()
    })

    it('backs up current file', async () => {
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(copyFile).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await service.resetSettings()

      expect(copyFile).toHaveBeenCalledWith(
        '/mock-home/.erfana/settings.json',
        '/mock-home/.erfana/settings.json.bak'
      )
    })

    it('writes defaults', async () => {
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(copyFile).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await service.resetSettings()

      expect(writeFile).toHaveBeenCalledWith(
        '/mock-home/.erfana/settings.json',
        expect.stringContaining('"level": "info"'),
        'utf-8'
      )
    })

    it('updates in-memory settings to defaults', async () => {
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(copyFile).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)

      // Service was initialized with debug level
      expect(service.getSettings().logging.level).toBe('debug')

      await service.resetSettings()

      expect(service.getSettings().logging.level).toBe('info')
    })

    it('notifies listeners', async () => {
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(copyFile).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)

      const listener = vi.fn()
      service.onSettingsChanged(listener)

      const previousSettings = service.getSettings()
      await service.resetSettings()

      expect(listener).toHaveBeenCalledWith({
        settings: expect.objectContaining({ logging: { level: 'info' } }),
        changedKey: 'reset',
        previousValue: previousSettings
      })
    })

    it('continues if backup fails (best-effort)', async () => {
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(copyFile).mockRejectedValue(new Error('Backup failed'))
      vi.mocked(writeFile).mockResolvedValue(undefined)

      await expect(service.resetSettings()).resolves.toBeUndefined()

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to backup settings',
        expect.objectContaining({ error: 'Backup failed' })
      )
      expect(writeFile).toHaveBeenCalled() // Should still write defaults
    })
  })

  describe('onSettingsChanged()', () => {
    beforeEach(async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(writeFile).mockResolvedValue(undefined)
      await service.initialize()
      vi.clearAllMocks()
    })

    it('returns working unsubscribe function', async () => {
      vi.mocked(writeFile).mockResolvedValue(undefined)

      const listener = vi.fn()
      const unsubscribe = service.onSettingsChanged(listener)

      await service.setSetting('logging', { level: 'debug' })
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()

      await service.setSetting('logging', { level: 'warn' })
      expect(listener).toHaveBeenCalledTimes(1) // Not called again
    })

    it('notifies multiple listeners', async () => {
      vi.mocked(writeFile).mockResolvedValue(undefined)

      const listener1 = vi.fn()
      const listener2 = vi.fn()

      service.onSettingsChanged(listener1)
      service.onSettingsChanged(listener2)

      await service.setSetting('logging', { level: 'error' })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('catches and logs errors in listeners', async () => {
      vi.mocked(writeFile).mockResolvedValue(undefined)

      const throwingListener = vi.fn(() => {
        throw new Error('Listener error')
      })
      const normalListener = vi.fn()

      service.onSettingsChanged(throwingListener)
      service.onSettingsChanged(normalListener)

      await service.setSetting('logging', { level: 'debug' })

      expect(logger.error).toHaveBeenCalledWith(
        'Error in settings change listener',
        expect.any(Error)
      )
      expect(normalListener).toHaveBeenCalled() // Should still be called
    })
  })
})

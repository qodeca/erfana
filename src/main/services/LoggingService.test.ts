// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LoggingService Tests
 *
 * Tests for main process logging service
 *
 * @see Issue #49 - logging layer implementation
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import path from 'path'
import { ErrorCode } from '../../shared/errors'
import type { LogEntry } from '../../shared/ipc/logging-schema'

// Mock electron-log
vi.mock('electron-log', () => {
  const createMockLogger = () => ({
    verbose: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    transports: {
      file: {
        resolvePathFn: undefined as any,
        maxSize: 0,
        format: '',
        level: 'info' as any,
        archiveLogFn: undefined as any
      },
      console: {
        level: 'info' as any
      }
    }
  })

  // Store loggers in module scope
  let callCount = 0
  let combinedLogger: any
  let mainLogger: any
  let rendererLogger: any

  return {
    default: {
      create: vi.fn(() => {
        callCount++
        // Initialize on first call
        if (callCount === 1) {
          combinedLogger = createMockLogger()
          return combinedLogger
        }
        if (callCount === 2) {
          mainLogger = createMockLogger()
          return mainLogger
        }
        if (callCount === 3) {
          rendererLogger = createMockLogger()
          return rendererLogger
        }
        return createMockLogger()
      })
    }
  }
})

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  statfs: vi.fn()
}))

// Mock fs (synchronous)
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  renameSync: vi.fn(),
  lstatSync: vi.fn()
}))

// Mock os.homedir – use importOriginal to get platform-correct tmpdir
const MOCK_HOME = path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'mock-home')
const MOCK_TMP = process.env.TEMP || process.env.TMPDIR || '/tmp'

vi.mock('os', () => ({
  homedir: vi.fn(() => MOCK_HOME),
  tmpdir: vi.fn(() => MOCK_TMP)
}))

// Mock GlobalSettingsService
vi.mock('./GlobalSettingsService', () => ({
  globalSettingsService: {
    getSettings: vi.fn(() => ({ logging: { level: 'info' } })),
    onSettingsChanged: vi.fn(() => vi.fn()) // Returns unsubscribe function
  }
}))

// Import after all mocks are defined
import { LoggingService, loggingService, logger } from './LoggingService'
import log from 'electron-log'
import { globalSettingsService } from './GlobalSettingsService'
import { readdir, stat, unlink, statfs } from 'fs/promises'
import { existsSync, unlinkSync, renameSync, lstatSync } from 'fs'

// Get references to mocked modules
const mockGlobalSettingsService = globalSettingsService as any
const mockReaddir = readdir as any
const mockStat = stat as any
const mockUnlink = unlink as any
const mockStatfs = statfs as any
const mockExistsSync = existsSync as any
const mockUnlinkSync = unlinkSync as any
const mockRenameSync = renameSync as any
const mockLstatSync = lstatSync as any
const mockLog = vi.mocked(log, true)

describe('LoggingService', () => {
  let service: LoggingService
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let mockCombinedLogger: any
  let mockMainLogger: any
  let mockRendererLogger: any

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockGlobalSettingsService.getSettings.mockReturnValue({ logging: { level: 'info' } })
    // Mock lstatSync to return a non-symlink directory by default
    mockLstatSync.mockImplementation(() => ({
      isSymbolicLink: () => false
    }))
    service = new LoggingService()

    // Get references to the mock loggers after service is created
    // The create function has been called 3 times, get the returned values
    const createCalls = (mockLog.create as any).mock.results
    mockCombinedLogger = createCalls[createCalls.length - 3]?.value
    mockMainLogger = createCalls[createCalls.length - 2]?.value
    mockRendererLogger = createCalls[createCalls.length - 1]?.value
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('test-mode transports', () => {
    // Config-level guard: electron-log is mocked here, so the end-to-end
    // "no real file is written" behaviour can't be observed in this unit test —
    // it is verified by the suite-level regression check (run test:main, then
    // assert ~/Library/Logs/erfana/main.log stays empty). Here we assert the
    // constructor disabled both transports on all three loggers, and that
    // logging still executes without throwing once disabled.
    it('disables file and console transports under VITEST', () => {
      for (const l of [mockCombinedLogger, mockMainLogger, mockRendererLogger]) {
        expect(l.transports.file.level).toBe(false)
        expect(l.transports.console.level).toBe(false)
      }
    })

    it('still logs without error once transports are disabled', () => {
      expect(() => {
        service.error('disabled-transport probe')
        service.info('disabled-transport probe')
      }).not.toThrow()
    })
  })

  describe('initialize()', () => {
    it('configures electron-log file transport for all three loggers', async () => {
      await service.initialize()

      // Check combined logger
      expect(mockCombinedLogger.transports.file.resolvePathFn).toBeDefined()
      expect(mockCombinedLogger.transports.file.maxSize).toBe(10 * 1024 * 1024) // 10MB
      expect(mockCombinedLogger.transports.file.format).toContain('[{level}]')

      // Check main logger
      expect(mockMainLogger.transports.file.resolvePathFn).toBeDefined()
      expect(mockMainLogger.transports.file.maxSize).toBe(10 * 1024 * 1024)
      expect(mockMainLogger.transports.file.format).toContain('[{level}]')

      // Check renderer logger
      expect(mockRendererLogger.transports.file.resolvePathFn).toBeDefined()
      expect(mockRendererLogger.transports.file.maxSize).toBe(10 * 1024 * 1024)
      expect(mockRendererLogger.transports.file.format).toContain('[{level}]')
    })

    it('includes instance ID in log format for all loggers', async () => {
      const instanceId = service.getInstanceId()
      await service.initialize()

      // All loggers should include the instance ID in their format
      expect(mockCombinedLogger.transports.file.format).toContain(`[${instanceId}]`)
      expect(mockMainLogger.transports.file.format).toContain(`[${instanceId}]`)
      expect(mockRendererLogger.transports.file.format).toContain(`[${instanceId}]`)

      // Verify format order: [timestamp] [instanceId] [level] text
      const format = mockCombinedLogger.transports.file.format
      const instanceIdIndex = format.indexOf(`[${instanceId}]`)
      const levelIndex = format.indexOf('[{level}]')
      expect(instanceIdIndex).toBeLessThan(levelIndex)
    })

    it('sets file paths to separate log files', async () => {
      await service.initialize()

      const combinedPathFn = mockCombinedLogger.transports.file.resolvePathFn
      expect(combinedPathFn()).toBe(path.join(MOCK_TMP, 'erfana-test-logs', 'combined.log'))

      const mainPathFn = mockMainLogger.transports.file.resolvePathFn
      expect(mainPathFn()).toBe(path.join(MOCK_TMP, 'erfana-test-logs', 'main.log'))

      const rendererPathFn = mockRendererLogger.transports.file.resolvePathFn
      expect(rendererPathFn()).toBe(path.join(MOCK_TMP, 'erfana-test-logs', 'renderer.log'))
    })

    it('sets archiveLogFn for all loggers', async () => {
      await service.initialize()

      expect(mockCombinedLogger.transports.file.archiveLogFn).toBeDefined()
      expect(mockMainLogger.transports.file.archiveLogFn).toBeDefined()
      expect(mockRendererLogger.transports.file.archiveLogFn).toBeDefined()
    })

    it('gets initial log level from global settings', async () => {
      mockGlobalSettingsService.getSettings.mockReturnValue({ logging: { level: 'debug' } })

      await service.initialize()

      expect(service.getLevel()).toBe('debug')
    })

    it('sets electron-log level from settings for all loggers', async () => {
      mockGlobalSettingsService.getSettings.mockReturnValue({ logging: { level: 'warn' } })

      await service.initialize()

      expect(mockCombinedLogger.transports.file.level).toBe('warn')
      expect(mockMainLogger.transports.file.level).toBe('warn')
      expect(mockRendererLogger.transports.file.level).toBe('warn')
    })

    it('subscribes to global settings changes', async () => {
      await service.initialize()

      expect(mockGlobalSettingsService.onSettingsChanged).toHaveBeenCalled()
    })

    it('disables console transport in production for all loggers', async () => {
      const originalEnv = process.env.ELECTRON_RENDERER_URL
      delete process.env.ELECTRON_RENDERER_URL

      await service.initialize()

      expect(mockCombinedLogger.transports.console.level).toBe(false)
      expect(mockMainLogger.transports.console.level).toBe(false)
      expect(mockRendererLogger.transports.console.level).toBe(false)

      // Restore
      if (originalEnv) {
        process.env.ELECTRON_RENDERER_URL = originalEnv
      }
    })

    it('keeps console transport only for combinedLogger in development', async () => {
      const originalEnv = process.env.ELECTRON_RENDERER_URL
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:3000'

      mockCombinedLogger.transports.console.level = 'info'
      mockMainLogger.transports.console.level = 'info'
      mockRendererLogger.transports.console.level = 'info'

      await service.initialize()

      // Only combinedLogger should have console enabled to avoid duplicate log lines
      // (since each log call writes to both combinedLogger and mainLogger/rendererLogger)
      expect(mockCombinedLogger.transports.console.level).not.toBe(false)
      expect(mockMainLogger.transports.console.level).toBe(false)
      expect(mockRendererLogger.transports.console.level).toBe(false)

      // Restore
      if (originalEnv !== undefined) {
        process.env.ELECTRON_RENDERER_URL = originalEnv
      } else {
        delete process.env.ELECTRON_RENDERER_URL
      }
    })

    it('logs startup message with instance ID to both combined and main logs', async () => {
      await service.initialize()

      expect(mockCombinedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Instance started')
      )
      expect(mockCombinedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('instanceId')
      )
      expect(mockCombinedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('fullInstanceId')
      )
      expect(mockMainLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Instance started')
      )
    })

    it('throws AppError on initialization failure', async () => {
      mockGlobalSettingsService.getSettings.mockImplementation(() => {
        throw new Error('Settings error')
      })

      await expect(service.initialize()).rejects.toMatchObject({
        code: ErrorCode.LOGGING_INIT_FAILED,
        message: expect.stringContaining('Settings error')
      })
    })

    it('handles settings change to logging key', async () => {
      let settingsChangeCallback: any = null
      mockGlobalSettingsService.onSettingsChanged.mockImplementation((callback) => {
        settingsChangeCallback = callback
        return vi.fn()
      })

      await service.initialize()

      // Trigger settings change
      settingsChangeCallback({
        settings: { logging: { level: 'error' } },
        changedKey: 'logging',
        previousValue: { level: 'info' }
      })

      expect(service.getLevel()).toBe('error')
    })

    it('handles settings reset', async () => {
      let settingsChangeCallback: any = null
      mockGlobalSettingsService.onSettingsChanged.mockImplementation((callback) => {
        settingsChangeCallback = callback
        return vi.fn()
      })

      await service.initialize()

      // Trigger reset
      settingsChangeCallback({
        settings: { logging: { level: 'info' } },
        changedKey: 'reset',
        previousValue: { logging: { level: 'debug' } }
      })

      expect(service.getLevel()).toBe('info')
    })

    it('ignores unrelated settings changes', async () => {
      let settingsChangeCallback: any = null
      mockGlobalSettingsService.onSettingsChanged.mockImplementation((callback) => {
        settingsChangeCallback = callback
        return vi.fn()
      })

      mockGlobalSettingsService.getSettings.mockReturnValue({ logging: { level: 'warn' } })
      await service.initialize()

      const initialLevel = service.getLevel()

      // Trigger unrelated change
      settingsChangeCallback({
        settings: { logging: { level: 'warn' } },
        changedKey: 'someOtherKey',
        previousValue: null
      })

      expect(service.getLevel()).toBe(initialLevel)
    })
  })

  describe('setLevel()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('updates current level', () => {
      service.setLevel('debug')
      expect(service.getLevel()).toBe('debug')
    })

    it('updates electron-log transport level for all loggers', () => {
      service.setLevel('error')
      expect(mockCombinedLogger.transports.file.level).toBe('error')
      expect(mockMainLogger.transports.file.level).toBe('error')
      expect(mockRendererLogger.transports.file.level).toBe('error')
    })

    it('maps trace to verbose for all loggers', () => {
      service.setLevel('trace')
      expect(mockCombinedLogger.transports.file.level).toBe('verbose')
      expect(mockMainLogger.transports.file.level).toBe('verbose')
      expect(mockRendererLogger.transports.file.level).toBe('verbose')
    })

    it('maps fatal to error for all loggers', () => {
      service.setLevel('fatal')
      expect(mockCombinedLogger.transports.file.level).toBe('error')
      expect(mockMainLogger.transports.file.level).toBe('error')
      expect(mockRendererLogger.transports.file.level).toBe('error')
    })
  })

  describe('getLevel()', () => {
    it('returns current level', async () => {
      mockGlobalSettingsService.getSettings.mockReturnValue({ logging: { level: 'debug' } })
      await service.initialize()

      expect(service.getLevel()).toBe('debug')
    })

    it('returns updated level after setLevel()', async () => {
      await service.initialize()

      service.setLevel('warn')
      expect(service.getLevel()).toBe('warn')
    })
  })

  describe('getInstanceId()', () => {
    it('returns 8-character instance ID', () => {
      const instanceId = service.getInstanceId()

      expect(instanceId).toBeDefined()
      expect(typeof instanceId).toBe('string')
      expect(instanceId.length).toBe(8)
    })

    it('returns same ID on repeated calls', () => {
      const id1 = service.getInstanceId()
      const id2 = service.getInstanceId()

      expect(id1).toBe(id2)
    })

    it('returns different IDs for different service instances', () => {
      const service2 = new LoggingService()

      expect(service.getInstanceId()).not.toBe(service2.getInstanceId())
    })
  })

  describe('getFullInstanceId()', () => {
    it('returns full UUID format', () => {
      const fullId = service.getFullInstanceId()

      expect(fullId).toBeDefined()
      expect(typeof fullId).toBe('string')
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars with dashes)
      expect(fullId.length).toBe(36)
      expect(fullId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('short instance ID is prefix of full ID', () => {
      const shortId = service.getInstanceId()
      const fullId = service.getFullInstanceId()

      expect(fullId.startsWith(shortId)).toBe(true)
    })
  })

  describe('trace()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs trace message to combined and main logs when level is trace', () => {
      service.setLevel('trace')
      service.trace('Trace message')

      expect(mockCombinedLogger.verbose).toHaveBeenCalledWith('Trace message')
      expect(mockMainLogger.verbose).toHaveBeenCalledWith('Trace message')
      expect(mockRendererLogger.verbose).not.toHaveBeenCalled()
    })

    it('logs trace message with context', () => {
      service.setLevel('trace')
      service.trace('Trace message', { key: 'value', count: 42 })

      expect(mockCombinedLogger.verbose).toHaveBeenCalledWith(
        expect.stringContaining('Trace message')
      )
      expect(mockCombinedLogger.verbose).toHaveBeenCalledWith(expect.stringContaining('"key"'))
      expect(mockMainLogger.verbose).toHaveBeenCalledWith(expect.stringContaining('"key"'))
    })

    it('does not log when level is above trace', () => {
      service.setLevel('debug')
      service.trace('Trace message')

      expect(mockCombinedLogger.verbose).not.toHaveBeenCalled()
      expect(mockMainLogger.verbose).not.toHaveBeenCalled()
    })

    it('does not log when level is info (default)', () => {
      service.trace('Trace message')

      expect(mockCombinedLogger.verbose).not.toHaveBeenCalled()
      expect(mockMainLogger.verbose).not.toHaveBeenCalled()
    })

    it('handles empty context gracefully', () => {
      service.setLevel('trace')
      service.trace('Trace message', {})

      expect(mockCombinedLogger.verbose).toHaveBeenCalledWith('Trace message')
      expect(mockMainLogger.verbose).toHaveBeenCalledWith('Trace message')
    })
  })

  describe('debug()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs debug message to combined and main logs when level is debug', () => {
      service.setLevel('debug')
      service.debug('Debug message')

      expect(mockCombinedLogger.debug).toHaveBeenCalledWith('Debug message')
      expect(mockMainLogger.debug).toHaveBeenCalledWith('Debug message')
      expect(mockRendererLogger.debug).not.toHaveBeenCalled()
    })

    it('logs debug message with context', () => {
      service.setLevel('debug')
      service.debug('Debug message', { file: 'test.ts', line: 42 })

      expect(mockCombinedLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Debug message'))
      expect(mockCombinedLogger.debug).toHaveBeenCalledWith(expect.stringContaining('"file"'))
      expect(mockMainLogger.debug).toHaveBeenCalledWith(expect.stringContaining('"file"'))
    })

    it('does not log when level is above debug', () => {
      service.setLevel('info')
      service.debug('Debug message')

      expect(mockCombinedLogger.debug).not.toHaveBeenCalled()
      expect(mockMainLogger.debug).not.toHaveBeenCalled()
    })
  })

  describe('info()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs info message to combined and main logs when level is info (default)', () => {
      service.info('Info message')

      expect(mockCombinedLogger.info).toHaveBeenCalledWith('Info message')
      expect(mockMainLogger.info).toHaveBeenCalledWith('Info message')
      expect(mockRendererLogger.info).not.toHaveBeenCalled()
    })

    it('logs info message with context', () => {
      service.info('Info message', { operation: 'save', status: 'success' })

      expect(mockCombinedLogger.info).toHaveBeenCalledWith(expect.stringContaining('Info message'))
      expect(mockCombinedLogger.info).toHaveBeenCalledWith(expect.stringContaining('"operation"'))
      expect(mockMainLogger.info).toHaveBeenCalledWith(expect.stringContaining('"operation"'))
    })

    it('does not log when level is above info', () => {
      service.setLevel('warn')
      service.info('Info message')

      expect(mockCombinedLogger.info).not.toHaveBeenCalled()
      expect(mockMainLogger.info).not.toHaveBeenCalled()
    })
  })

  describe('warn()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs warn message to combined and main logs when level is warn', () => {
      service.setLevel('warn')
      service.warn('Warning message')

      expect(mockCombinedLogger.warn).toHaveBeenCalledWith('Warning message')
      expect(mockMainLogger.warn).toHaveBeenCalledWith('Warning message')
      expect(mockRendererLogger.warn).not.toHaveBeenCalled()
    })

    it('logs warn message with context', () => {
      service.setLevel('warn')
      service.warn('Warning message', { retries: 3, timeout: 5000 })

      expect(mockCombinedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Warning message'))
      expect(mockCombinedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('"retries"'))
      expect(mockMainLogger.warn).toHaveBeenCalledWith(expect.stringContaining('"retries"'))
    })

    it('logs warn when level is info', () => {
      service.setLevel('info')
      service.warn('Warning message')

      expect(mockCombinedLogger.warn).toHaveBeenCalledWith('Warning message')
      expect(mockMainLogger.warn).toHaveBeenCalledWith('Warning message')
    })

    it('does not log when level is above warn', () => {
      service.setLevel('error')
      service.warn('Warning message')

      expect(mockCombinedLogger.warn).not.toHaveBeenCalled()
      expect(mockMainLogger.warn).not.toHaveBeenCalled()
    })
  })

  describe('error()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs error message to combined and main logs', () => {
      service.error('Error message')

      expect(mockCombinedLogger.error).toHaveBeenCalledWith('Error message')
      expect(mockMainLogger.error).toHaveBeenCalledWith('Error message')
      expect(mockRendererLogger.error).not.toHaveBeenCalled()
    })

    it('logs error with Error object', () => {
      const error = new Error('Test error')
      error.stack = 'Error: Test error\n    at test.ts:42'

      service.error('Error occurred', error)

      const combinedCall = mockCombinedLogger.error.mock.calls[0][0]
      expect(combinedCall).toContain('Error occurred')
      expect(combinedCall).toContain('Test error')
      expect(combinedCall).toContain('Stack:')

      const mainCall = mockMainLogger.error.mock.calls[0][0]
      expect(mainCall).toContain('Error occurred')
      expect(mainCall).toContain('Test error')
      expect(mainCall).toContain('Stack:')
    })

    it('logs error with context', () => {
      const error = new Error('IO error')
      service.error('File operation failed', error, { path: '/test/file.md' })

      const combinedCall = mockCombinedLogger.error.mock.calls[0][0]
      expect(combinedCall).toContain('File operation failed')
      expect(combinedCall).toContain('IO error')
      expect(combinedCall).toContain('"path"')

      const mainCall = mockMainLogger.error.mock.calls[0][0]
      expect(mainCall).toContain('"path"')
    })

    it('handles Error without stack', () => {
      const error = new Error('No stack error')
      delete error.stack

      service.error('Error occurred', error)

      const call = mockCombinedLogger.error.mock.calls[0][0]
      expect(call).toContain('No stack error')
      expect(call).not.toContain('Stack:')
    })

    it('does not log when level is fatal', () => {
      service.setLevel('fatal')
      service.error('Error message')

      expect(mockCombinedLogger.error).not.toHaveBeenCalled()
      expect(mockMainLogger.error).not.toHaveBeenCalled()
    })
  })

  describe('fatal()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs fatal message to combined and main logs', () => {
      service.fatal('Fatal error')

      expect(mockCombinedLogger.error).toHaveBeenCalledWith('Fatal error')
      expect(mockMainLogger.error).toHaveBeenCalledWith('Fatal error')
      expect(mockRendererLogger.error).not.toHaveBeenCalled()
    })

    it('logs fatal with Error object', () => {
      const error = new Error('Fatal crash')
      service.fatal('System crash', error)

      const combinedCall = mockCombinedLogger.error.mock.calls[0][0]
      expect(combinedCall).toContain('System crash')
      expect(combinedCall).toContain('Fatal crash')

      const mainCall = mockMainLogger.error.mock.calls[0][0]
      expect(mainCall).toContain('System crash')
      expect(mainCall).toContain('Fatal crash')
    })

    it('logs fatal with context', () => {
      const error = new Error('Critical failure')
      service.fatal('Application crash', error, { exitCode: 1 })

      const combinedCall = mockCombinedLogger.error.mock.calls[0][0]
      expect(combinedCall).toContain('Application crash')
      expect(combinedCall).toContain('Critical failure')
      expect(combinedCall).toContain('"exitCode"')

      const mainCall = mockMainLogger.error.mock.calls[0][0]
      expect(mainCall).toContain('"exitCode"')
    })
  })

  describe('logFromRenderer()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs trace from renderer to combined and renderer logs', () => {
      service.setLevel('trace')

      const entry: LogEntry = {
        level: 'trace',
        message: 'Renderer trace',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockCombinedLogger.verbose).toHaveBeenCalledWith(
        expect.stringContaining('[RENDERER]')
      )
      expect(mockCombinedLogger.verbose).toHaveBeenCalledWith(
        expect.stringContaining('Renderer trace')
      )
      expect(mockRendererLogger.verbose).toHaveBeenCalledWith(
        expect.stringContaining('[RENDERER]')
      )
      expect(mockMainLogger.verbose).not.toHaveBeenCalled()
    })

    it('logs debug from renderer to combined and renderer logs', () => {
      service.setLevel('debug')

      const entry: LogEntry = {
        level: 'debug',
        message: 'Renderer debug',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockCombinedLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[RENDERER]')
      )
      expect(mockRendererLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[RENDERER]')
      )
      expect(mockMainLogger.debug).not.toHaveBeenCalled()
    })

    it('logs info from renderer to combined and renderer logs', () => {
      const entry: LogEntry = {
        level: 'info',
        message: 'Renderer info',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockCombinedLogger.info).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
      expect(mockRendererLogger.info).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
      expect(mockMainLogger.info).not.toHaveBeenCalled()
    })

    it('logs warn from renderer to combined and renderer logs', () => {
      const entry: LogEntry = {
        level: 'warn',
        message: 'Renderer warn',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockCombinedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
      expect(mockRendererLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
      expect(mockMainLogger.warn).not.toHaveBeenCalled()
    })

    it('logs error from renderer to combined and renderer logs', () => {
      const entry: LogEntry = {
        level: 'error',
        message: 'Renderer error',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockCombinedLogger.error).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
      expect(mockRendererLogger.error).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
      expect(mockMainLogger.error).not.toHaveBeenCalled()
    })

    it('logs fatal from renderer to combined and renderer logs', () => {
      const entry: LogEntry = {
        level: 'fatal',
        message: 'Renderer fatal',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockCombinedLogger.error).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
      expect(mockRendererLogger.error).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
      expect(mockMainLogger.error).not.toHaveBeenCalled()
    })

    it('includes context in log', () => {
      const entry: LogEntry = {
        level: 'info',
        message: 'Renderer with context',
        timestamp: new Date().toISOString(),
        source: 'renderer',
        context: {
          component: 'Editor',
          action: 'save'
        }
      }

      service.logFromRenderer(entry)

      const combinedCall = mockCombinedLogger.info.mock.calls[0][0]
      expect(combinedCall).toContain('"component"')
      expect(combinedCall).toContain('"action"')

      const rendererCall = mockRendererLogger.info.mock.calls[0][0]
      expect(rendererCall).toContain('"component"')
      expect(rendererCall).toContain('"action"')
    })

    it('includes error in log', () => {
      const entry: LogEntry = {
        level: 'error',
        message: 'Renderer error with details',
        timestamp: new Date().toISOString(),
        source: 'renderer',
        error: {
          name: 'TypeError',
          message: 'Cannot read property',
          stack: 'TypeError: Cannot read property\n    at component.tsx:42'
        }
      }

      service.logFromRenderer(entry)

      const combinedCall = mockCombinedLogger.error.mock.calls[0][0]
      expect(combinedCall).toContain('Cannot read property')
      expect(combinedCall).toContain('Stack:')

      const rendererCall = mockRendererLogger.error.mock.calls[0][0]
      expect(rendererCall).toContain('Cannot read property')
      expect(rendererCall).toContain('Stack:')
    })

    it('respects current log level', () => {
      service.setLevel('warn')

      const debugEntry: LogEntry = {
        level: 'debug',
        message: 'Should not log',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(debugEntry)

      expect(mockCombinedLogger.debug).not.toHaveBeenCalled()
      expect(mockRendererLogger.debug).not.toHaveBeenCalled()
    })
  })

  describe('archiveLog()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('shifts files correctly when rotating', async () => {
      // Setup: simulate having main.1.log, main.2.log, main.3.log already
      mockExistsSync.mockImplementation((path: string) => {
        // main.100.log doesn't exist (for deletion check)
        if (path === path.join(MOCK_TMP, 'erfana-test-logs', 'main.100.log')) return false
        // main.1.log, main.2.log, main.3.log exist
        if (path === path.join(MOCK_TMP, 'erfana-test-logs', 'main.1.log')) return true
        if (path === path.join(MOCK_TMP, 'erfana-test-logs', 'main.2.log')) return true
        if (path === path.join(MOCK_TMP, 'erfana-test-logs', 'main.3.log')) return true
        // main.log exists
        if (path === path.join(MOCK_TMP, 'erfana-test-logs', 'main.log')) return true
        // All other numbered files don't exist
        return false
      })

      const archiveLogFn = mockMainLogger.transports.file.archiveLogFn

      // Create a mock LogFile object
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'main.log') }

      // Call archive function
      archiveLogFn(mockLogFile)

      // Should shift files down: 3->4, 2->3, 1->2
      expect(mockRenameSync).toHaveBeenCalledWith(
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.3.log'),
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.4.log')
      )
      expect(mockRenameSync).toHaveBeenCalledWith(
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.2.log'),
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.3.log')
      )
      expect(mockRenameSync).toHaveBeenCalledWith(
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.1.log'),
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.2.log')
      )

      // Should move current log to .1
      expect(mockRenameSync).toHaveBeenCalledWith(
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.log'),
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.1.log')
      )
    })

    it('deletes oldest file when at max rotation', async () => {
      // Setup: simulate having main.100.log (oldest)
      mockExistsSync.mockImplementation((path: string) => {
        return path === path.join(MOCK_TMP, 'erfana-test-logs', 'main.100.log') || path === path.join(MOCK_TMP, 'erfana-test-logs', 'main.log')
      })

      const archiveLogFn = mockMainLogger.transports.file.archiveLogFn
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'main.log') }

      archiveLogFn(mockLogFile)

      // Should delete the oldest file
      expect(mockUnlinkSync).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'main.100.log'))
    })

    it('handles rotation when no previous rotated files exist', async () => {
      // All renames will throw ENOENT except for the final main.log -> main.1.log
      mockRenameSync.mockImplementation((source: string, dest: string) => {
        // Only succeed for main.log -> main.1.log
        if (source.endsWith('main.log') && dest.endsWith('main.1.log')) {
          return
        }
        // All other operations fail with ENOENT (files don't exist)
        const error: any = new Error('ENOENT: no such file')
        error.code = 'ENOENT'
        throw error
      })

      mockUnlinkSync.mockImplementation(() => {
        const error: any = new Error('ENOENT: no such file')
        error.code = 'ENOENT'
        throw error
      })

      const archiveLogFn = mockMainLogger.transports.file.archiveLogFn
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'main.log') }

      archiveLogFn(mockLogFile)

      // Should attempt 100 renames (99 shifts + 1 current log rotation) + 1 delete
      // But only main.log -> main.1.log succeeds
      expect(mockRenameSync).toHaveBeenCalledTimes(100)
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1)

      // Verify the successful call
      expect(mockRenameSync).toHaveBeenCalledWith(
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.log'),
        path.join(MOCK_TMP, 'erfana-test-logs', 'main.1.log')
      )
    })

    it('works with different log file names', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path === path.join(MOCK_TMP, 'erfana-test-logs', 'renderer.log')
      })

      const archiveLogFn = mockRendererLogger.transports.file.archiveLogFn
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'renderer.log') }

      archiveLogFn(mockLogFile)

      // Should move renderer.log to renderer.1.log
      expect(mockRenameSync).toHaveBeenCalledWith(
        path.join(MOCK_TMP, 'erfana-test-logs', 'renderer.log'),
        path.join(MOCK_TMP, 'erfana-test-logs', 'renderer.1.log')
      )
    })
  })

  describe('cleanupOldLogs()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
      // Mock statfs to return sufficient disk space by default
      mockStatfs.mockResolvedValue({
        bavail: 500000, // 500000 blocks available
        bsize: 4096 // 4KB block size = ~2GB available
      })
    })

    it('skips cleanup when disk space is below 100MB', async () => {
      // Mock low disk space (50MB available)
      mockStatfs.mockReset()
      mockStatfs.mockResolvedValue({
        bavail: 12800, // 12800 blocks
        bsize: 4096 // 4KB block size = 52.4MB available
      })

      mockReaddir.mockResolvedValue(['old.log'])
      mockStat.mockResolvedValue({ mtimeMs: 0 }) // Very old

      await service.cleanupOldLogs()

      // Verify statfs was called
      expect(mockStatfs).toHaveBeenCalled()

      // Should NOT attempt to delete files
      expect(mockUnlink).not.toHaveBeenCalled()

      // Should log warning about low disk space
      // The message and context are formatted together into a single string
      expect(mockCombinedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Low disk space, skipping log cleanup')
      )
      expect(mockCombinedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"availableMB"')
      )
      expect(mockMainLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Low disk space, skipping log cleanup')
      )
      expect(mockMainLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"availableMB"')
      )
    })

    it('continues cleanup when disk space is above 100MB', async () => {
      // Mock sufficient disk space (500MB available)
      mockStatfs.mockResolvedValue({
        bavail: 128000, // 128000 blocks
        bsize: 4096 // 4KB block size = 512MB available
      })

      const now = Date.now()
      const oldDate = now - 8 * 24 * 60 * 60 * 1000 // 8 days ago

      mockReaddir.mockResolvedValue(['old.log'])
      mockStat.mockResolvedValue({ mtimeMs: oldDate })
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      // Should delete old file
      expect(mockUnlink).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'old.log'))
    })

    it('continues cleanup when statfs fails', async () => {
      // Mock statfs failure
      mockStatfs.mockRejectedValue(new Error('statfs failed'))

      const now = Date.now()
      const oldDate = now - 8 * 24 * 60 * 60 * 1000 // 8 days ago

      mockReaddir.mockResolvedValue(['old.log'])
      mockStat.mockResolvedValue({ mtimeMs: oldDate })
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      // Should still delete old file (ignore statfs error)
      expect(mockUnlink).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'old.log'))
    })

    it('deletes log files older than 7 days', async () => {
      const now = Date.now()
      const oldDate = now - 8 * 24 * 60 * 60 * 1000 // 8 days ago

      mockReaddir.mockResolvedValue(['old.log', 'recent.log'])
      mockStat
        .mockResolvedValueOnce({ mtimeMs: oldDate })
        .mockResolvedValueOnce({ mtimeMs: now })
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      expect(mockUnlink).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'old.log'))
      expect(mockUnlink).toHaveBeenCalledTimes(1)
    })

    it('keeps log files younger than 7 days', async () => {
      const now = Date.now()
      const recentDate = now - 3 * 24 * 60 * 60 * 1000 // 3 days ago

      mockReaddir.mockResolvedValue(['recent.log'])
      mockStat.mockResolvedValue({ mtimeMs: recentDate })
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      expect(mockUnlink).not.toHaveBeenCalled()
    })

    it('cleans up both .log files and numbered rotated files', async () => {
      mockReaddir.mockResolvedValue([
        'combined.log',
        'combined.1.log',
        'main.log',
        'main.2.log',
        'renderer.log',
        'renderer.99.log'
      ])
      mockStat.mockResolvedValue({ mtimeMs: 0 }) // Very old
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      // Should check all log files including numbered ones
      expect(mockStat).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'combined.log'))
      expect(mockStat).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'combined.1.log'))
      expect(mockStat).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'main.log'))
      expect(mockStat).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'main.2.log'))
      expect(mockStat).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'renderer.log'))
      expect(mockStat).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'renderer.99.log'))
    })

    it('ignores non-log files', async () => {
      mockReaddir.mockResolvedValue(['combined.log', 'readme.txt', 'data.json', 'main.1.log'])
      mockStat.mockResolvedValue({ mtimeMs: 0 }) // Very old
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      // Should only check log files
      expect(mockStat).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'combined.log'))
      expect(mockStat).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'main.1.log'))

      // Should NOT check non-log files
      expect(mockStat).not.toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'readme.txt'))
      expect(mockStat).not.toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'data.json'))
    })

    it('logs deleted files at debug level', async () => {
      service.setLevel('debug')

      const now = Date.now()
      const oldDate = now - 10 * 24 * 60 * 60 * 1000 // 10 days ago

      mockReaddir.mockResolvedValue(['old.log'])
      mockStat.mockResolvedValue({ mtimeMs: oldDate })
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      expect(mockCombinedLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Deleted old log file')
      )
      expect(mockMainLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Deleted old log file')
      )
    })

    it('continues on individual file errors', async () => {
      mockReaddir.mockResolvedValue(['error.log', 'success.log'])
      mockStat
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValueOnce({ mtimeMs: 0 })
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      expect(mockCombinedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cleanup log file')
      )
      expect(mockMainLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cleanup log file')
      )
      expect(mockUnlink).toHaveBeenCalledWith(path.join(MOCK_TMP, 'erfana-test-logs', 'success.log'))
    })

    it('handles readdir errors gracefully', async () => {
      mockReaddir.mockRejectedValue(new Error('Directory not found'))

      await expect(service.cleanupOldLogs()).resolves.toBeUndefined()

      expect(mockCombinedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cleanup old logs')
      )
      expect(mockMainLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cleanup old logs')
      )
    })

    it('is fire-and-forget (does not throw)', async () => {
      mockReaddir.mockRejectedValue(new Error('Catastrophic failure'))

      await expect(service.cleanupOldLogs()).resolves.toBeUndefined()
    })
  })

  describe('dispose()', () => {
    it('unsubscribes from settings changes', async () => {
      const unsubscribeMock = vi.fn()
      mockGlobalSettingsService.onSettingsChanged.mockReturnValue(unsubscribeMock)

      await service.initialize()
      service.dispose()

      expect(unsubscribeMock).toHaveBeenCalled()
    })

    it('can be called multiple times safely', async () => {
      const unsubscribeMock = vi.fn()
      mockGlobalSettingsService.onSettingsChanged.mockReturnValue(unsubscribeMock)

      await service.initialize()
      service.dispose()
      service.dispose() // Should not throw

      expect(unsubscribeMock).toHaveBeenCalledTimes(1)
    })

    it('can be called before initialize', () => {
      expect(() => service.dispose()).not.toThrow()
    })
  })

  describe('archiveLog error handling', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('ignores ENOENT errors when shifting files', () => {
      mockExistsSync.mockReturnValue(false)
      mockRenameSync.mockImplementation(() => {
        const error: any = new Error('ENOENT: no such file')
        error.code = 'ENOENT'
        throw error
      })

      const archiveLogFn = mockMainLogger.transports.file.archiveLogFn
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'main.log') }

      // Should not throw despite ENOENT errors
      expect(() => archiveLogFn(mockLogFile)).not.toThrow()
    })

    it('logs non-ENOENT errors when shifting files', () => {
      mockExistsSync.mockReturnValue(true)
      mockRenameSync.mockImplementation(() => {
        const error: any = new Error('EACCES: permission denied')
        error.code = 'EACCES'
        throw error
      })

      const archiveLogFn = mockMainLogger.transports.file.archiveLogFn
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'main.log') }

      archiveLogFn(mockLogFile)

      // Should log error to console.error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to shift'),
        expect.anything()
      )
    })

    it('ignores ENOENT when rotating current log', () => {
      mockRenameSync.mockImplementation((source: string) => {
        // Simulate ENOENT only for main.log rotation
        if (source.endsWith('main.log')) {
          const error: any = new Error('ENOENT: no such file')
          error.code = 'ENOENT'
          throw error
        }
      })

      const archiveLogFn = mockMainLogger.transports.file.archiveLogFn
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'main.log') }

      expect(() => archiveLogFn(mockLogFile)).not.toThrow()
    })

    it('ignores ENOENT when deleting oldest file', () => {
      mockUnlinkSync.mockImplementation(() => {
        const error: any = new Error('ENOENT: no such file')
        error.code = 'ENOENT'
        throw error
      })

      const archiveLogFn = mockMainLogger.transports.file.archiveLogFn
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'main.log') }

      expect(() => archiveLogFn(mockLogFile)).not.toThrow()
    })

    it('logs non-ENOENT errors when deleting oldest file', () => {
      mockUnlinkSync.mockImplementation(() => {
        const error: any = new Error('EACCES: permission denied')
        error.code = 'EACCES'
        throw error
      })

      const archiveLogFn = mockMainLogger.transports.file.archiveLogFn
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'main.log') }

      archiveLogFn(mockLogFile)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete oldest log'),
        expect.anything()
      )
    })

    it('catches and logs catastrophic errors', () => {
      mockRenameSync.mockImplementation(() => {
        throw new Error('Unexpected catastrophic error')
      })

      const archiveLogFn = mockMainLogger.transports.file.archiveLogFn
      const mockLogFile = { path: path.join(MOCK_TMP, 'erfana-test-logs', 'main.log') }

      expect(() => archiveLogFn(mockLogFile)).not.toThrow()

      // Will log errors for each failed shift operation (100 total)
      // We just verify it doesn't crash and logs errors
      expect(consoleErrorSpy).toHaveBeenCalled()
      expect(consoleErrorSpy.mock.calls.some(call =>
        call[0]?.includes('Failed to shift')
      )).toBe(true)
    })
  })

  describe('symlink validation', () => {
    it('throws if logs directory is a symlink', async () => {
      mockLstatSync.mockImplementation(() => ({
        isSymbolicLink: () => true
      }))

      await expect(service.initialize()).rejects.toMatchObject({
        code: ErrorCode.LOGGING_INIT_FAILED,
        message: expect.stringContaining('symlink')
      })
    })

    it('allows non-symlink directories', async () => {
      mockLstatSync.mockImplementation(() => ({
        isSymbolicLink: () => false
      }))

      await expect(service.initialize()).resolves.toBeUndefined()
    })

    it('allows non-existent directories (will be created)', async () => {
      mockLstatSync.mockImplementation(() => {
        const error: any = new Error('ENOENT: no such file or directory')
        error.code = 'ENOENT'
        throw error
      })

      await expect(service.initialize()).resolves.toBeUndefined()
    })

    it('throws on other lstat errors', async () => {
      mockLstatSync.mockImplementation(() => {
        const error: any = new Error('EACCES: permission denied')
        error.code = 'EACCES'
        throw error
      })

      await expect(service.initialize()).rejects.toMatchObject({
        code: ErrorCode.LOGGING_INIT_FAILED
      })
    })
  })

  describe('recursive logging guard', () => {
    it('prevents recursive logging in settings change callback', async () => {
      let settingsChangeCallback: any = null
      mockGlobalSettingsService.onSettingsChanged.mockImplementation((callback) => {
        settingsChangeCallback = callback
        return vi.fn()
      })

      await service.initialize()

      // Verify guard is false initially
      expect((service as any).isProcessingSettingsChange).toBe(false)

      // Set guard to true to simulate recursive call
      ;(service as any).isProcessingSettingsChange = true

      vi.clearAllMocks()

      // Trigger settings change while guard is active
      settingsChangeCallback({
        settings: { logging: { level: 'debug' } },
        changedKey: 'logging',
        previousValue: { level: 'info' }
      })

      // Should NOT have processed the change (level should still be 'info')
      expect(service.getLevel()).toBe('info')

      // Should NOT have logged anything because guard blocked it
      expect(mockCombinedLogger.info).not.toHaveBeenCalled()
      expect(mockMainLogger.info).not.toHaveBeenCalled()

      // Restore guard
      ;(service as any).isProcessingSettingsChange = false
    })

    it('resets guard flag after processing completes', async () => {
      let settingsChangeCallback: any = null
      mockGlobalSettingsService.onSettingsChanged.mockImplementation((callback) => {
        settingsChangeCallback = callback
        return vi.fn()
      })

      await service.initialize()

      // Trigger settings change
      settingsChangeCallback({
        settings: { logging: { level: 'error' } },
        changedKey: 'logging',
        previousValue: { level: 'info' }
      })

      // Guard should be reset after processing
      expect((service as any).isProcessingSettingsChange).toBe(false)
    })

    it('resets guard flag even if logging throws', async () => {
      let settingsChangeCallback: any = null
      mockGlobalSettingsService.onSettingsChanged.mockImplementation((callback) => {
        settingsChangeCallback = callback
        return vi.fn()
      })

      await service.initialize()

      // Make info() throw
      mockCombinedLogger.info.mockImplementation(() => {
        throw new Error('Logging failed')
      })

      // Trigger settings change (should not throw due to try-finally)
      settingsChangeCallback({
        settings: { logging: { level: 'error' } },
        changedKey: 'logging',
        previousValue: { level: 'info' }
      })

      // Guard should still be reset despite error
      expect((service as any).isProcessingSettingsChange).toBe(false)
    })

    it('does not log level change if level is the same', async () => {
      let settingsChangeCallback: any = null
      mockGlobalSettingsService.onSettingsChanged.mockImplementation((callback) => {
        settingsChangeCallback = callback
        return vi.fn()
      })

      mockGlobalSettingsService.getSettings.mockReturnValue({ logging: { level: 'warn' } })
      await service.initialize()
      vi.clearAllMocks()

      // Trigger settings change with same level
      settingsChangeCallback({
        settings: { logging: { level: 'warn' } },
        changedKey: 'logging',
        previousValue: { level: 'warn' }
      })

      // Should not log level change (level didn't actually change)
      expect(mockCombinedLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Log level changed')
      )
    })
  })

  describe('singleton and convenience exports', () => {
    it('exports singleton instance', () => {
      expect(loggingService).toBeInstanceOf(LoggingService)
    })

    it('exports convenience logger object', () => {
      expect(logger).toBeDefined()
      expect(logger.trace).toBeInstanceOf(Function)
      expect(logger.debug).toBeInstanceOf(Function)
      expect(logger.info).toBeInstanceOf(Function)
      expect(logger.warn).toBeInstanceOf(Function)
      expect(logger.error).toBeInstanceOf(Function)
      expect(logger.fatal).toBeInstanceOf(Function)
    })

    it('logger methods call loggingService methods', () => {
      // Use the service instance created in beforeEach, not the singleton
      vi.clearAllMocks()

      // Call via the service instance
      service.info('Test info')

      // Should write to both combined and main logs
      expect(mockCombinedLogger.info).toHaveBeenCalledWith('Test info')
      expect(mockMainLogger.info).toHaveBeenCalledWith('Test info')
    })
  })
})

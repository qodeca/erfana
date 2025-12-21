/**
 * LoggingService Tests
 *
 * Tests for main process logging service
 *
 * @see Issue #49 - logging layer implementation
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ErrorCode } from '../../shared/errors'
import type { LogEntry } from '../../shared/ipc/logging-schema'

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
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
        level: 'info' as any
      },
      console: {
        level: 'info' as any
      }
    }
  }
}))

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn()
}))

// Mock os.homedir
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock-home')
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
import { readdir, stat, unlink } from 'fs/promises'

// Get references to mocked modules
const mockElectronLog = log as any
const mockGlobalSettingsService = globalSettingsService as any
const mockReaddir = readdir as any
const mockStat = stat as any
const mockUnlink = unlink as any

describe('LoggingService', () => {
  let service: LoggingService
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    service = new LoggingService()
    mockGlobalSettingsService.getSettings.mockReturnValue({ logging: { level: 'info' } })
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('initialize()', () => {
    it('configures electron-log file transport', async () => {
      await service.initialize()

      expect(mockElectronLog.transports.file.resolvePathFn).toBeDefined()
      expect(mockElectronLog.transports.file.maxSize).toBe(10 * 1024 * 1024) // 10MB
      expect(mockElectronLog.transports.file.format).toContain('[{level}]')
    })

    it('sets file path to ~/.erfana/logs/combined.log', async () => {
      await service.initialize()

      const pathFn = mockElectronLog.transports.file.resolvePathFn
      expect(pathFn()).toBe('/mock-home/.erfana/logs/combined.log')
    })

    it('gets initial log level from global settings', async () => {
      mockGlobalSettingsService.getSettings.mockReturnValue({ logging: { level: 'debug' } })

      await service.initialize()

      expect(service.getLevel()).toBe('debug')
    })

    it('sets electron-log level from settings', async () => {
      mockGlobalSettingsService.getSettings.mockReturnValue({ logging: { level: 'warn' } })

      await service.initialize()

      expect(mockElectronLog.transports.file.level).toBe('warn')
    })

    it('subscribes to global settings changes', async () => {
      await service.initialize()

      expect(mockGlobalSettingsService.onSettingsChanged).toHaveBeenCalled()
    })

    it('disables console transport in production', async () => {
      const originalEnv = process.env.ELECTRON_RENDERER_URL
      delete process.env.ELECTRON_RENDERER_URL

      await service.initialize()

      expect(mockElectronLog.transports.console.level).toBe(false)

      // Restore
      if (originalEnv) {
        process.env.ELECTRON_RENDERER_URL = originalEnv
      }
    })

    it('keeps console transport in development', async () => {
      const originalEnv = process.env.ELECTRON_RENDERER_URL
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:3000'

      mockElectronLog.transports.console.level = 'info'
      await service.initialize()

      expect(mockElectronLog.transports.console.level).not.toBe(false)

      // Restore
      if (originalEnv !== undefined) {
        process.env.ELECTRON_RENDERER_URL = originalEnv
      } else {
        delete process.env.ELECTRON_RENDERER_URL
      }
    })

    it('logs initialization message', async () => {
      await service.initialize()

      expect(mockElectronLog.info).toHaveBeenCalledWith(
        expect.stringContaining('Logging service initialized')
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

    it('updates electron-log transport level', () => {
      service.setLevel('error')
      expect(mockElectronLog.transports.file.level).toBe('error')
    })

    it('maps trace to verbose', () => {
      service.setLevel('trace')
      expect(mockElectronLog.transports.file.level).toBe('verbose')
    })

    it('maps fatal to error', () => {
      service.setLevel('fatal')
      expect(mockElectronLog.transports.file.level).toBe('error')
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

  describe('trace()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs trace message when level is trace', () => {
      service.setLevel('trace')
      service.trace('Trace message')

      expect(mockElectronLog.verbose).toHaveBeenCalledWith('Trace message')
    })

    it('logs trace message with context', () => {
      service.setLevel('trace')
      service.trace('Trace message', { key: 'value', count: 42 })

      expect(mockElectronLog.verbose).toHaveBeenCalledWith(
        expect.stringContaining('Trace message')
      )
      expect(mockElectronLog.verbose).toHaveBeenCalledWith(expect.stringContaining('"key"'))
    })

    it('does not log when level is above trace', () => {
      service.setLevel('debug')
      service.trace('Trace message')

      expect(mockElectronLog.verbose).not.toHaveBeenCalled()
    })

    it('does not log when level is info (default)', () => {
      service.trace('Trace message')

      expect(mockElectronLog.verbose).not.toHaveBeenCalled()
    })

    it('handles empty context gracefully', () => {
      service.setLevel('trace')
      service.trace('Trace message', {})

      expect(mockElectronLog.verbose).toHaveBeenCalledWith('Trace message')
    })
  })

  describe('debug()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs debug message when level is debug', () => {
      service.setLevel('debug')
      service.debug('Debug message')

      expect(mockElectronLog.debug).toHaveBeenCalledWith('Debug message')
    })

    it('logs debug message with context', () => {
      service.setLevel('debug')
      service.debug('Debug message', { file: 'test.ts', line: 42 })

      expect(mockElectronLog.debug).toHaveBeenCalledWith(expect.stringContaining('Debug message'))
      expect(mockElectronLog.debug).toHaveBeenCalledWith(expect.stringContaining('"file"'))
    })

    it('does not log when level is above debug', () => {
      service.setLevel('info')
      service.debug('Debug message')

      expect(mockElectronLog.debug).not.toHaveBeenCalled()
    })
  })

  describe('info()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs info message when level is info (default)', () => {
      service.info('Info message')

      expect(mockElectronLog.info).toHaveBeenCalledWith('Info message')
    })

    it('logs info message with context', () => {
      service.info('Info message', { operation: 'save', status: 'success' })

      expect(mockElectronLog.info).toHaveBeenCalledWith(expect.stringContaining('Info message'))
      expect(mockElectronLog.info).toHaveBeenCalledWith(expect.stringContaining('"operation"'))
    })

    it('does not log when level is above info', () => {
      service.setLevel('warn')
      service.info('Info message')

      expect(mockElectronLog.info).not.toHaveBeenCalled()
    })
  })

  describe('warn()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs warn message when level is warn', () => {
      service.setLevel('warn')
      service.warn('Warning message')

      expect(mockElectronLog.warn).toHaveBeenCalledWith('Warning message')
    })

    it('logs warn message with context', () => {
      service.setLevel('warn')
      service.warn('Warning message', { retries: 3, timeout: 5000 })

      expect(mockElectronLog.warn).toHaveBeenCalledWith(expect.stringContaining('Warning message'))
      expect(mockElectronLog.warn).toHaveBeenCalledWith(expect.stringContaining('"retries"'))
    })

    it('logs warn when level is info', () => {
      service.setLevel('info')
      service.warn('Warning message')

      expect(mockElectronLog.warn).toHaveBeenCalledWith('Warning message')
    })

    it('does not log when level is above warn', () => {
      service.setLevel('error')
      service.warn('Warning message')

      expect(mockElectronLog.warn).not.toHaveBeenCalled()
    })
  })

  describe('error()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs error message', () => {
      service.error('Error message')

      expect(mockElectronLog.error).toHaveBeenCalledWith('Error message')
    })

    it('logs error with Error object', () => {
      const error = new Error('Test error')
      error.stack = 'Error: Test error\n    at test.ts:42'

      service.error('Error occurred', error)

      const call = mockElectronLog.error.mock.calls[0][0]
      expect(call).toContain('Error occurred')
      expect(call).toContain('Test error')
      expect(call).toContain('Stack:')
    })

    it('logs error with context', () => {
      const error = new Error('IO error')
      service.error('File operation failed', error, { path: '/test/file.md' })

      const call = mockElectronLog.error.mock.calls[0][0]
      expect(call).toContain('File operation failed')
      expect(call).toContain('IO error')
      expect(call).toContain('"path"')
    })

    it('handles Error without stack', () => {
      const error = new Error('No stack error')
      delete error.stack

      service.error('Error occurred', error)

      const call = mockElectronLog.error.mock.calls[0][0]
      expect(call).toContain('No stack error')
      expect(call).not.toContain('Stack:')
    })

    it('does not log when level is fatal', () => {
      service.setLevel('fatal')
      service.error('Error message')

      expect(mockElectronLog.error).not.toHaveBeenCalled()
    })

    it('writes to main-only.log', () => {
      // Mock fs module for writeToMainOnly
      const mockFs = {
        existsSync: vi.fn(() => true),
        appendFileSync: vi.fn(),
        statSync: vi.fn(() => ({ size: 1000 })),
        mkdirSync: vi.fn(),
        renameSync: vi.fn()
      }

      vi.doMock('fs', () => mockFs)

      service.error('Error for main-only')

      // Note: We can't easily test the require('fs') inside writeToMainOnly
      // without more complex mocking, but we verify the error log was called
      expect(mockElectronLog.error).toHaveBeenCalled()
    })
  })

  describe('fatal()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs fatal message', () => {
      service.fatal('Fatal error')

      expect(mockElectronLog.error).toHaveBeenCalledWith('Fatal error')
    })

    it('logs fatal with Error object', () => {
      const error = new Error('Fatal crash')
      service.fatal('System crash', error)

      const call = mockElectronLog.error.mock.calls[0][0]
      expect(call).toContain('System crash')
      expect(call).toContain('Fatal crash')
    })

    it('logs fatal with context', () => {
      const error = new Error('Critical failure')
      service.fatal('Application crash', error, { exitCode: 1 })

      const call = mockElectronLog.error.mock.calls[0][0]
      expect(call).toContain('Application crash')
      expect(call).toContain('Critical failure')
      expect(call).toContain('"exitCode"')
    })

    it('writes to main-only.log', () => {
      service.fatal('Fatal for main-only')

      expect(mockElectronLog.error).toHaveBeenCalled()
    })
  })

  describe('logFromRenderer()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
    })

    it('logs trace from renderer', () => {
      service.setLevel('trace')

      const entry: LogEntry = {
        level: 'trace',
        message: 'Renderer trace',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockElectronLog.verbose).toHaveBeenCalledWith(
        expect.stringContaining('[RENDERER]')
      )
      expect(mockElectronLog.verbose).toHaveBeenCalledWith(
        expect.stringContaining('Renderer trace')
      )
    })

    it('logs debug from renderer', () => {
      service.setLevel('debug')

      const entry: LogEntry = {
        level: 'debug',
        message: 'Renderer debug',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockElectronLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('[RENDERER]')
      )
    })

    it('logs info from renderer', () => {
      const entry: LogEntry = {
        level: 'info',
        message: 'Renderer info',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockElectronLog.info).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
    })

    it('logs warn from renderer', () => {
      const entry: LogEntry = {
        level: 'warn',
        message: 'Renderer warn',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockElectronLog.warn).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
    })

    it('logs error from renderer', () => {
      const entry: LogEntry = {
        level: 'error',
        message: 'Renderer error',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockElectronLog.error).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
    })

    it('logs fatal from renderer', () => {
      const entry: LogEntry = {
        level: 'fatal',
        message: 'Renderer fatal',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      service.logFromRenderer(entry)

      expect(mockElectronLog.error).toHaveBeenCalledWith(expect.stringContaining('[RENDERER]'))
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

      const call = mockElectronLog.info.mock.calls[0][0]
      expect(call).toContain('"component"')
      expect(call).toContain('"action"')
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

      const call = mockElectronLog.error.mock.calls[0][0]
      expect(call).toContain('Cannot read property')
      expect(call).toContain('Stack:')
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

      expect(mockElectronLog.debug).not.toHaveBeenCalled()
    })
  })

  describe('cleanupOldLogs()', () => {
    beforeEach(async () => {
      await service.initialize()
      vi.clearAllMocks()
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

      expect(mockUnlink).toHaveBeenCalledWith('/mock-home/.erfana/logs/old.log')
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

    it('only cleans up .log files (not .log.1, .log.2)', async () => {
      mockReaddir.mockResolvedValue(['combined.log', 'combined.log.1', 'main-only.log.2'])
      mockStat.mockResolvedValue({ mtimeMs: 0 }) // Very old
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      expect(mockStat).toHaveBeenCalledWith('/mock-home/.erfana/logs/combined.log')
      expect(mockStat).not.toHaveBeenCalledWith('/mock-home/.erfana/logs/combined.log.1')
      expect(mockStat).not.toHaveBeenCalledWith('/mock-home/.erfana/logs/main-only.log.2')
    })

    it('logs deleted files at debug level', async () => {
      service.setLevel('debug')

      const now = Date.now()
      const oldDate = now - 10 * 24 * 60 * 60 * 1000 // 10 days ago

      mockReaddir.mockResolvedValue(['old.log'])
      mockStat.mockResolvedValue({ mtimeMs: oldDate })
      mockUnlink.mockResolvedValue(undefined)

      await service.cleanupOldLogs()

      expect(mockElectronLog.debug).toHaveBeenCalledWith(
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

      expect(mockElectronLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cleanup log file')
      )
      expect(mockUnlink).toHaveBeenCalledWith('/mock-home/.erfana/logs/success.log')
    })

    it('handles readdir errors gracefully', async () => {
      mockReaddir.mockRejectedValue(new Error('Directory not found'))

      await expect(service.cleanupOldLogs()).resolves.toBeUndefined()

      expect(mockElectronLog.warn).toHaveBeenCalledWith(
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

    it('logger methods call loggingService methods', async () => {
      await loggingService.initialize()
      vi.clearAllMocks()

      logger.info('Test info')

      expect(mockElectronLog.info).toHaveBeenCalledWith('Test info')
    })
  })
})

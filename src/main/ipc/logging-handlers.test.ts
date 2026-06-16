// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Logging IPC Handlers Tests
 *
 * Tests for IPC communication between renderer and main process for logging
 *
 * @see Issue #49 - logging layer implementation
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { LogEntry } from '../../shared/ipc/logging-schema'

// Mock ipcMain and shell
vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn()
  },
  shell: {
    openPath: vi.fn()
  }
}))

// Mock LoggingService
vi.mock('../services/LoggingService', () => ({
  loggingService: {
    logFromRenderer: vi.fn(),
    getLevel: vi.fn(),
    getLogsDir: vi.fn()
  }
}))

// Import after mocks are defined
import { registerLoggingHandlers } from './logging-handlers'
import { ipcMain, shell } from 'electron'
import { loggingService } from '../services/LoggingService'

// Get references to mocked modules
const mockIpcMainOn = (ipcMain.on as any)
const mockIpcMainHandle = (ipcMain.handle as any)
const mockLoggingService = loggingService as any
const mockShell = shell as any

// Mock console.error for invalid entry tests
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

describe('registerLoggingHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('registration', () => {
    it('registers logging:log handler', () => {
      registerLoggingHandlers()

      expect(mockIpcMainOn).toHaveBeenCalledWith('logging:log', expect.any(Function))
    })

    it('registers logging:getLevel handler', () => {
      registerLoggingHandlers()

      expect(mockIpcMainHandle).toHaveBeenCalledWith('logging:getLevel', expect.any(Function))
    })

    it('registers logging:getLogsDir handler', () => {
      registerLoggingHandlers()

      expect(mockIpcMainHandle).toHaveBeenCalledWith('logging:getLogsDir', expect.any(Function))
    })

    it('registers logging:openLogsFolder handler', () => {
      registerLoggingHandlers()

      expect(mockIpcMainHandle).toHaveBeenCalledWith('logging:openLogsFolder', expect.any(Function))
    })

    it('registers exactly 4 handlers', () => {
      registerLoggingHandlers()

      expect(mockIpcMainOn).toHaveBeenCalledTimes(1)
      expect(mockIpcMainHandle).toHaveBeenCalledTimes(3)
    })
  })

  describe('logging:log handler', () => {
    let logHandler: (event: any, entry: unknown) => void

    beforeEach(() => {
      registerLoggingHandlers()

      // Extract the handler function
      const onCalls = mockIpcMainOn.mock.calls
      const logCall = onCalls.find((call) => call[0] === 'logging:log')
      logHandler = logCall![1]
    })

    it('validates log entry with LogEntrySchema', () => {
      const validEntry: LogEntry = {
        level: 'info',
        message: 'Test message',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      logHandler({}, validEntry)

      expect(mockLoggingService.logFromRenderer).toHaveBeenCalledWith(validEntry)
    })

    it('forwards valid entry to loggingService', () => {
      const entry: LogEntry = {
        level: 'debug',
        message: 'Debug message',
        timestamp: new Date().toISOString(),
        source: 'renderer',
        context: { component: 'Editor' }
      }

      logHandler({}, entry)

      expect(mockLoggingService.logFromRenderer).toHaveBeenCalledWith(entry)
      expect(mockLoggingService.logFromRenderer).toHaveBeenCalledTimes(1)
    })

    it('rejects invalid entry (missing level)', () => {
      const invalidEntry = {
        message: 'Test message',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      logHandler({}, invalidEntry)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Invalid log entry from renderer:',
        expect.any(Array)
      )
    })

    it('rejects invalid entry (missing message)', () => {
      const invalidEntry = {
        level: 'info',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      logHandler({}, invalidEntry)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('rejects invalid entry (missing timestamp)', () => {
      const invalidEntry = {
        level: 'info',
        message: 'Test message',
        source: 'renderer'
      }

      logHandler({}, invalidEntry)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('rejects invalid entry (missing source)', () => {
      const invalidEntry = {
        level: 'info',
        message: 'Test message',
        timestamp: new Date().toISOString()
      }

      logHandler({}, invalidEntry)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('rejects invalid level value', () => {
      const invalidEntry = {
        level: 'invalid-level',
        message: 'Test message',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      logHandler({}, invalidEntry)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('rejects invalid source value', () => {
      const invalidEntry = {
        level: 'info',
        message: 'Test message',
        timestamp: new Date().toISOString(),
        source: 'browser'
      }

      logHandler({}, invalidEntry)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('accepts all valid log levels', () => {
      const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

      for (const level of levels) {
        const entry: LogEntry = {
          level,
          message: `${level} message`,
          timestamp: new Date().toISOString(),
          source: 'renderer'
        }

        logHandler({}, entry)

        expect(mockLoggingService.logFromRenderer).toHaveBeenCalledWith(entry)
      }

      expect(mockLoggingService.logFromRenderer).toHaveBeenCalledTimes(6)
    })

    it('accepts entry with optional context', () => {
      const entry: LogEntry = {
        level: 'info',
        message: 'Test with context',
        timestamp: new Date().toISOString(),
        source: 'renderer',
        context: {
          file: 'test.ts',
          line: 42,
          nested: { key: 'value' }
        }
      }

      logHandler({}, entry)

      expect(mockLoggingService.logFromRenderer).toHaveBeenCalledWith(entry)
    })

    it('accepts entry with optional error', () => {
      const entry: LogEntry = {
        level: 'error',
        message: 'Test with error',
        timestamp: new Date().toISOString(),
        source: 'renderer',
        error: {
          name: 'TypeError',
          message: 'Cannot read property',
          stack: 'TypeError: Cannot read property\n    at test.ts:42'
        }
      }

      logHandler({}, entry)

      expect(mockLoggingService.logFromRenderer).toHaveBeenCalledWith(entry)
    })

    it('accepts entry with both context and error', () => {
      const entry: LogEntry = {
        level: 'error',
        message: 'Error with context',
        timestamp: new Date().toISOString(),
        source: 'renderer',
        context: {
          operation: 'save'
        },
        error: {
          name: 'IOError',
          message: 'Write failed'
        }
      }

      logHandler({}, entry)

      expect(mockLoggingService.logFromRenderer).toHaveBeenCalledWith(entry)
    })

    it('rejects invalid error structure (missing name)', () => {
      const invalidEntry = {
        level: 'error',
        message: 'Test error',
        timestamp: new Date().toISOString(),
        source: 'renderer',
        error: {
          message: 'Error message'
        }
      }

      logHandler({}, invalidEntry)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('rejects invalid error structure (missing message)', () => {
      const invalidEntry = {
        level: 'error',
        message: 'Test error',
        timestamp: new Date().toISOString(),
        source: 'renderer',
        error: {
          name: 'Error'
        }
      }

      logHandler({}, invalidEntry)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('rejects non-object context', () => {
      const invalidEntry = {
        level: 'info',
        message: 'Test message',
        timestamp: new Date().toISOString(),
        source: 'renderer',
        context: 'not-an-object'
      }

      logHandler({}, invalidEntry)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('handles null entry', () => {
      logHandler({}, null)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('handles undefined entry', () => {
      logHandler({}, undefined)

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('handles non-object entry', () => {
      logHandler({}, 'not-an-object')

      expect(mockLoggingService.logFromRenderer).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('is one-way (does not send response)', () => {
      // Since it uses ipcMain.on (not handle), it doesn't return anything
      const entry: LogEntry = {
        level: 'info',
        message: 'Test message',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      const result = logHandler({}, entry)

      expect(result).toBeUndefined()
    })
  })

  describe('logging:getLevel handler', () => {
    let getLevelHandler: () => Promise<any>

    beforeEach(() => {
      registerLoggingHandlers()

      // Extract the handler function
      const handleCalls = mockIpcMainHandle.mock.calls
      const getLevelCall = handleCalls.find((call) => call[0] === 'logging:getLevel')
      getLevelHandler = getLevelCall![1]
    })

    it('returns current log level from loggingService', async () => {
      mockLoggingService.getLevel.mockReturnValue('debug')

      const result = await getLevelHandler()

      expect(result).toBe('debug')
      expect(mockLoggingService.getLevel).toHaveBeenCalled()
    })

    it('returns all valid log levels', async () => {
      const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

      for (const level of levels) {
        mockLoggingService.getLevel.mockReturnValue(level)

        const result = await getLevelHandler()

        expect(result).toBe(level)
      }
    })

    it('is async handler', () => {
      mockLoggingService.getLevel.mockReturnValue('info')

      const result = getLevelHandler()

      expect(result).toBeInstanceOf(Promise)
    })

    it('calls loggingService.getLevel once per call', async () => {
      mockLoggingService.getLevel.mockReturnValue('info')

      await getLevelHandler()

      expect(mockLoggingService.getLevel).toHaveBeenCalledTimes(1)
    })
  })

  describe('logging:getLogsDir handler', () => {
    let getLogsDirHandler: () => Promise<any>

    beforeEach(() => {
      registerLoggingHandlers()

      // Extract the handler function
      const handleCalls = mockIpcMainHandle.mock.calls
      const call = handleCalls.find((c) => c[0] === 'logging:getLogsDir')
      getLogsDirHandler = call![1]
    })

    it('returns the logs directory path from loggingService', async () => {
      mockLoggingService.getLogsDir.mockReturnValue('/home/user/.config/erfana/logs')

      const result = await getLogsDirHandler()

      expect(result).toBe('/home/user/.config/erfana/logs')
      expect(mockLoggingService.getLogsDir).toHaveBeenCalled()
    })

    it('calls loggingService.getLogsDir once per call', async () => {
      mockLoggingService.getLogsDir.mockReturnValue('/tmp/erfana/logs')

      await getLogsDirHandler()

      expect(mockLoggingService.getLogsDir).toHaveBeenCalledTimes(1)
    })

    it('is async handler', () => {
      mockLoggingService.getLogsDir.mockReturnValue('/tmp/erfana/logs')

      const result = getLogsDirHandler()

      expect(result).toBeInstanceOf(Promise)
    })
  })

  describe('logging:openLogsFolder handler', () => {
    let openLogsFolderHandler: () => Promise<any>

    beforeEach(() => {
      registerLoggingHandlers()

      // Extract the handler function
      const handleCalls = mockIpcMainHandle.mock.calls
      const call = handleCalls.find((c) => c[0] === 'logging:openLogsFolder')
      openLogsFolderHandler = call![1]
    })

    it('calls shell.openPath with the logs directory path', async () => {
      const logsDir = '/home/user/.config/erfana/logs'
      mockLoggingService.getLogsDir.mockReturnValue(logsDir)
      mockShell.openPath.mockResolvedValue('')

      await openLogsFolderHandler()

      expect(mockShell.openPath).toHaveBeenCalledWith(logsDir)
    })

    it('returns empty string on success', async () => {
      mockLoggingService.getLogsDir.mockReturnValue('/tmp/erfana/logs')
      mockShell.openPath.mockResolvedValue('')

      const result = await openLogsFolderHandler()

      expect(result).toBe('')
    })

    it('returns error string when shell.openPath fails', async () => {
      mockLoggingService.getLogsDir.mockReturnValue('/tmp/erfana/logs')
      mockShell.openPath.mockResolvedValue('Failed to open path: /tmp/erfana/logs')

      const result = await openLogsFolderHandler()

      expect(result).toBe('Failed to open path: /tmp/erfana/logs')
    })

    it('is async handler', () => {
      mockLoggingService.getLogsDir.mockReturnValue('/tmp/erfana/logs')
      mockShell.openPath.mockResolvedValue('')

      const result = openLogsFolderHandler()

      expect(result).toBeInstanceOf(Promise)
    })
  })

  describe('multiple registrations', () => {
    it('can be called multiple times (idempotent)', () => {
      registerLoggingHandlers()
      registerLoggingHandlers()

      // Should register handlers twice (not a problem, last one wins)
      expect(mockIpcMainOn).toHaveBeenCalledTimes(2)
      expect(mockIpcMainHandle).toHaveBeenCalledTimes(6)
    })
  })

  describe('integration scenarios', () => {
    it('handles rapid log entries', () => {
      registerLoggingHandlers()

      const onCalls = mockIpcMainOn.mock.calls
      const logCall = onCalls.find((call) => call[0] === 'logging:log')
      const logHandler = logCall![1]

      const entries: LogEntry[] = Array.from({ length: 100 }, (_, i) => ({
        level: 'info',
        message: `Message ${i}`,
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }))

      for (const entry of entries) {
        logHandler({}, entry)
      }

      expect(mockLoggingService.logFromRenderer).toHaveBeenCalledTimes(100)
    })

    it('validates each entry independently', () => {
      registerLoggingHandlers()

      const onCalls = mockIpcMainOn.mock.calls
      const logCall = onCalls.find((call) => call[0] === 'logging:log')
      const logHandler = logCall![1]

      const validEntry: LogEntry = {
        level: 'info',
        message: 'Valid',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      const invalidEntry = {
        level: 'invalid',
        message: 'Invalid',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }

      logHandler({}, validEntry)
      logHandler({}, invalidEntry)
      logHandler({}, validEntry)

      expect(mockLoggingService.logFromRenderer).toHaveBeenCalledTimes(2)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    })
  })
})

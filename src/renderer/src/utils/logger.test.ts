// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer Logger Tests
 *
 * Tests for renderer process logging with IPC integration
 *
 * @see Issue #49 - logging layer implementation
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RendererLogger, logger, initializeLogger } from './logger'
import type { LogEntry } from '../../../shared/ipc/logging-schema'

// Mock window.api.logging
const mockLoggingAPI = {
  log: vi.fn(),
  getLevel: vi.fn()
}

// Define window.api in global scope
Object.defineProperty(window, 'api', {
  writable: true,
  value: {
    logging: mockLoggingAPI
  }
})

describe('RendererLogger', () => {
  let testLogger: RendererLogger
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    testLogger = new RendererLogger()
    mockLoggingAPI.getLevel.mockResolvedValue('info')
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    addEventListenerSpy.mockRestore()
  })

  describe('initialize()', () => {
    it('syncs level from main process', async () => {
      mockLoggingAPI.getLevel.mockResolvedValue('debug')

      await testLogger.initialize()

      expect(testLogger.getLevel()).toBe('debug')
      expect(mockLoggingAPI.getLevel).toHaveBeenCalled()
    })

    it('installs error handlers', async () => {
      await testLogger.initialize()

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'unhandledrejection',
        expect.any(Function)
      )
      expect(addEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('handles IPC error gracefully', async () => {
      mockLoggingAPI.getLevel.mockRejectedValue(new Error('IPC failed'))

      await testLogger.initialize()

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to initialize renderer logger:',
        expect.any(Error)
      )
      expect(testLogger.getLevel()).toBe('info') // Falls back to default
    })

    it('falls back to info level on error', async () => {
      mockLoggingAPI.getLevel.mockRejectedValue(new Error('IPC error'))

      await testLogger.initialize()

      expect(testLogger.getLevel()).toBe('info')
    })

    it('sets all valid log levels from main', async () => {
      const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

      for (const level of levels) {
        mockLoggingAPI.getLevel.mockResolvedValue(level)
        const newLogger = new RendererLogger()

        await newLogger.initialize()

        expect(newLogger.getLevel()).toBe(level)
      }
    })
  })

  describe('setLevel()', () => {
    it('updates current level', () => {
      testLogger.setLevel('debug')
      expect(testLogger.getLevel()).toBe('debug')
    })

    it('updates to all valid levels', () => {
      const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

      for (const level of levels) {
        testLogger.setLevel(level)
        expect(testLogger.getLevel()).toBe(level)
      }
    })

    it('can be called before initialize', () => {
      expect(() => testLogger.setLevel('warn')).not.toThrow()
      expect(testLogger.getLevel()).toBe('warn')
    })
  })

  describe('getLevel()', () => {
    it('returns default level (info) before initialize', () => {
      expect(testLogger.getLevel()).toBe('info')
    })

    it('returns level after setLevel()', () => {
      testLogger.setLevel('error')
      expect(testLogger.getLevel()).toBe('error')
    })

    it('returns synced level after initialize', async () => {
      mockLoggingAPI.getLevel.mockResolvedValue('warn')

      await testLogger.initialize()

      expect(testLogger.getLevel()).toBe('warn')
    })
  })

  describe('trace()', () => {
    beforeEach(() => {
      testLogger.setLevel('trace')
    })

    it('sends trace log to main process', () => {
      testLogger.trace('Trace message')

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'trace',
          message: 'Trace message',
          source: 'renderer'
        })
      )
    })

    it('includes timestamp', () => {
      const beforeTime = new Date().toISOString()
      testLogger.trace('Test')
      const afterTime = new Date().toISOString()

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.timestamp).toBeDefined()
      expect(call.timestamp >= beforeTime).toBe(true)
      expect(call.timestamp <= afterTime).toBe(true)
    })

    it('includes optional context', () => {
      testLogger.trace('Trace with context', { key: 'value', count: 42 })

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.context).toEqual({ key: 'value', count: 42 })
    })

    it('does not log when level is above trace', () => {
      testLogger.setLevel('debug')
      testLogger.trace('Should not log')

      expect(mockLoggingAPI.log).not.toHaveBeenCalled()
    })

    it('handles empty context', () => {
      testLogger.trace('Test', {})

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.context).toEqual({})
    })

    it('handles IPC error gracefully', () => {
      mockLoggingAPI.log.mockImplementation(() => {
        throw new Error('IPC failed')
      })

      expect(() => testLogger.trace('Test')).not.toThrow()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to send log to main process:',
        expect.any(Error)
      )
    })
  })

  describe('debug()', () => {
    beforeEach(() => {
      testLogger.setLevel('debug')
    })

    it('sends debug log to main process', () => {
      testLogger.debug('Debug message')

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
          message: 'Debug message',
          source: 'renderer'
        })
      )
    })

    it('includes context', () => {
      testLogger.debug('Debug with context', { file: 'test.ts', line: 42 })

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.context).toEqual({ file: 'test.ts', line: 42 })
    })

    it('does not log when level is above debug', () => {
      testLogger.setLevel('info')
      testLogger.debug('Should not log')

      expect(mockLoggingAPI.log).not.toHaveBeenCalled()
    })
  })

  describe('info()', () => {
    beforeEach(() => {
      testLogger.setLevel('info')
    })

    it('sends info log to main process', () => {
      testLogger.info('Info message')

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'Info message',
          source: 'renderer'
        })
      )
    })

    it('includes context', () => {
      testLogger.info('Info with context', { operation: 'save', status: 'success' })

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.context).toEqual({ operation: 'save', status: 'success' })
    })

    it('does not log when level is above info', () => {
      testLogger.setLevel('warn')
      testLogger.info('Should not log')

      expect(mockLoggingAPI.log).not.toHaveBeenCalled()
    })

    it('logs when level is info (default)', () => {
      const defaultLogger = new RendererLogger()
      defaultLogger.info('Default level test')

      expect(mockLoggingAPI.log).toHaveBeenCalled()
    })
  })

  describe('warn()', () => {
    beforeEach(() => {
      testLogger.setLevel('warn')
    })

    it('sends warn log to main process', () => {
      testLogger.warn('Warning message')

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: 'Warning message',
          source: 'renderer'
        })
      )
    })

    it('includes context', () => {
      testLogger.warn('Warning with context', { retries: 3, timeout: 5000 })

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.context).toEqual({ retries: 3, timeout: 5000 })
    })

    it('does not log when level is above warn', () => {
      testLogger.setLevel('error')
      testLogger.warn('Should not log')

      expect(mockLoggingAPI.log).not.toHaveBeenCalled()
    })
  })

  describe('error()', () => {
    beforeEach(() => {
      testLogger.setLevel('error')
    })

    it('sends error log to main process', () => {
      testLogger.error('Error message')

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'Error message',
          source: 'renderer'
        })
      )
    })

    it('includes Error object', () => {
      const error = new Error('Test error')
      error.stack = 'Error: Test error\n    at test.ts:42'

      testLogger.error('Error occurred', error)

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.error).toEqual({
        name: 'Error',
        message: 'Test error',
        stack: 'Error: Test error\n    at test.ts:42'
      })
    })

    it('includes both Error and context', () => {
      const error = new Error('IO error')
      testLogger.error('File operation failed', error, { path: '/test/file.md' })

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.error).toBeDefined()
      expect(call.context).toEqual({ path: '/test/file.md' })
    })

    it('handles Error without stack', () => {
      const error = new Error('No stack error')
      delete error.stack

      testLogger.error('Error occurred', error)

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.error).toEqual({
        name: 'Error',
        message: 'No stack error',
        stack: undefined
      })
    })

    it('does not log when level is fatal', () => {
      testLogger.setLevel('fatal')
      testLogger.error('Should not log')

      expect(mockLoggingAPI.log).not.toHaveBeenCalled()
    })
  })

  describe('fatal()', () => {
    beforeEach(() => {
      testLogger.setLevel('fatal')
    })

    it('sends fatal log to main process', () => {
      testLogger.fatal('Fatal error')

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'fatal',
          message: 'Fatal error',
          source: 'renderer'
        })
      )
    })

    it('includes Error object', () => {
      const error = new Error('Critical failure')
      testLogger.fatal('System crash', error)

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.error).toEqual({
        name: 'Error',
        message: 'Critical failure',
        stack: error.stack
      })
    })

    it('includes both Error and context', () => {
      const error = new Error('Fatal crash')
      testLogger.fatal('Application crash', error, { exitCode: 1 })

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.error).toBeDefined()
      expect(call.context).toEqual({ exitCode: 1 })
    })
  })

  describe('error handlers', () => {
    it('captures unhandledrejection events', async () => {
      await testLogger.initialize()

      const error = new Error('Unhandled rejection')
      const rejectedPromise = Promise.reject(error)
      // Catch to prevent unhandled rejection in test
      rejectedPromise.catch(() => {})

      // Create event using object literal (PromiseRejectionEvent not available in test env)
      const event = {
        type: 'unhandledrejection',
        promise: rejectedPromise,
        reason: error
      } as any

      // Trigger the handler by calling window's event listener directly
      const unhandledRejectionHandler = addEventListenerSpy.mock.calls.find(
        (call: any) => call[0] === 'unhandledrejection'
      )?.[1]

      if (unhandledRejectionHandler) {
        unhandledRejectionHandler(event)
      }

      // Wait for event handler to execute
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'Unhandled promise rejection',
          error: expect.objectContaining({
            name: 'Error',
            message: 'Unhandled rejection'
          })
        })
      )
    })

    it('handles non-Error rejection reasons', async () => {
      await testLogger.initialize()

      const rejectedPromise = Promise.reject('String rejection')
      // Catch to prevent unhandled rejection in test
      rejectedPromise.catch(() => {})

      // Create event using object literal
      const event = {
        type: 'unhandledrejection',
        promise: rejectedPromise,
        reason: 'String rejection'
      } as any

      // Trigger the handler by calling window's event listener directly
      const unhandledRejectionHandler = addEventListenerSpy.mock.calls.find(
        (call: any) => call[0] === 'unhandledrejection'
      )?.[1]

      if (unhandledRejectionHandler) {
        unhandledRejectionHandler(event)
      }

      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'Unhandled promise rejection',
          error: expect.objectContaining({
            message: 'String rejection'
          })
        })
      )
    })

    it('captures error events', async () => {
      await testLogger.initialize()

      const error = new Error('Uncaught error')
      const event = new ErrorEvent('error', {
        error,
        message: 'Uncaught error',
        filename: 'test.ts',
        lineno: 42,
        colno: 10
      })

      window.dispatchEvent(event)

      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'Uncaught error',
          error: expect.objectContaining({
            name: 'Error',
            message: 'Uncaught error'
          }),
          context: expect.objectContaining({
            filename: 'test.ts',
            lineno: 42,
            colno: 10
          })
        })
      )
    })

    it('installs error handlers only once', async () => {
      await testLogger.initialize()

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'unhandledrejection',
        expect.any(Function)
      )
      expect(addEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function))
      expect(addEventListenerSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('log entry structure', () => {
    it('creates valid LogEntry structure', () => {
      testLogger.setLevel('info')
      testLogger.info('Test message', { key: 'value' })

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call).toMatchObject({
        level: 'info',
        message: 'Test message',
        timestamp: expect.any(String),
        source: 'renderer',
        context: { key: 'value' }
      })
    })

    it('includes all required fields', () => {
      testLogger.setLevel('debug')
      testLogger.debug('Test')

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.level).toBeDefined()
      expect(call.message).toBeDefined()
      expect(call.timestamp).toBeDefined()
      expect(call.source).toBeDefined()
    })

    it('includes error field when provided', () => {
      testLogger.setLevel('error')
      const error = new Error('Test error')
      testLogger.error('Error', error)

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.error).toBeDefined()
      expect(call.error?.name).toBe('Error')
      expect(call.error?.message).toBe('Test error')
    })

    it('omits error field when not provided', () => {
      testLogger.setLevel('info')
      testLogger.info('No error')

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.error).toBeUndefined()
    })
  })

  describe('log transport fallback (#60)', () => {
    const overlayLog = vi.fn()

    afterEach(() => {
      ;(window as any).api = { logging: mockLoggingAPI }
      delete (window as any).overlayApi
    })

    it('falls back to the overlay bridge when window.api is absent', () => {
      // The screenshot-overlay window has no `window.api` at all (#164 split
      // preload) — without this fallback it produces no record whatsoever.
      ;(window as any).api = undefined
      ;(window as any).overlayApi = {
        areaSelected: vi.fn(),
        areaCancelled: vi.fn(),
        log: overlayLog
      }

      testLogger.setLevel('info')
      testLogger.info('overlay is alive', { route: 'area-select' })

      expect(overlayLog).toHaveBeenCalledTimes(1)
      expect(overlayLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'overlay is alive',
          source: 'renderer',
          context: { route: 'area-select' }
        })
      )
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })

    it('prefers window.api when both bridges are present', () => {
      ;(window as any).overlayApi = { log: overlayLog }

      testLogger.setLevel('info')
      testLogger.info('editor window message')

      expect(mockLoggingAPI.log).toHaveBeenCalledTimes(1)
      expect(overlayLog).not.toHaveBeenCalled()
    })

    it('ignores an overlay bridge that exposes no log function', () => {
      ;(window as any).api = undefined
      ;(window as any).overlayApi = { areaSelected: vi.fn(), areaCancelled: vi.fn() }

      testLogger.setLevel('error')

      expect(() => testLogger.error('nowhere to go')).not.toThrow()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send log to main process'),
        expect.objectContaining({ message: 'nowhere to go' })
      )
    })

    it('falls back to the console when no bridge exists', () => {
      ;(window as any).api = undefined

      testLogger.setLevel('error')
      testLogger.error('pre-bridge boot failure')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send log to main process'),
        expect.objectContaining({ level: 'error', message: 'pre-bridge boot failure' })
      )
    })
  })

  describe('defensive value extraction (#60)', () => {
    it('keeps the record when error message and stack accessors throw', () => {
      testLogger.setLevel('error')
      const hostile = new Error('unused')
      Object.defineProperty(hostile, 'message', {
        get() {
          throw new Error('hostile message accessor')
        }
      })
      Object.defineProperty(hostile, 'stack', {
        get() {
          throw new Error('hostile stack accessor')
        }
      })

      expect(() => testLogger.error('Something failed', hostile, { file: 'a.md' })).not.toThrow()

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.message).toBe('Something failed')
      expect(call.context).toEqual({ file: 'a.md' })
      expect(call.error).toEqual({
        name: 'Error',
        message: '[unreadable]',
        stack: undefined
      })
    })

    it('keeps the record when the error name accessor throws', () => {
      testLogger.setLevel('error')
      const hostile = new Error('readable message')
      Object.defineProperty(hostile, 'name', {
        get() {
          throw new Error('hostile name accessor')
        }
      })

      testLogger.error('Something failed', hostile)

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.error).toMatchObject({ name: '[unreadable]', message: 'readable message' })
    })

    it('handles a rejection reason whose toString throws', async () => {
      await testLogger.initialize()
      const reason = {
        toString() {
          throw new Error('hostile toString')
        }
      }
      const handler = addEventListenerSpy.mock.calls.find(
        (call: any) => call[0] === 'unhandledrejection'
      )?.[1] as (event: any) => void

      expect(() => handler({ reason, promise: {} })).not.toThrow()

      expect(mockLoggingAPI.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Unhandled promise rejection',
          error: expect.objectContaining({ message: '[unreadable]' })
        })
      )
    })

    it('handles an error event whose fields throw', async () => {
      await testLogger.initialize()
      const handler = addEventListenerSpy.mock.calls.find(
        (call: any) => call[0] === 'error'
      )?.[1] as (event: any) => void

      expect(() =>
        handler({
          get error() {
            throw new Error('hostile error accessor')
          },
          get filename() {
            throw new Error('hostile filename accessor')
          },
          get lineno() {
            throw new Error('hostile lineno accessor')
          },
          colno: 7
        })
      ).not.toThrow()

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.message).toBe('Uncaught error')
      expect(call.error).toBeUndefined()
      expect(call.context).toEqual({ filename: '[unreadable]', lineno: 0, colno: 7 })
    })

    it('normalises a non-Error thrown value on the error event', async () => {
      await testLogger.initialize()
      const handler = addEventListenerSpy.mock.calls.find(
        (call: any) => call[0] === 'error'
      )?.[1] as (event: any) => void

      handler({ error: 'plain string throw', filename: 'a.js', lineno: 3, colno: 4 })

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.error).toMatchObject({ name: 'Error', message: 'plain string throw' })
      expect(call.context).toEqual({ filename: 'a.js', lineno: 3, colno: 4 })
    })
  })

  describe('singleton and exports', () => {
    it('exports singleton logger instance', () => {
      expect(logger).toBeInstanceOf(RendererLogger)
    })

    it('exports initializeLogger function', () => {
      expect(initializeLogger).toBeInstanceOf(Function)
    })

    it('initializeLogger calls logger.initialize()', async () => {
      mockLoggingAPI.getLevel.mockResolvedValue('info')

      await initializeLogger()

      expect(mockLoggingAPI.getLevel).toHaveBeenCalled()
    })
  })

  describe('level filtering', () => {
    it('filters logs based on current level', () => {
      testLogger.setLevel('warn')

      testLogger.trace('Trace')
      testLogger.debug('Debug')
      testLogger.info('Info')
      testLogger.warn('Warn')
      testLogger.error('Error')
      testLogger.fatal('Fatal')

      expect(mockLoggingAPI.log).toHaveBeenCalledTimes(3) // warn, error, fatal
    })

    it('logs everything when level is trace', () => {
      testLogger.setLevel('trace')

      testLogger.trace('Trace')
      testLogger.debug('Debug')
      testLogger.info('Info')
      testLogger.warn('Warn')
      testLogger.error('Error')
      testLogger.fatal('Fatal')

      expect(mockLoggingAPI.log).toHaveBeenCalledTimes(6)
    })

    it('logs only fatal when level is fatal', () => {
      testLogger.setLevel('fatal')

      testLogger.trace('Trace')
      testLogger.debug('Debug')
      testLogger.info('Info')
      testLogger.warn('Warn')
      testLogger.error('Error')
      testLogger.fatal('Fatal')

      expect(mockLoggingAPI.log).toHaveBeenCalledTimes(1)
    })
  })

  describe('edge cases', () => {
    it('handles rapid logging', () => {
      testLogger.setLevel('info')

      for (let i = 0; i < 100; i++) {
        testLogger.info(`Message ${i}`)
      }

      expect(mockLoggingAPI.log).toHaveBeenCalledTimes(100)
    })

    it('handles complex nested context', () => {
      testLogger.setLevel('info')

      const context = {
        nested: {
          deeply: {
            structure: {
              value: 42,
              array: [1, 2, 3],
              nullValue: null,
              undefinedValue: undefined
            }
          }
        }
      }

      testLogger.info('Complex context', context)

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.context).toEqual(context)
    })

    it('handles empty message', () => {
      testLogger.setLevel('info')
      testLogger.info('')

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.message).toBe('')
    })

    it('handles special characters in message', () => {
      testLogger.setLevel('info')
      const message = 'Special chars: \n\t\r"\'\\/'

      testLogger.info(message)

      const call = mockLoggingAPI.log.mock.calls[0][0] as LogEntry
      expect(call.message).toBe(message)
    })
  })
})

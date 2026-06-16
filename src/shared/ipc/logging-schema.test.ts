// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LoggingSchema Tests
 *
 * Tests for log level validation, priority mapping, and log entry schema
 *
 * @see Issue #49 - logging layer implementation
 */
import { describe, it, expect, vi } from 'vitest'
import {
  LogLevelSchema,
  LOG_LEVEL_PRIORITY,
  LogEntrySchema,
  shouldLog,
  validateLogLevel,
  type LogLevel,
  type LogEntry
} from './logging-schema'

describe('LogLevelSchema', () => {
  describe('validation', () => {
    it('validates all 6 log levels', () => {
      expect(LogLevelSchema.parse('trace')).toBe('trace')
      expect(LogLevelSchema.parse('debug')).toBe('debug')
      expect(LogLevelSchema.parse('info')).toBe('info')
      expect(LogLevelSchema.parse('warn')).toBe('warn')
      expect(LogLevelSchema.parse('error')).toBe('error')
      expect(LogLevelSchema.parse('fatal')).toBe('fatal')
    })

    it('rejects invalid log levels', () => {
      expect(() => LogLevelSchema.parse('invalid')).toThrow()
      expect(() => LogLevelSchema.parse('verbose')).toThrow()
      expect(() => LogLevelSchema.parse('silly')).toThrow()
      expect(() => LogLevelSchema.parse('')).toThrow()
      expect(() => LogLevelSchema.parse(null)).toThrow()
      expect(() => LogLevelSchema.parse(undefined)).toThrow()
    })

    it('rejects numeric values', () => {
      expect(() => LogLevelSchema.parse(0)).toThrow()
      expect(() => LogLevelSchema.parse(1)).toThrow()
    })

    it('is case sensitive', () => {
      expect(() => LogLevelSchema.parse('INFO')).toThrow()
      expect(() => LogLevelSchema.parse('Error')).toThrow()
    })
  })
})

describe('LOG_LEVEL_PRIORITY', () => {
  it('has priority for all 6 levels', () => {
    expect(LOG_LEVEL_PRIORITY.trace).toBe(0)
    expect(LOG_LEVEL_PRIORITY.debug).toBe(1)
    expect(LOG_LEVEL_PRIORITY.info).toBe(2)
    expect(LOG_LEVEL_PRIORITY.warn).toBe(3)
    expect(LOG_LEVEL_PRIORITY.error).toBe(4)
    expect(LOG_LEVEL_PRIORITY.fatal).toBe(5)
  })

  it('has ascending priorities from trace to fatal', () => {
    const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

    for (let i = 0; i < levels.length - 1; i++) {
      const current = LOG_LEVEL_PRIORITY[levels[i]]
      const next = LOG_LEVEL_PRIORITY[levels[i + 1]]
      expect(next).toBeGreaterThan(current)
    }
  })

  it('has unique priorities for each level', () => {
    const priorities = Object.values(LOG_LEVEL_PRIORITY)
    const uniquePriorities = new Set(priorities)
    expect(uniquePriorities.size).toBe(priorities.length)
  })
})

describe('LogEntrySchema', () => {
  describe('valid entries', () => {
    it('validates minimal valid entry', () => {
      const entry = {
        level: 'info' as const,
        message: 'Test message',
        timestamp: new Date().toISOString(),
        source: 'renderer' as const
      }

      const result = LogEntrySchema.parse(entry)
      expect(result).toEqual(entry)
    })

    it('validates entry with context', () => {
      const entry = {
        level: 'debug' as const,
        message: 'Test with context',
        timestamp: new Date().toISOString(),
        source: 'main' as const,
        context: {
          file: '/path/to/file.ts',
          line: 42,
          userId: 123,
          nested: { key: 'value' }
        }
      }

      const result = LogEntrySchema.parse(entry)
      expect(result).toEqual(entry)
    })

    it('validates entry with error', () => {
      const entry = {
        level: 'error' as const,
        message: 'Test error',
        timestamp: new Date().toISOString(),
        source: 'renderer' as const,
        error: {
          name: 'TypeError',
          message: 'Cannot read property of undefined',
          stack: 'TypeError: Cannot read property of undefined\n    at ...'
        }
      }

      const result = LogEntrySchema.parse(entry)
      expect(result).toEqual(entry)
    })

    it('validates entry with error without stack', () => {
      const entry = {
        level: 'fatal' as const,
        message: 'Fatal error',
        timestamp: new Date().toISOString(),
        source: 'main' as const,
        error: {
          name: 'FatalError',
          message: 'System crash'
        }
      }

      const result = LogEntrySchema.parse(entry)
      expect(result).toEqual(entry)
    })

    it('validates entry with both context and error', () => {
      const entry = {
        level: 'error' as const,
        message: 'Error with context',
        timestamp: new Date().toISOString(),
        source: 'renderer' as const,
        context: {
          operation: 'saveFile',
          path: '/test/file.md'
        },
        error: {
          name: 'IOError',
          message: 'Permission denied',
          stack: 'IOError: Permission denied\n    at ...'
        }
      }

      const result = LogEntrySchema.parse(entry)
      expect(result).toEqual(entry)
    })

    it('validates all log levels', () => {
      const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

      for (const level of levels) {
        const entry = {
          level,
          message: `Test ${level}`,
          timestamp: new Date().toISOString(),
          source: 'main' as const
        }

        const result = LogEntrySchema.parse(entry)
        expect(result.level).toBe(level)
      }
    })

    it('validates both source values', () => {
      const mainEntry = {
        level: 'info' as const,
        message: 'Main log',
        timestamp: new Date().toISOString(),
        source: 'main' as const
      }

      const rendererEntry = {
        level: 'info' as const,
        message: 'Renderer log',
        timestamp: new Date().toISOString(),
        source: 'renderer' as const
      }

      expect(LogEntrySchema.parse(mainEntry).source).toBe('main')
      expect(LogEntrySchema.parse(rendererEntry).source).toBe('renderer')
    })
  })

  describe('invalid entries', () => {
    it('rejects missing required fields', () => {
      // Missing level
      expect(() =>
        LogEntrySchema.parse({
          message: 'Test',
          timestamp: new Date().toISOString(),
          source: 'renderer'
        })
      ).toThrow()

      // Missing message
      expect(() =>
        LogEntrySchema.parse({
          level: 'info',
          timestamp: new Date().toISOString(),
          source: 'renderer'
        })
      ).toThrow()

      // Missing timestamp
      expect(() =>
        LogEntrySchema.parse({
          level: 'info',
          message: 'Test',
          source: 'renderer'
        })
      ).toThrow()

      // Missing source
      expect(() =>
        LogEntrySchema.parse({
          level: 'info',
          message: 'Test',
          timestamp: new Date().toISOString()
        })
      ).toThrow()
    })

    it('rejects invalid level', () => {
      expect(() =>
        LogEntrySchema.parse({
          level: 'invalid',
          message: 'Test',
          timestamp: new Date().toISOString(),
          source: 'renderer'
        })
      ).toThrow()
    })

    it('rejects invalid source', () => {
      expect(() =>
        LogEntrySchema.parse({
          level: 'info',
          message: 'Test',
          timestamp: new Date().toISOString(),
          source: 'browser'
        })
      ).toThrow()
    })

    it('rejects non-string message', () => {
      expect(() =>
        LogEntrySchema.parse({
          level: 'info',
          message: 123,
          timestamp: new Date().toISOString(),
          source: 'renderer'
        })
      ).toThrow()
    })

    it('rejects non-string timestamp', () => {
      expect(() =>
        LogEntrySchema.parse({
          level: 'info',
          message: 'Test',
          timestamp: Date.now(),
          source: 'renderer'
        })
      ).toThrow()
    })

    it('rejects non-object context', () => {
      expect(() =>
        LogEntrySchema.parse({
          level: 'info',
          message: 'Test',
          timestamp: new Date().toISOString(),
          source: 'renderer',
          context: 'not-an-object'
        })
      ).toThrow()
    })

    it('rejects invalid error structure', () => {
      // Missing required error.name
      expect(() =>
        LogEntrySchema.parse({
          level: 'error',
          message: 'Test',
          timestamp: new Date().toISOString(),
          source: 'renderer',
          error: {
            message: 'Error message'
          }
        })
      ).toThrow()

      // Missing required error.message
      expect(() =>
        LogEntrySchema.parse({
          level: 'error',
          message: 'Test',
          timestamp: new Date().toISOString(),
          source: 'renderer',
          error: {
            name: 'Error'
          }
        })
      ).toThrow()

      // Non-string stack
      expect(() =>
        LogEntrySchema.parse({
          level: 'error',
          message: 'Test',
          timestamp: new Date().toISOString(),
          source: 'renderer',
          error: {
            name: 'Error',
            message: 'Error message',
            stack: 123
          }
        })
      ).toThrow()
    })
  })

  describe('type inference', () => {
    it('infers correct LogEntry type', () => {
      const entry: LogEntry = {
        level: 'warn',
        message: 'Warning message',
        timestamp: new Date().toISOString(),
        source: 'main'
      }

      expect(entry.level).toBe('warn')
      expect(entry.source).toBe('main')
    })

    it('requires all mandatory fields at type level', () => {
      // This should compile (all required fields present)
      const validEntry: LogEntry = {
        level: 'info',
        message: 'Test',
        timestamp: new Date().toISOString(),
        source: 'renderer'
      }
      expect(validEntry).toBeDefined()
    })

    it('allows optional fields at type level', () => {
      const entryWithOptionals: LogEntry = {
        level: 'error',
        message: 'Test',
        timestamp: new Date().toISOString(),
        source: 'main',
        context: { key: 'value' },
        error: {
          name: 'Error',
          message: 'Error message'
        }
      }
      expect(entryWithOptionals).toBeDefined()
    })
  })
})

describe('shouldLog()', () => {
  describe('filtering by minimum level', () => {
    it('returns true when log level equals minimum level', () => {
      expect(shouldLog('info', 'info')).toBe(true)
      expect(shouldLog('debug', 'debug')).toBe(true)
      expect(shouldLog('error', 'error')).toBe(true)
    })

    it('returns true when log level is above minimum level', () => {
      expect(shouldLog('error', 'info')).toBe(true)
      expect(shouldLog('fatal', 'info')).toBe(true)
      expect(shouldLog('warn', 'debug')).toBe(true)
      expect(shouldLog('error', 'debug')).toBe(true)
    })

    it('returns false when log level is below minimum level', () => {
      expect(shouldLog('debug', 'info')).toBe(false)
      expect(shouldLog('trace', 'info')).toBe(false)
      expect(shouldLog('debug', 'warn')).toBe(false)
      expect(shouldLog('info', 'error')).toBe(false)
    })
  })

  describe('trace level filtering', () => {
    it('logs nothing when minimum is above trace', () => {
      expect(shouldLog('trace', 'debug')).toBe(false)
      expect(shouldLog('trace', 'info')).toBe(false)
      expect(shouldLog('trace', 'warn')).toBe(false)
      expect(shouldLog('trace', 'error')).toBe(false)
      expect(shouldLog('trace', 'fatal')).toBe(false)
    })

    it('logs only trace when minimum is trace', () => {
      expect(shouldLog('trace', 'trace')).toBe(true)
    })
  })

  describe('debug level filtering', () => {
    it('logs debug and above when minimum is debug', () => {
      expect(shouldLog('trace', 'debug')).toBe(false)
      expect(shouldLog('debug', 'debug')).toBe(true)
      expect(shouldLog('info', 'debug')).toBe(true)
      expect(shouldLog('warn', 'debug')).toBe(true)
      expect(shouldLog('error', 'debug')).toBe(true)
      expect(shouldLog('fatal', 'debug')).toBe(true)
    })
  })

  describe('info level filtering (default)', () => {
    it('logs info and above when minimum is info', () => {
      expect(shouldLog('trace', 'info')).toBe(false)
      expect(shouldLog('debug', 'info')).toBe(false)
      expect(shouldLog('info', 'info')).toBe(true)
      expect(shouldLog('warn', 'info')).toBe(true)
      expect(shouldLog('error', 'info')).toBe(true)
      expect(shouldLog('fatal', 'info')).toBe(true)
    })
  })

  describe('warn level filtering', () => {
    it('logs warn and above when minimum is warn', () => {
      expect(shouldLog('trace', 'warn')).toBe(false)
      expect(shouldLog('debug', 'warn')).toBe(false)
      expect(shouldLog('info', 'warn')).toBe(false)
      expect(shouldLog('warn', 'warn')).toBe(true)
      expect(shouldLog('error', 'warn')).toBe(true)
      expect(shouldLog('fatal', 'warn')).toBe(true)
    })
  })

  describe('error level filtering', () => {
    it('logs error and above when minimum is error', () => {
      expect(shouldLog('trace', 'error')).toBe(false)
      expect(shouldLog('debug', 'error')).toBe(false)
      expect(shouldLog('info', 'error')).toBe(false)
      expect(shouldLog('warn', 'error')).toBe(false)
      expect(shouldLog('error', 'error')).toBe(true)
      expect(shouldLog('fatal', 'error')).toBe(true)
    })
  })

  describe('fatal level filtering', () => {
    it('logs only fatal when minimum is fatal', () => {
      expect(shouldLog('trace', 'fatal')).toBe(false)
      expect(shouldLog('debug', 'fatal')).toBe(false)
      expect(shouldLog('info', 'fatal')).toBe(false)
      expect(shouldLog('warn', 'fatal')).toBe(false)
      expect(shouldLog('error', 'fatal')).toBe(false)
      expect(shouldLog('fatal', 'fatal')).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles all level combinations', () => {
      const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

      for (const logLevel of levels) {
        for (const minLevel of levels) {
          const result = shouldLog(logLevel, minLevel)
          const expectedResult =
            LOG_LEVEL_PRIORITY[logLevel] >= LOG_LEVEL_PRIORITY[minLevel]

          expect(result).toBe(expectedResult)
        }
      }
    })
  })
})

describe('validateLogLevel()', () => {
  describe('valid log levels', () => {
    it('returns valid log level unchanged', () => {
      expect(validateLogLevel('trace')).toBe('trace')
      expect(validateLogLevel('debug')).toBe('debug')
      expect(validateLogLevel('info')).toBe('info')
      expect(validateLogLevel('warn')).toBe('warn')
      expect(validateLogLevel('error')).toBe('error')
      expect(validateLogLevel('fatal')).toBe('fatal')
    })
  })

  describe('invalid log levels', () => {
    it('returns "info" for invalid string values', () => {
      expect(validateLogLevel('invalid')).toBe('info')
      expect(validateLogLevel('verbose')).toBe('info')
      expect(validateLogLevel('silly')).toBe('info')
      expect(validateLogLevel('')).toBe('info')
    })

    it('returns "info" for null and undefined', () => {
      expect(validateLogLevel(null)).toBe('info')
      expect(validateLogLevel(undefined)).toBe('info')
    })

    it('returns "info" for numeric values', () => {
      expect(validateLogLevel(0)).toBe('info')
      expect(validateLogLevel(1)).toBe('info')
      expect(validateLogLevel(42)).toBe('info')
    })

    it('returns "info" for objects', () => {
      expect(validateLogLevel({})).toBe('info')
      expect(validateLogLevel({ level: 'info' })).toBe('info')
    })

    it('returns "info" for arrays', () => {
      expect(validateLogLevel([])).toBe('info')
      expect(validateLogLevel(['info'])).toBe('info')
    })

    it('returns "info" for case-sensitive mismatch', () => {
      expect(validateLogLevel('INFO')).toBe('info')
      expect(validateLogLevel('Error')).toBe('info')
      expect(validateLogLevel('DEBUG')).toBe('info')
    })
  })

  describe('console error logging', () => {
    it('logs to console.error when validation fails', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      validateLogLevel('invalid')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid log level'),
        'invalid'
      )

      consoleErrorSpy.mockRestore()
    })

    it('does not log when validation succeeds', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      validateLogLevel('info')

      expect(consoleErrorSpy).not.toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })
  })

  describe('type safety', () => {
    it('returns LogLevel type', () => {
      const result = validateLogLevel('debug')
      const _typeCheck: LogLevel = result
      expect(_typeCheck).toBe('debug')
    })

    it('always returns a valid LogLevel', () => {
      const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
      const invalidInputs = ['invalid', null, undefined, 123, {}, []]

      for (const input of invalidInputs) {
        const result = validateLogLevel(input)
        expect(validLevels).toContain(result)
      }
    })
  })
})

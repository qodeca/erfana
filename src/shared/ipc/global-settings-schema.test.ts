/**
 * GlobalSettingsSchema Tests
 *
 * @see Issue #50 - global settings service
 */
import { describe, it, expect } from 'vitest'
import {
  GlobalSettingsSchema,
  LoggingLevelSchema,
  getDefaultGlobalSettings,
  type GlobalSettings,
  type LoggingLevel
} from './global-settings-schema'

describe('LoggingLevelSchema', () => {
  it('validates valid logging levels', () => {
    // 6 levels: trace, debug, info, warn, error, fatal (Issue #49)
    expect(LoggingLevelSchema.parse('trace')).toBe('trace')
    expect(LoggingLevelSchema.parse('debug')).toBe('debug')
    expect(LoggingLevelSchema.parse('info')).toBe('info')
    expect(LoggingLevelSchema.parse('warn')).toBe('warn')
    expect(LoggingLevelSchema.parse('error')).toBe('error')
    expect(LoggingLevelSchema.parse('fatal')).toBe('fatal')
  })

  it('rejects invalid logging levels', () => {
    expect(() => LoggingLevelSchema.parse('invalid')).toThrow()
    expect(() => LoggingLevelSchema.parse('verbose')).toThrow()
    expect(() => LoggingLevelSchema.parse('')).toThrow()
  })
})

describe('GlobalSettingsSchema', () => {
  describe('validation', () => {
    it('validates complete valid settings', () => {
      const settings = {
        $schema: 'https://erfana.dev/schemas/global-settings.json',
        logging: {
          level: 'debug' as const
        },
        editor: {
          preserveLineBreaks: true
        }
      }

      const result = GlobalSettingsSchema.parse(settings)
      expect(result).toEqual(settings)
    })

    it('validates settings without $schema', () => {
      const settings = {
        logging: {
          level: 'warn' as const
        },
        editor: {
          preserveLineBreaks: false
        }
      }

      const result = GlobalSettingsSchema.parse(settings)
      expect(result).toEqual(settings)
    })

    it('applies defaults for missing fields', () => {
      const result = GlobalSettingsSchema.parse({})
      expect(result.logging).toBeDefined()
      expect(result.logging.level).toBe('info')
      expect(result.editor).toBeDefined()
      expect(result.editor.preserveLineBreaks).toBe(false)
    })

    it('applies defaults for partial logging config', () => {
      const result = GlobalSettingsSchema.parse({ logging: {} })
      expect(result.logging.level).toBe('info')
    })

    it('rejects invalid logging levels', () => {
      expect(() =>
        GlobalSettingsSchema.parse({
          logging: { level: 'invalid' }
        })
      ).toThrow()
    })

    it('rejects logging as non-object', () => {
      expect(() =>
        GlobalSettingsSchema.parse({
          logging: 'not-an-object'
        })
      ).toThrow()
    })

    it('allows $schema as optional string', () => {
      const result = GlobalSettingsSchema.parse({
        $schema: 'custom-schema-url'
      })
      expect(result.$schema).toBe('custom-schema-url')
    })
  })

  describe('type inference', () => {
    it('infers correct type for logging.level', () => {
      const settings: GlobalSettings = {
        logging: {
          level: 'debug'
        },
        editor: {
          preserveLineBreaks: false
        }
      }

      // TypeScript should enforce these values
      const level: LoggingLevel = settings.logging.level
      expect(['debug', 'info', 'warn', 'error']).toContain(level)
    })

    it('enforces valid logging levels at type level', () => {
      // This should compile
      const validSettings: GlobalSettings = {
        logging: { level: 'info' },
        editor: { preserveLineBreaks: false }
      }
      expect(validSettings.logging.level).toBe('info')
    })
  })
})

describe('getDefaultGlobalSettings', () => {
  it('returns complete default settings', () => {
    const defaults = getDefaultGlobalSettings()

    expect(defaults).toHaveProperty('logging')
    expect(defaults.logging).toHaveProperty('level')
    expect(defaults).toHaveProperty('editor')
    expect(defaults.editor).toHaveProperty('preserveLineBreaks')
  })

  it('returns info level by default', () => {
    const defaults = getDefaultGlobalSettings()
    expect(defaults.logging.level).toBe('info')
  })

  it('returns preserveLineBreaks as false by default', () => {
    const defaults = getDefaultGlobalSettings()
    expect(defaults.editor.preserveLineBreaks).toBe(false)
  })

  it('returns object that passes schema validation', () => {
    const defaults = getDefaultGlobalSettings()
    const result = GlobalSettingsSchema.parse(defaults)
    expect(result).toEqual(defaults)
  })

  it('returns new object on each call (not cached)', () => {
    const defaults1 = getDefaultGlobalSettings()
    const defaults2 = getDefaultGlobalSettings()

    expect(defaults1).not.toBe(defaults2) // Different object references
    expect(defaults1).toEqual(defaults2) // Same values
  })

  it('does not include $schema by default', () => {
    const defaults = getDefaultGlobalSettings()
    expect(defaults.$schema).toBeUndefined()
  })
})

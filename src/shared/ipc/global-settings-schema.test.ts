// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * GlobalSettingsSchema Tests
 *
 * @see Issue #50 - global settings service
 */
import { describe, it, expect } from 'vitest'
import {
  GlobalSettingsSchema,
  LoggingLevelSchema,
  GitStatusSettingsSchema,
  getDefaultGlobalSettings,
  type GlobalSettings,
  type LoggingLevel,
  type GitStatusSettings
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

describe('GitStatusSettingsSchema', () => {
  it('validates valid git status settings', () => {
    const settings = {
      pollingEnabled: true,
      pollingInterval: 5000
    }
    const result = GitStatusSettingsSchema.parse(settings)
    expect(result).toEqual(settings)
  })

  it('applies defaults for empty object', () => {
    const result = GitStatusSettingsSchema.parse({})
    expect(result.pollingEnabled).toBe(true)
    expect(result.pollingInterval).toBe(5000)
  })

  it('accepts minimum polling interval (3000ms)', () => {
    const result = GitStatusSettingsSchema.parse({ pollingInterval: 3000 })
    expect(result.pollingInterval).toBe(3000)
  })

  it('accepts maximum polling interval (10000ms)', () => {
    const result = GitStatusSettingsSchema.parse({ pollingInterval: 10000 })
    expect(result.pollingInterval).toBe(10000)
  })

  it('rejects polling interval below minimum', () => {
    expect(() =>
      GitStatusSettingsSchema.parse({ pollingInterval: 2999 })
    ).toThrow()
  })

  it('rejects polling interval above maximum', () => {
    expect(() =>
      GitStatusSettingsSchema.parse({ pollingInterval: 10001 })
    ).toThrow()
  })

  it('allows pollingEnabled to be false', () => {
    const result = GitStatusSettingsSchema.parse({ pollingEnabled: false })
    expect(result.pollingEnabled).toBe(false)
  })

  it('infers correct type', () => {
    const settings: GitStatusSettings = {
      pollingEnabled: true,
      pollingInterval: 5000
    }
    expect(settings.pollingEnabled).toBe(true)
    expect(settings.pollingInterval).toBe(5000)
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
        },
        gitStatus: {
          pollingEnabled: true,
          pollingInterval: 5000
        },
        transcription: {
          backend: 'openai' as const,
          openaiApiKeyStored: false,
          whisperModel: 'base' as const
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
        },
        gitStatus: {
          pollingEnabled: false,
          pollingInterval: 3000
        },
        transcription: {
          backend: 'openai' as const,
          openaiApiKeyStored: false,
          whisperModel: 'base' as const
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
      expect(result.gitStatus).toBeDefined()
      expect(result.gitStatus.pollingEnabled).toBe(true)
      expect(result.gitStatus.pollingInterval).toBe(5000)
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
        },
        gitStatus: {
          pollingEnabled: true,
          pollingInterval: 5000
        },
        transcription: {
          backend: 'openai',
          openaiApiKeyStored: false,
          whisperModel: 'base'
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
        editor: { preserveLineBreaks: false },
        gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
        transcription: { backend: 'openai', openaiApiKeyStored: false, whisperModel: 'base' }
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
    expect(defaults).toHaveProperty('gitStatus')
    expect(defaults.gitStatus).toHaveProperty('pollingEnabled')
    expect(defaults.gitStatus).toHaveProperty('pollingInterval')
  })

  it('returns info level by default', () => {
    const defaults = getDefaultGlobalSettings()
    expect(defaults.logging.level).toBe('info')
  })

  it('returns preserveLineBreaks as false by default', () => {
    const defaults = getDefaultGlobalSettings()
    expect(defaults.editor.preserveLineBreaks).toBe(false)
  })

  it('returns gitStatus with pollingEnabled true by default', () => {
    const defaults = getDefaultGlobalSettings()
    expect(defaults.gitStatus.pollingEnabled).toBe(true)
  })

  it('returns gitStatus with pollingInterval 5000ms by default', () => {
    const defaults = getDefaultGlobalSettings()
    expect(defaults.gitStatus.pollingInterval).toBe(5000)
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

  it('returns transcription.whisperModel as base by default', () => {
    const defaults = getDefaultGlobalSettings()
    expect(defaults.transcription.whisperModel).toBe('base')
  })
})

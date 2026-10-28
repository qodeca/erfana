// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * GlobalSettingsSchema Tests
 *
 * @see Issue #50 - global settings service
 */
import { describe, it, expect } from 'vitest'
import {
  CommentIdentityWriteSchema,
  GLOBAL_SETTINGS_WRITE_SCHEMAS,
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
        },
        htmlPreview: {
          enabled: true
        },
        files: {
          exclude: ['tmp']
        },
        terminal: {
          screenReaderMode: 'on' as const
        },
        comments: {
          authorName: 'Ada',
          identityNoticeSeen: true
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
        },
        htmlPreview: {
          enabled: true
        },
        files: {
          exclude: ['tmp']
        },
        terminal: {
          screenReaderMode: 'on' as const
        },
        comments: {
          authorName: 'Ada',
          identityNoticeSeen: true
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

  describe('files.exclude (Issue #211)', () => {
    it('defaults a missing files section to an empty exclude list', () => {
      const result = GlobalSettingsSchema.parse({})
      expect(result.files).toEqual({ exclude: [] })
    })

    it('keeps a valid exclude list', () => {
      const result = GlobalSettingsSchema.parse({ files: { exclude: ['tmp', '**/test-tmp'] } })
      expect(result.files.exclude).toEqual(['tmp', '**/test-tmp'])
    })

    it.each([
      ['a number', 42],
      ['a string', 'tmp'],
      ['null', null],
      ['an array', ['tmp']]
    ])('never fails when files is %s, and keeps every other value', (_label, files) => {
      const result = GlobalSettingsSchema.safeParse({
        logging: { level: 'debug' },
        gitStatus: { pollingEnabled: false, pollingInterval: 3000 },
        files
      })

      expect(result.success).toBe(true)
      expect(result.data?.files).toEqual({ exclude: [] })
      expect(result.data?.logging.level).toBe('debug')
      expect(result.data?.gitStatus).toEqual({ pollingEnabled: false, pollingInterval: 3000 })
    })

    it('never fails when exclude is not an array', () => {
      const result = GlobalSettingsSchema.safeParse({ files: { exclude: 'tmp' } })
      expect(result.success).toBe(true)
      expect(result.data?.files).toEqual({ exclude: [] })
    })

    it('keeps a non-string entry as an empty string so indexes stay stable', () => {
      const result = GlobalSettingsSchema.parse({ files: { exclude: ['a', 7, 'b'] } })
      expect(result.files.exclude).toEqual(['a', '', 'b'])
    })
  })

  describe('terminal.screenReaderMode (lens review [23])', () => {
    it('defaults to auto when the section is missing', () => {
      expect(GlobalSettingsSchema.parse({}).terminal).toEqual({ screenReaderMode: 'auto' })
    })

    it.each(['auto', 'on', 'off'] as const)('keeps %s', (mode) => {
      expect(GlobalSettingsSchema.parse({ terminal: { screenReaderMode: mode } }).terminal.screenReaderMode).toBe(mode)
    })

    it('never fails on a bad value, so it cannot trip the corruption reset', () => {
      const badMode = GlobalSettingsSchema.safeParse({ terminal: { screenReaderMode: 'loud' } })
      expect(badMode.success).toBe(true)
      expect(badMode.data?.terminal).toEqual({ screenReaderMode: 'auto' })

      const badSection = GlobalSettingsSchema.safeParse({ terminal: 'on' })
      expect(badSection.success).toBe(true)
      expect(badSection.data?.terminal).toEqual({ screenReaderMode: 'auto' })
    })

    it('strips unknown keys', () => {
      const parsed = GlobalSettingsSchema.parse({ terminal: { screenReaderMode: 'on', extra: 1 } })
      expect(parsed.terminal).toEqual({ screenReaderMode: 'on' })
    })
  })

  describe('comments – the reviewer identity (html-preview-comments §7.9)', () => {
    it('defaults to "not set" with the notice unseen', () => {
      expect(GlobalSettingsSchema.parse({}).comments).toEqual({ identityNoticeSeen: false })
    })

    it('keeps a name, an email and the notice flag', () => {
      const parsed = GlobalSettingsSchema.parse({
        comments: { authorName: 'Ada', authorEmail: 'ada@example.com', identityNoticeSeen: true }
      })
      expect(parsed.comments).toEqual({ authorName: 'Ada', authorEmail: 'ada@example.com', identityNoticeSeen: true })
    })

    it('reads an over-cap or non-string value as unset, never failing the whole file', () => {
      const result = GlobalSettingsSchema.safeParse({
        comments: { authorName: 'x'.repeat(101), authorEmail: 7, identityNoticeSeen: 'yes' }
      })
      expect(result.success).toBe(true)
      expect(result.data?.comments).toEqual({ authorName: undefined, authorEmail: undefined, identityNoticeSeen: false })

      const badSection = GlobalSettingsSchema.safeParse({ comments: 'me' })
      expect(badSection.success).toBe(true)
      expect(badSection.data?.comments).toEqual({ identityNoticeSeen: false })
    })

    it('strips unknown keys', () => {
      const parsed = GlobalSettingsSchema.parse({ comments: { authorName: 'Ada', identityNoticeSeen: true, role: 'admin' } })
      expect(parsed.comments).toEqual({ authorName: 'Ada', identityNoticeSeen: true })
    })

    it('L6 reads a name or email with a control or invisible character as unset – the writer\'s own rule', () => {
      for (const code of [0x202e, 0x200b, 0x2060, 0xfeff, 0x0007, 0xe000, 0x2028]) {
        const char = String.fromCodePoint(code)
        const parsed = GlobalSettingsSchema.parse({
          comments: { authorName: `Ada${char}`, authorEmail: `a${char}@example.com`, identityNoticeSeen: true }
        })
        expect(parsed.comments).toEqual({ authorName: undefined, authorEmail: undefined, identityNoticeSeen: true })
      }
      expect(GlobalSettingsSchema.parse({ comments: { authorName: 'Zoë Ångström 李', identityNoticeSeen: true } }).comments.authorName).toBe('Zoë Ångström 李')
    })

    it('L6 a write of comments is checked strictly: a refused value is an error with a clear message', () => {
      const write = GLOBAL_SETTINGS_WRITE_SCHEMAS.comments!
      expect(write.safeParse({ authorName: 'Ada', authorEmail: 'ada@example.com', identityNoticeSeen: false }).success).toBe(true)
      const bidi = write.safeParse({ authorName: `Ada${String.fromCodePoint(0x202e)}`, identityNoticeSeen: false })
      expect(bidi.success).toBe(false)
      expect(bidi.error?.issues[0]).toMatchObject({ path: ['authorName'], message: 'The name contains a control or invisible character.' })
      const long = CommentIdentityWriteSchema.safeParse({ authorName: 'x'.repeat(101), identityNoticeSeen: false })
      expect(long.error?.issues[0]).toMatchObject({ path: ['authorName'], message: 'The name is longer than 100 characters.' })
      const email = CommentIdentityWriteSchema.safeParse({ authorEmail: `${'x'.repeat(250)}@a.io`, identityNoticeSeen: false })
      expect(email.error?.issues[0]).toMatchObject({ path: ['authorEmail'], message: 'The email is longer than 254 characters.' })
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
        },
        htmlPreview: {
          enabled: true
        },
        files: {
          exclude: []
        },
        terminal: {
          screenReaderMode: 'auto'
        },
        comments: {
          identityNoticeSeen: false
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
        transcription: { backend: 'openai', openaiApiKeyStored: false, whisperModel: 'base' },
        htmlPreview: { enabled: true },
        files: { exclude: [] },
        terminal: { screenReaderMode: 'auto' },
        comments: { identityNoticeSeen: false }
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

  it('returns files.exclude as an empty list by default (Issue #211)', () => {
    const defaults = getDefaultGlobalSettings()
    expect(defaults.files).toEqual({ exclude: [] })
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Transcription Schema Tests
 *
 * Tests for Zod schemas and types used in transcription IPC.
 *
 * @see Issue #75 - Media import with transcription
 */
import { describe, it, expect } from 'vitest'
import {
  TranscriptionBackendSchema,
  TranscriptionLanguageSchema,
  TranscriptionImportRequestSchema,
  TranscriptionSettingsSchema,
  WhisperModelSchema,
  type TranscriptionBackend,
  type TranscriptionLanguage,
  type TranscriptionImportRequest,
  type TranscriptionSettings,
  type TranscriptionProgress,
  type TranscriptionImportResult,
  type TranscriptionResult,
  type WhisperModel
} from './transcription-schema'

describe('TranscriptionBackendSchema', () => {
  it('validates openai backend', () => {
    expect(TranscriptionBackendSchema.parse('openai')).toBe('openai')
  })

  it('rejects invalid backend', () => {
    expect(() => TranscriptionBackendSchema.parse('azure')).toThrow()
    expect(() => TranscriptionBackendSchema.parse('')).toThrow()
    expect(() => TranscriptionBackendSchema.parse(123)).toThrow()
  })

  it('validates local backend', () => {
    expect(TranscriptionBackendSchema.parse('local')).toBe('local')
  })

  it('infers correct type', () => {
    const backend: TranscriptionBackend = 'openai'
    expect(backend).toBe('openai')
  })
})

describe('WhisperModelSchema', () => {
  it('validates all 5 model sizes', () => {
    const validModels: WhisperModel[] = ['tiny', 'base', 'small', 'medium', 'large']
    for (const model of validModels) {
      expect(WhisperModelSchema.parse(model)).toBe(model)
    }
  })

  it('validates tiny model', () => {
    expect(WhisperModelSchema.parse('tiny')).toBe('tiny')
  })

  it('validates base model', () => {
    expect(WhisperModelSchema.parse('base')).toBe('base')
  })

  it('validates small model', () => {
    expect(WhisperModelSchema.parse('small')).toBe('small')
  })

  it('validates medium model', () => {
    expect(WhisperModelSchema.parse('medium')).toBe('medium')
  })

  it('validates large model', () => {
    expect(WhisperModelSchema.parse('large')).toBe('large')
  })

  it('rejects invalid model name', () => {
    expect(() => WhisperModelSchema.parse('xlarge')).toThrow()
  })

  it('rejects empty string', () => {
    expect(() => WhisperModelSchema.parse('')).toThrow()
  })

  it('rejects numeric value', () => {
    expect(() => WhisperModelSchema.parse(123)).toThrow()
  })

  it('infers correct type', () => {
    const model: WhisperModel = 'small'
    expect(model).toBe('small')
  })
})

describe('TranscriptionLanguageSchema', () => {
  it('validates auto language', () => {
    expect(TranscriptionLanguageSchema.parse('auto')).toBe('auto')
  })

  it('validates common languages', () => {
    const commonLanguages = ['en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'ja', 'zh', 'ko']
    for (const lang of commonLanguages) {
      expect(TranscriptionLanguageSchema.parse(lang)).toBe(lang)
    }
  })

  it('validates all supported languages', () => {
    const allLanguages = [
      'auto', 'en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'zh', 'ko',
      'ar', 'cs', 'da', 'fi', 'el', 'he', 'hi', 'hu', 'id', 'ms', 'no', 'ro',
      'sk', 'sv', 'th', 'tr', 'uk', 'vi'
    ]
    for (const lang of allLanguages) {
      expect(TranscriptionLanguageSchema.parse(lang)).toBe(lang)
    }
  })

  it('rejects invalid language codes', () => {
    expect(() => TranscriptionLanguageSchema.parse('invalid')).toThrow()
    expect(() => TranscriptionLanguageSchema.parse('')).toThrow()
    expect(() => TranscriptionLanguageSchema.parse('EN')).toThrow()
  })

  it('infers correct type', () => {
    const lang: TranscriptionLanguage = 'en'
    expect(lang).toBe('en')
  })
})

describe('TranscriptionImportRequestSchema', () => {
  it('validates valid request', () => {
    const request = {
      filePath: '/path/to/file.mp3',
      language: 'en'
    }
    const result = TranscriptionImportRequestSchema.parse(request)
    expect(result).toEqual(request)
  })

  it('validates request with auto language', () => {
    const request = {
      filePath: '/path/to/recording.wav',
      language: 'auto'
    }
    const result = TranscriptionImportRequestSchema.parse(request)
    expect(result.language).toBe('auto')
  })

  it('rejects empty filePath', () => {
    expect(() =>
      TranscriptionImportRequestSchema.parse({
        filePath: '',
        language: 'en'
      })
    ).toThrow()
  })

  it('rejects missing filePath', () => {
    expect(() =>
      TranscriptionImportRequestSchema.parse({
        language: 'en'
      })
    ).toThrow()
  })

  it('rejects missing language', () => {
    expect(() =>
      TranscriptionImportRequestSchema.parse({
        filePath: '/path/to/file.mp3'
      })
    ).toThrow()
  })

  it('rejects invalid language', () => {
    expect(() =>
      TranscriptionImportRequestSchema.parse({
        filePath: '/path/to/file.mp3',
        language: 'invalid'
      })
    ).toThrow()
  })

  it('rejects non-string filePath', () => {
    expect(() =>
      TranscriptionImportRequestSchema.parse({
        filePath: 123,
        language: 'en'
      })
    ).toThrow()
  })

  it('rejects null request', () => {
    expect(() => TranscriptionImportRequestSchema.parse(null)).toThrow()
  })

  it('infers correct type', () => {
    const request: TranscriptionImportRequest = {
      filePath: '/path/to/file.mp3',
      language: 'en'
    }
    expect(request.filePath).toBe('/path/to/file.mp3')
    expect(request.language).toBe('en')
  })
})

describe('TranscriptionSettingsSchema', () => {
  it('validates complete settings', () => {
    const settings = {
      backend: 'openai',
      openaiApiKeyStored: true,
      whisperModel: 'base'
    }
    const result = TranscriptionSettingsSchema.parse(settings)
    expect(result).toEqual(settings)
  })

  it('applies defaults for empty object', () => {
    const result = TranscriptionSettingsSchema.parse({})
    expect(result.backend).toBe('openai')
    expect(result.openaiApiKeyStored).toBe(false)
  })

  it('applies default backend', () => {
    const result = TranscriptionSettingsSchema.parse({ openaiApiKeyStored: true })
    expect(result.backend).toBe('openai')
  })

  it('applies default openaiApiKeyStored', () => {
    const result = TranscriptionSettingsSchema.parse({ backend: 'openai' })
    expect(result.openaiApiKeyStored).toBe(false)
  })

  it('rejects invalid backend', () => {
    expect(() =>
      TranscriptionSettingsSchema.parse({ backend: 'invalid' })
    ).toThrow()
  })

  it('rejects non-boolean openaiApiKeyStored', () => {
    expect(() =>
      TranscriptionSettingsSchema.parse({ openaiApiKeyStored: 'yes' })
    ).toThrow()
  })

  it('accepts all valid whisperModel values', () => {
    const validModels = ['tiny', 'base', 'small', 'medium', 'large'] as const
    for (const model of validModels) {
      const result = TranscriptionSettingsSchema.parse({ whisperModel: model })
      expect(result.whisperModel).toBe(model)
    }
  })

  it('applies default whisperModel of base when not provided', () => {
    const result = TranscriptionSettingsSchema.parse({})
    expect(result.whisperModel).toBe('base')
  })

  it('rejects invalid whisperModel string', () => {
    expect(() =>
      TranscriptionSettingsSchema.parse({ whisperModel: 'xlarge' })
    ).toThrow()
  })

  it('rejects empty string whisperModel', () => {
    expect(() =>
      TranscriptionSettingsSchema.parse({ whisperModel: '' })
    ).toThrow()
  })

  it('infers correct type', () => {
    const settings: TranscriptionSettings = {
      backend: 'openai',
      openaiApiKeyStored: false,
      whisperModel: 'base'
    }
    expect(settings.backend).toBe('openai')
    expect(settings.openaiApiKeyStored).toBe(false)
  })
})

describe('TranscriptionProgress interface', () => {
  it('allows complete progress object', () => {
    const progress: TranscriptionProgress = {
      percent: 50,
      phase: 'Transcribing chunk 2 of 4',
      currentChunk: 2,
      totalChunks: 4,
      etaSeconds: 120
    }
    expect(progress.percent).toBe(50)
    expect(progress.phase).toBe('Transcribing chunk 2 of 4')
    expect(progress.currentChunk).toBe(2)
    expect(progress.totalChunks).toBe(4)
    expect(progress.etaSeconds).toBe(120)
  })

  it('allows minimal progress object', () => {
    const progress: TranscriptionProgress = {
      percent: 0,
      phase: 'Preparing'
    }
    expect(progress.percent).toBe(0)
    expect(progress.currentChunk).toBeUndefined()
    expect(progress.totalChunks).toBeUndefined()
    expect(progress.etaSeconds).toBeUndefined()
  })
})

describe('TranscriptionImportResult interface', () => {
  it('allows success result', () => {
    const result: TranscriptionImportResult = {
      success: true,
      outputPath: '/project/import/recording.md'
    }
    expect(result.success).toBe(true)
    expect(result.outputPath).toBeDefined()
    expect(result.error).toBeUndefined()
  })

  it('allows error result', () => {
    const result: TranscriptionImportResult = {
      success: false,
      error: 'Transcription failed',
      errorCode: 'TRANSCRIPTION_FAILED'
    }
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.errorCode).toBeDefined()
  })
})

describe('TranscriptionResult interface', () => {
  it('allows success result with transcript', () => {
    const result: TranscriptionResult = {
      success: true,
      transcript: 'Hello world',
      duration: 5.5,
      language: 'en'
    }
    expect(result.success).toBe(true)
    expect(result.transcript).toBe('Hello world')
    expect(result.duration).toBe(5.5)
  })

  it('allows error result', () => {
    const result: TranscriptionResult = {
      success: false,
      error: 'API error',
      errorCode: 'TRANSCRIPTION_API_ERROR'
    }
    expect(result.success).toBe(false)
    expect(result.transcript).toBeUndefined()
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Document Import Schema Tests
 *
 * Tests for Zod schemas used in document import IPC communication.
 *
 * @see Issue #133 - LiteParse IPC handlers, Zod schemas, and preload bridge
 * @see Spec #021 - LiteParse document import
 */
import { describe, it, expect } from 'vitest'
import {
  DocumentImportOptionsSchema,
  DocumentImportRequestSchema,
  type DocumentImportOptions,
  type DocumentImportRequest,
  type DocumentImportProgress,
  type DocumentImportResult,
  type DependencyReadyEvent
} from './import-schema'

describe('DocumentImportOptionsSchema', () => {
  describe('valid inputs', () => {
    it('accepts empty object (all fields optional)', () => {
      const result = DocumentImportOptionsSchema.parse({})
      expect(result).toEqual({})
    })

    it('accepts all fields provided', () => {
      const options = {
        ocr: true,
        ocrLanguage: 'en',
        screenshots: false,
        dpi: 150
      }
      const result = DocumentImportOptionsSchema.parse(options)
      expect(result).toEqual(options)
    })

    it('accepts minimum dpi of 72', () => {
      const result = DocumentImportOptionsSchema.parse({ dpi: 72 })
      expect(result.dpi).toBe(72)
    })

    it('accepts maximum dpi of 600', () => {
      const result = DocumentImportOptionsSchema.parse({ dpi: 600 })
      expect(result.dpi).toBe(600)
    })

    it('accepts ocr: false', () => {
      const result = DocumentImportOptionsSchema.parse({ ocr: false })
      expect(result.ocr).toBe(false)
    })

    it('accepts screenshots: true', () => {
      const result = DocumentImportOptionsSchema.parse({ screenshots: true })
      expect(result.screenshots).toBe(true)
    })

    it('accepts ocrLanguage string', () => {
      const result = DocumentImportOptionsSchema.parse({ ocrLanguage: 'de' })
      expect(result.ocrLanguage).toBe('de')
    })
  })

  describe('invalid inputs', () => {
    it('rejects ocr as non-boolean', () => {
      expect(() => DocumentImportOptionsSchema.parse({ ocr: 'yes' })).toThrow()
    })

    it('rejects dpi as non-number', () => {
      expect(() => DocumentImportOptionsSchema.parse({ dpi: '150' })).toThrow()
    })

    it('rejects dpi below 72', () => {
      expect(() => DocumentImportOptionsSchema.parse({ dpi: 71 })).toThrow()
    })

    it('rejects dpi above 600', () => {
      expect(() => DocumentImportOptionsSchema.parse({ dpi: 601 })).toThrow()
    })

    it('rejects non-integer dpi', () => {
      expect(() => DocumentImportOptionsSchema.parse({ dpi: 150.5 })).toThrow()
    })
  })
})

describe('DocumentImportOptionsSchema – ocrLanguage validation', () => {
  it('accepts two-letter ISO 639-1 code (en)', () => {
    const result = DocumentImportOptionsSchema.parse({ ocrLanguage: 'en' })
    expect(result.ocrLanguage).toBe('en')
  })

  it('accepts three-letter ISO 639-3 code (deu)', () => {
    const result = DocumentImportOptionsSchema.parse({ ocrLanguage: 'deu' })
    expect(result.ocrLanguage).toBe('deu')
  })

  it('accepts underscore codes (chi_sim, srp_latn)', () => {
    const result1 = DocumentImportOptionsSchema.parse({ ocrLanguage: 'chi_sim' })
    expect(result1.ocrLanguage).toBe('chi_sim')

    const result2 = DocumentImportOptionsSchema.parse({ ocrLanguage: 'srp_latn' })
    expect(result2.ocrLanguage).toBe('srp_latn')
  })

  it('rejects single character (e)', () => {
    expect(() => DocumentImportOptionsSchema.parse({ ocrLanguage: 'e' })).toThrow()
  })

  it('rejects four+ characters without underscore (engl)', () => {
    expect(() => DocumentImportOptionsSchema.parse({ ocrLanguage: 'engl' })).toThrow()
  })

  it('rejects digits (e1)', () => {
    expect(() => DocumentImportOptionsSchema.parse({ ocrLanguage: 'e1' })).toThrow()
  })

  it('rejects special characters (e-n)', () => {
    expect(() => DocumentImportOptionsSchema.parse({ ocrLanguage: 'e-n' })).toThrow()
  })

  it('rejects uppercase (EN, DEU)', () => {
    expect(() => DocumentImportOptionsSchema.parse({ ocrLanguage: 'EN' })).toThrow()
    expect(() => DocumentImportOptionsSchema.parse({ ocrLanguage: 'DEU' })).toThrow()
  })

  it('rejects empty string', () => {
    expect(() => DocumentImportOptionsSchema.parse({ ocrLanguage: '' })).toThrow()
  })

  it('respects max length of 10', () => {
    // Exactly 10 characters with underscore – should pass
    const valid = DocumentImportOptionsSchema.parse({ ocrLanguage: 'ab_cdefghi' })
    expect(valid.ocrLanguage).toBe('ab_cdefghi')

    // 11 characters – should fail
    expect(() => DocumentImportOptionsSchema.parse({ ocrLanguage: 'ab_cdefghij' })).toThrow()
  })
})

describe('DocumentImportRequestSchema', () => {
  describe('valid inputs', () => {
    it('accepts minimal request with filePath only', () => {
      const request = { filePath: '/path/to/document.pdf' }
      const result = DocumentImportRequestSchema.parse(request)
      expect(result.filePath).toBe('/path/to/document.pdf')
      expect(result.options).toBeUndefined()
    })

    it('accepts request with all options', () => {
      const request = {
        filePath: '/path/to/document.pdf',
        options: {
          ocr: true,
          ocrLanguage: 'en',
          screenshots: true,
          dpi: 300
        }
      }
      const result = DocumentImportRequestSchema.parse(request)
      expect(result.filePath).toBe('/path/to/document.pdf')
      expect(result.options?.ocr).toBe(true)
      expect(result.options?.dpi).toBe(300)
    })

    it('accepts request with partial options', () => {
      const request = {
        filePath: '/path/to/document.docx',
        options: { ocr: false }
      }
      const result = DocumentImportRequestSchema.parse(request)
      expect(result.options?.ocr).toBe(false)
      expect(result.options?.dpi).toBeUndefined()
    })
  })

  describe('invalid inputs', () => {
    it('rejects empty filePath', () => {
      expect(() =>
        DocumentImportRequestSchema.parse({ filePath: '' })
      ).toThrow()
    })

    it('rejects missing filePath', () => {
      expect(() =>
        DocumentImportRequestSchema.parse({})
      ).toThrow()
    })

    it('rejects null request', () => {
      expect(() => DocumentImportRequestSchema.parse(null)).toThrow()
    })

    it('rejects non-string filePath', () => {
      expect(() =>
        DocumentImportRequestSchema.parse({ filePath: 123 })
      ).toThrow()
    })

    it('rejects dpi below 72 in nested options', () => {
      expect(() =>
        DocumentImportRequestSchema.parse({
          filePath: '/path/to/document.pdf',
          options: { dpi: 10 }
        })
      ).toThrow()
    })

    it('rejects dpi above 600 in nested options', () => {
      expect(() =>
        DocumentImportRequestSchema.parse({
          filePath: '/path/to/document.pdf',
          options: { dpi: 1200 }
        })
      ).toThrow()
    })

    it('rejects non-integer dpi in nested options', () => {
      expect(() =>
        DocumentImportRequestSchema.parse({
          filePath: '/path/to/document.pdf',
          options: { dpi: 150.7 }
        })
      ).toThrow()
    })
  })

  describe('type inference', () => {
    it('infers correct DocumentImportRequest type', () => {
      const request: DocumentImportRequest = {
        filePath: '/path/to/document.pdf',
        options: { ocr: true, dpi: 200 }
      }
      expect(request.filePath).toBe('/path/to/document.pdf')
      expect(request.options?.ocr).toBe(true)
    })

    it('infers correct DocumentImportOptions type', () => {
      const options: DocumentImportOptions = {
        ocr: true,
        ocrLanguage: 'pl',
        screenshots: false,
        dpi: 150
      }
      expect(options.ocrLanguage).toBe('pl')
    })
  })
})

describe('DocumentImportProgress interface', () => {
  it('allows minimal progress object', () => {
    const progress: DocumentImportProgress = {
      percent: 0,
      phase: 'Validating document...'
    }
    expect(progress.percent).toBe(0)
    expect(progress.warnings).toBeUndefined()
  })

  it('allows progress with warning', () => {
    const progress: DocumentImportProgress = {
      percent: 50,
      phase: 'Converting document...',
      warnings: 'OCR failed on page 3'
    }
    expect(progress.percent).toBe(50)
    expect(progress.warnings).toBe('OCR failed on page 3')
  })

  it('allows complete progress at 100', () => {
    const progress: DocumentImportProgress = {
      percent: 100,
      phase: 'Complete'
    }
    expect(progress.percent).toBe(100)
    expect(progress.phase).toBe('Complete')
  })
})

describe('DocumentImportResult interface', () => {
  it('allows success result with outputPath', () => {
    const result: DocumentImportResult = {
      success: true,
      outputPath: '/project/import/document.md'
    }
    expect(result.success).toBe(true)
    expect(result.outputPath).toBeDefined()
    expect(result.error).toBeUndefined()
  })

  it('allows error result with errorCode', () => {
    const result: DocumentImportResult = {
      success: false,
      error: 'Conversion failed',
      errorCode: 'IMPORT_CONVERSION_FAILED'
    }
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.errorCode).toBeDefined()
  })

  it('allows minimal error result without errorCode', () => {
    const result: DocumentImportResult = {
      success: false,
      error: 'Import cancelled'
    }
    expect(result.success).toBe(false)
    expect(result.errorCode).toBeUndefined()
  })
})

describe('DependencyReadyEvent interface', () => {
  it('allows event with all dependencies available', () => {
    const event: DependencyReadyEvent = {
      libreOffice: true,
      imageMagick: true,
      extensions: ['pdf', 'docx', 'jpg']
    }
    expect(event.libreOffice).toBe(true)
    expect(event.extensions).toContain('pdf')
  })

  it('allows event with no optional dependencies', () => {
    const event: DependencyReadyEvent = {
      libreOffice: false,
      imageMagick: false,
      extensions: ['pdf']
    }
    expect(event.libreOffice).toBe(false)
    expect(event.imageMagick).toBe(false)
    expect(event.extensions).toEqual(['pdf'])
  })
})

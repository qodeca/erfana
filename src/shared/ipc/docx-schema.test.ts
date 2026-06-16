// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  DocxExportRequestSchema,
  DocxExportResponseSchema,
  type DocxExportRequest,
  type DocxExportResponse
} from './docx-schema'

/**
 * DOCX Export Schema Tests
 *
 * Tests zod schema validation for DOCX export IPC contracts.
 *
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */

describe('DocxExportRequestSchema', () => {
  describe('valid requests', () => {
    it('should accept valid request with html and fileName', () => {
      const data = {
        html: '<p>Hello world</p>',
        fileName: 'document'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(data)
      }
    })

    it('should accept request with minimal valid values (1 char each)', () => {
      const data = {
        html: 'x',
        fileName: 'y'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.html).toBe('x')
        expect(result.data.fileName).toBe('y')
      }
    })

    it('should accept request with long html content', () => {
      const longHtml = '<div>' + 'x'.repeat(10000) + '</div>'
      const data = {
        html: longHtml,
        fileName: 'large-document'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.html).toBe(longHtml)
      }
    })

    it('should accept request with special characters in fileName', () => {
      const data = {
        html: '<p>Test</p>',
        fileName: 'my-document_v2.0 (draft)'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.fileName).toBe('my-document_v2.0 (draft)')
      }
    })
  })

  describe('invalid html field', () => {
    it('should reject missing html field', () => {
      const data = {
        fileName: 'document'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const htmlError = result.error.issues.find((e) => e.path.includes('html'))
        expect(htmlError).toBeDefined()
      }
    })

    it('should reject empty html string', () => {
      const data = {
        html: '',
        fileName: 'document'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const htmlError = result.error.issues.find((e) => e.path.includes('html'))
        expect(htmlError?.message).toBe('HTML content required')
      }
    })

    it('should reject null html', () => {
      const data = {
        html: null,
        fileName: 'document'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const htmlError = result.error.issues.find((e) => e.path.includes('html'))
        expect(htmlError).toBeDefined()
      }
    })

    it('should reject non-string html (number)', () => {
      const data = {
        html: 123,
        fileName: 'document'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const htmlError = result.error.issues.find((e) => e.path.includes('html'))
        expect(htmlError).toBeDefined()
        expect(htmlError?.message).toContain('string')
      }
    })

    it('should reject non-string html (object)', () => {
      const data = {
        html: { content: '<p>Test</p>' },
        fileName: 'document'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const htmlError = result.error.issues.find((e) => e.path.includes('html'))
        expect(htmlError).toBeDefined()
      }
    })

    it('should reject non-string html (array)', () => {
      const data = {
        html: ['<p>Test</p>'],
        fileName: 'document'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const htmlError = result.error.issues.find((e) => e.path.includes('html'))
        expect(htmlError).toBeDefined()
      }
    })
  })

  describe('invalid fileName field', () => {
    it('should reject missing fileName field', () => {
      const data = {
        html: '<p>Test</p>'
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const fileNameError = result.error.issues.find((e) => e.path.includes('fileName'))
        expect(fileNameError).toBeDefined()
      }
    })

    it('should reject empty fileName string', () => {
      const data = {
        html: '<p>Test</p>',
        fileName: ''
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const fileNameError = result.error.issues.find((e) => e.path.includes('fileName'))
        expect(fileNameError?.message).toBe('Filename required')
      }
    })

    it('should reject null fileName', () => {
      const data = {
        html: '<p>Test</p>',
        fileName: null
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const fileNameError = result.error.issues.find((e) => e.path.includes('fileName'))
        expect(fileNameError).toBeDefined()
      }
    })

    it('should reject non-string fileName (number)', () => {
      const data = {
        html: '<p>Test</p>',
        fileName: 123
      }

      const result = DocxExportRequestSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const fileNameError = result.error.issues.find((e) => e.path.includes('fileName'))
        expect(fileNameError).toBeDefined()
        expect(fileNameError?.message).toContain('string')
      }
    })
  })

  describe('error messages', () => {
    it('should return "HTML content required" for empty html', () => {
      const result = DocxExportRequestSchema.safeParse({ html: '', fileName: 'test' })

      expect(result.success).toBe(false)
      if (!result.success) {
        const htmlError = result.error.issues.find((e) => e.path.includes('html'))
        expect(htmlError?.message).toBe('HTML content required')
      }
    })

    it('should return "Filename required" for empty fileName', () => {
      const result = DocxExportRequestSchema.safeParse({ html: '<p>Test</p>', fileName: '' })

      expect(result.success).toBe(false)
      if (!result.success) {
        const fileNameError = result.error.issues.find((e) => e.path.includes('fileName'))
        expect(fileNameError?.message).toBe('Filename required')
      }
    })
  })

  describe('whitespace-only strings', () => {
    it('should accept whitespace-only html (schema passes, service validates)', () => {
      // Schema uses min(1) which allows whitespace-only strings
      // Service-level validation (DocxService) handles semantic validation
      const result = DocxExportRequestSchema.safeParse({
        html: '   \t\n  ',
        fileName: 'test'
      })

      // Schema only checks non-empty (length >= 1)
      expect(result.success).toBe(true)
    })

    it('should accept whitespace-only fileName (schema passes, service validates)', () => {
      // Schema uses min(1) which allows whitespace-only strings
      // Filename sanitization happens in DocxService
      const result = DocxExportRequestSchema.safeParse({
        html: '<p>Test</p>',
        fileName: '   \t\n  '
      })

      // Schema only checks non-empty (length >= 1)
      expect(result.success).toBe(true)
    })
  })
})

describe('DocxExportResponseSchema', () => {
  describe('success response', () => {
    it('should accept success response with filePath', () => {
      const data = {
        success: true,
        filePath: '/Users/test/documents/export.docx'
      }

      const result = DocxExportResponseSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(data)
        expect(result.data.success).toBe(true)
        expect(result.data.filePath).toBe('/Users/test/documents/export.docx')
      }
    })

    it('should accept success response without optional fields', () => {
      const data = {
        success: true
      }

      const result = DocxExportResponseSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.success).toBe(true)
        expect(result.data.filePath).toBeUndefined()
        expect(result.data.error).toBeUndefined()
        expect(result.data.errorCode).toBeUndefined()
      }
    })
  })

  describe('failure response', () => {
    it('should accept failure response with error and errorCode', () => {
      const data = {
        success: false,
        error: 'Failed to convert HTML to DOCX',
        errorCode: 'CONVERSION_ERROR'
      }

      const result = DocxExportResponseSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.success).toBe(false)
        expect(result.data.error).toBe('Failed to convert HTML to DOCX')
        expect(result.data.errorCode).toBe('CONVERSION_ERROR')
      }
    })

    it('should accept failure response without error message', () => {
      const data = {
        success: false,
        errorCode: 'UNKNOWN_ERROR'
      }

      const result = DocxExportResponseSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.success).toBe(false)
        expect(result.data.error).toBeUndefined()
        expect(result.data.errorCode).toBe('UNKNOWN_ERROR')
      }
    })

    it('should accept failure response without errorCode', () => {
      const data = {
        success: false,
        error: 'Something went wrong'
      }

      const result = DocxExportResponseSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.success).toBe(false)
        expect(result.data.error).toBe('Something went wrong')
        expect(result.data.errorCode).toBeUndefined()
      }
    })
  })

  describe('invalid responses', () => {
    it('should reject response without success field', () => {
      const data = {
        filePath: '/Users/test/export.docx'
      }

      const result = DocxExportResponseSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const successError = result.error.issues.find((e) => e.path.includes('success'))
        expect(successError).toBeDefined()
      }
    })

    it('should reject response with non-boolean success', () => {
      const data = {
        success: 'true'
      }

      const result = DocxExportResponseSchema.safeParse(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        const successError = result.error.issues.find((e) => e.path.includes('success'))
        expect(successError).toBeDefined()
        expect(successError?.message).toContain('boolean')
      }
    })
  })
})

describe('type inference', () => {
  it('should correctly infer DocxExportRequest type', () => {
    const request: DocxExportRequest = {
      html: '<p>Test</p>',
      fileName: 'test-document'
    }

    // Type assertion - if this compiles, type inference works
    expect(request.html).toBe('<p>Test</p>')
    expect(request.fileName).toBe('test-document')
  })

  it('should correctly infer DocxExportResponse type', () => {
    const response: DocxExportResponse = {
      success: true,
      filePath: '/path/to/file.docx'
    }

    // Type assertion - if this compiles, type inference works
    expect(response.success).toBe(true)
    expect(response.filePath).toBe('/path/to/file.docx')
  })
})

/**
 * PdfConverter.test.ts
 *
 * Comprehensive tests for PDF to Markdown converter
 *
 * Test coverage:
 * - Properties: supportedExtensions, requiresConversion, category
 * - validate(): delegation to validateFileForImport
 * - convert(): successful conversion
 * - convert(): file read errors (ENOENT, permission denied)
 * - convert(): encrypted PDF detection (password, encrypted keywords)
 * - convert(): conversion failures (generic errors)
 * - convert(): empty PDF handling
 * - convert(): whitespace-only content
 * - createPdfConverter(): factory function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn()
}))

// Mock @opendocsg/pdf2md
vi.mock('@opendocsg/pdf2md', () => ({
  default: vi.fn()
}))

// Mock validateFileForImport
vi.mock('../../../utils/fileUtils', () => ({
  validateFileForImport: vi.fn()
}))

// Import after mocking
import { readFile } from 'fs/promises'
import pdf2md from '@opendocsg/pdf2md'
import { validateFileForImport } from '../../../utils/fileUtils'
import { PdfConverter, createPdfConverter } from './PdfConverter'

const mockedReadFile = vi.mocked(readFile)
const mockedPdf2md = vi.mocked(pdf2md)
const mockedValidateFileForImport = vi.mocked(validateFileForImport)

describe('PdfConverter', () => {
  let converter: PdfConverter

  beforeEach(() => {
    vi.clearAllMocks()
    converter = new PdfConverter()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('properties', () => {
    describe('supportedExtensions', () => {
      it('should contain only pdf extension', () => {
        expect(converter.supportedExtensions).toEqual(['pdf'])
      })

      it('should have exactly one supported extension', () => {
        expect(converter.supportedExtensions.length).toBe(1)
      })

      it('should be lowercase', () => {
        converter.supportedExtensions.forEach((ext) => {
          expect(ext).toBe(ext.toLowerCase())
        })
      })

      it('should be readonly', () => {
        // TypeScript enforces readonly at compile time
        // At runtime, we verify the array content is correct
        expect(converter.supportedExtensions).toContain('pdf')
      })
    })

    describe('requiresConversion', () => {
      it('should be true (PDF requires conversion to markdown)', () => {
        expect(converter.requiresConversion).toBe(true)
      })
    })

    describe('category', () => {
      it('should be document', () => {
        expect(converter.category).toBe('document')
      })

      it('should be a valid FileTypeCategory', () => {
        const validCategories = ['document', 'text', 'audio', 'video']
        expect(validCategories).toContain(converter.category)
      })
    })
  })

  describe('validate', () => {
    it('should delegate to validateFileForImport', async () => {
      const mockResult = {
        valid: true,
        sizeInMB: 1.5,
        fileName: 'document.pdf'
      }
      mockedValidateFileForImport.mockResolvedValue(mockResult)

      const result = await converter.validate('/path/to/document.pdf')

      expect(mockedValidateFileForImport).toHaveBeenCalledWith('/path/to/document.pdf')
      expect(result).toEqual(mockResult)
    })

    it('should pass through validation errors from validateFileForImport', async () => {
      const mockResult = {
        valid: false,
        error: ErrorCode.IMPORT_FILE_NOT_FOUND,
        sizeInMB: 0,
        fileName: 'nonexistent.pdf'
      }
      mockedValidateFileForImport.mockResolvedValue(mockResult)

      const result = await converter.validate('/path/to/nonexistent.pdf')

      expect(result.valid).toBe(false)
      expect(result.error).toBe(ErrorCode.IMPORT_FILE_NOT_FOUND)
    })

    it('should pass through large file warnings from validateFileForImport', async () => {
      const mockResult = {
        valid: true,
        error: ErrorCode.IMPORT_TOO_LARGE,
        sizeInMB: 60,
        fileName: 'large.pdf'
      }
      mockedValidateFileForImport.mockResolvedValue(mockResult)

      const result = await converter.validate('/path/to/large.pdf')

      expect(result.valid).toBe(true)
      expect(result.error).toBe(ErrorCode.IMPORT_TOO_LARGE)
      expect(result.sizeInMB).toBe(60)
    })

    it('should call validateFileForImport with exact path provided', async () => {
      mockedValidateFileForImport.mockResolvedValue({
        valid: true,
        sizeInMB: 0,
        fileName: 'test.pdf'
      })

      await converter.validate('/Users/test/Documents/my-file.pdf')

      expect(mockedValidateFileForImport).toHaveBeenCalledWith('/Users/test/Documents/my-file.pdf')
    })
  })

  describe('convert', () => {
    describe('successful conversion', () => {
      it('should return success with markdown content', async () => {
        const pdfBuffer = Buffer.from('mock pdf data')
        const markdownContent = '# Document Title\n\nThis is the content.'

        mockedReadFile.mockResolvedValue(pdfBuffer)
        mockedPdf2md.mockResolvedValue(markdownContent)

        const result = await converter.convert('/path/to/document.pdf')

        expect(result.success).toBe(true)
        expect(result.content).toBe(markdownContent)
        expect(result.error).toBeUndefined()
        expect(result.errorCode).toBeUndefined()
      })

      it('should pass buffer to pdf2md', async () => {
        const pdfBuffer = Buffer.from('mock pdf data')
        mockedReadFile.mockResolvedValue(pdfBuffer)
        mockedPdf2md.mockResolvedValue('# Content')

        await converter.convert('/path/to/document.pdf')

        expect(mockedPdf2md).toHaveBeenCalledWith(pdfBuffer)
      })

      it('should read file from provided path', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockResolvedValue('# Content')

        await converter.convert('/Users/test/Documents/report.pdf')

        expect(mockedReadFile).toHaveBeenCalledWith('/Users/test/Documents/report.pdf')
      })

      it('should preserve markdown formatting from pdf2md', async () => {
        const complexMarkdown = `# Heading 1

## Heading 2

- Item 1
- Item 2

**Bold text** and *italic text*

\`\`\`
code block
\`\`\`
`
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockResolvedValue(complexMarkdown)

        const result = await converter.convert('/path/to/document.pdf')

        expect(result.content).toBe(complexMarkdown)
      })
    })

    describe('file read errors', () => {
      it('should return IMPORT_FILE_UNREADABLE for ENOENT error', async () => {
        const error = new Error('ENOENT: no such file or directory')
        mockedReadFile.mockRejectedValue(error)

        const result = await converter.convert('/path/to/nonexistent.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
        expect(result.error).toContain('Failed to read PDF file')
        expect(result.error).toContain('ENOENT')
      })

      it('should return IMPORT_FILE_UNREADABLE for permission denied', async () => {
        const error = new Error('EACCES: permission denied')
        mockedReadFile.mockRejectedValue(error)

        const result = await converter.convert('/protected/document.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
        expect(result.error).toContain('Failed to read PDF file')
        expect(result.error).toContain('permission denied')
      })

      it('should include error message in result for Error instances', async () => {
        const error = new Error('Custom file system error')
        mockedReadFile.mockRejectedValue(error)

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.error).toContain('Custom file system error')
      })

      it('should handle non-Error throws during file read', async () => {
        mockedReadFile.mockRejectedValue('String error')

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
        expect(result.error).toContain('String error')
      })

      it('should not call pdf2md when file read fails', async () => {
        mockedReadFile.mockRejectedValue(new Error('Read failed'))

        await converter.convert('/path/to/file.pdf')

        expect(mockedPdf2md).not.toHaveBeenCalled()
      })
    })

    describe('encrypted PDF detection', () => {
      it('should detect encrypted PDF when error contains "password"', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(new Error('PDF requires a password to open'))

        const result = await converter.convert('/path/to/encrypted.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
        expect(result.error).toBe('PDF is password protected')
      })

      it('should detect encrypted PDF when error contains "encrypted"', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(new Error('PDF is encrypted'))

        const result = await converter.convert('/path/to/protected.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
        expect(result.error).toBe('PDF is password protected')
      })

      it('should detect encrypted PDF case-insensitively for "PASSWORD"', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(new Error('PASSWORD REQUIRED'))

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
      })

      it('should detect encrypted PDF case-insensitively for "ENCRYPTED"', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(new Error('FILE IS ENCRYPTED'))

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
      })

      it('should detect encrypted PDF with mixed case "Password"', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(new Error('Password Protected File'))

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
      })

      it('should detect encrypted PDF with mixed case "Encrypted"', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(new Error('Encrypted PDF Document'))

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
      })
    })

    describe('conversion failures', () => {
      it('should return IMPORT_CORRUPT for generic pdf2md errors', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(new Error('Invalid PDF structure'))

        const result = await converter.convert('/path/to/corrupt.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_CORRUPT)
        expect(result.error).toContain('PDF conversion failed')
        expect(result.error).toContain('Invalid PDF structure')
      })

      it('should handle non-Error throws during conversion', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue('Non-Error conversion failure')

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_CORRUPT)
        expect(result.error).toContain('Non-Error conversion failure')
      })

      it('should include original error message in conversion failure', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(new Error('Malformed XRef table'))

        const result = await converter.convert('/path/to/malformed.pdf')

        expect(result.error).toContain('Malformed XRef table')
      })

      it('should handle undefined rejection during conversion', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(undefined)

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_CORRUPT)
      })

      it('should handle null rejection during conversion', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockRejectedValue(null)

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_CORRUPT)
      })
    })

    describe('empty PDF handling', () => {
      it('should return IMPORT_EMPTY for empty string result', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockResolvedValue('')

        const result = await converter.convert('/path/to/empty.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
        expect(result.error).toBe('PDF has no text content to convert')
      })

      it('should return IMPORT_EMPTY for whitespace-only result', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockResolvedValue('   ')

        const result = await converter.convert('/path/to/whitespace.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
        expect(result.error).toBe('PDF has no text content to convert')
      })

      it('should return IMPORT_EMPTY for tabs-only result', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockResolvedValue('\t\t\t')

        const result = await converter.convert('/path/to/tabs.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      })

      it('should return IMPORT_EMPTY for newlines-only result', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockResolvedValue('\n\n\n')

        const result = await converter.convert('/path/to/newlines.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      })

      it('should return IMPORT_EMPTY for mixed whitespace result', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockResolvedValue('  \t\n  \r\n  ')

        const result = await converter.convert('/path/to/mixed-whitespace.pdf')

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      })

      it('should succeed for content with leading/trailing whitespace', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockResolvedValue('  \n# Title\nContent\n  ')

        const result = await converter.convert('/path/to/file.pdf')

        expect(result.success).toBe(true)
        expect(result.content).toBe('  \n# Title\nContent\n  ')
      })

      it('should succeed for minimal content (single character)', async () => {
        mockedReadFile.mockResolvedValue(Buffer.from('data'))
        mockedPdf2md.mockResolvedValue('a')

        const result = await converter.convert('/path/to/minimal.pdf')

        expect(result.success).toBe(true)
        expect(result.content).toBe('a')
      })
    })
  })

  describe('createPdfConverter factory', () => {
    it('should create a PdfConverter instance', () => {
      const instance = createPdfConverter()

      expect(instance).toBeInstanceOf(PdfConverter)
    })

    it('should create instance with correct properties', () => {
      const instance = createPdfConverter()

      expect(instance.supportedExtensions).toEqual(['pdf'])
      expect(instance.requiresConversion).toBe(true)
      expect(instance.category).toBe('document')
    })

    it('should create independent instances', () => {
      const instance1 = createPdfConverter()
      const instance2 = createPdfConverter()

      expect(instance1).not.toBe(instance2)
    })
  })
})

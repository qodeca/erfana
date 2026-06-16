// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TextConverter.test.ts
 *
 * Comprehensive tests for TextConverter
 *
 * Test coverage:
 * - Properties (supportedExtensions, requiresConversion, category)
 * - validate() method (~3 tests)
 * - convert() method (~25 tests)
 *   - Successful read scenarios
 *   - File read errors (ENOENT, permission denied)
 *   - Encoding errors (EILSEQ, invalid, encoding keywords)
 *   - Empty file detection
 *   - Whitespace-only file detection
 *   - Binary content detection (replacement character threshold)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { TEXT_EXTENSIONS } from '../extensions'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn()
}))

// Mock fileUtils
vi.mock('../../../utils/fileUtils', () => ({
  validateFileForImport: vi.fn()
}))

// Import after mocking
import { readFile } from 'fs/promises'
import { validateFileForImport } from '../../../utils/fileUtils'
import { TextConverter, createTextConverter } from './TextConverter'
import type { ValidationResult } from '../types'

const mockedReadFile = vi.mocked(readFile)
const mockedValidateFileForImport = vi.mocked(validateFileForImport)

describe('TextConverter', () => {
  let converter: TextConverter

  beforeEach(() => {
    vi.clearAllMocks()
    converter = new TextConverter()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('properties', () => {
    describe('supportedExtensions', () => {
      it('should include all TEXT_EXTENSIONS', () => {
        expect(converter.supportedExtensions).toEqual([...TEXT_EXTENSIONS])
      })

      it('should include common text file extensions', () => {
        expect(converter.supportedExtensions).toContain('txt')
        expect(converter.supportedExtensions).toContain('md')
        expect(converter.supportedExtensions).toContain('json')
        expect(converter.supportedExtensions).toContain('xml')
        expect(converter.supportedExtensions).toContain('yaml')
        expect(converter.supportedExtensions).toContain('csv')
      })

      it('should be a copy of TEXT_EXTENSIONS (not a reference)', () => {
        const originalLength = TEXT_EXTENSIONS.length
        converter.supportedExtensions.push('custom')
        expect(TEXT_EXTENSIONS.length).toBe(originalLength)
      })
    })

    describe('requiresConversion', () => {
      it('should be false (text files are imported as-is)', () => {
        expect(converter.requiresConversion).toBe(false)
      })
    })

    describe('category', () => {
      it('should be "text"', () => {
        expect(converter.category).toBe('text')
      })
    })
  })

  describe('validate', () => {
    it('should delegate to validateFileForImport', async () => {
      const mockResult: ValidationResult = {
        valid: true,
        sizeInMB: 0.5,
        fileName: 'test.txt'
      }
      mockedValidateFileForImport.mockResolvedValue(mockResult)

      const result = await converter.validate('/path/to/test.txt')

      expect(mockedValidateFileForImport).toHaveBeenCalledWith('/path/to/test.txt')
      expect(result).toEqual(mockResult)
    })

    it('should return validation error when file not found', async () => {
      const mockResult: ValidationResult = {
        valid: false,
        error: ErrorCode.IMPORT_FILE_NOT_FOUND,
        sizeInMB: 0,
        fileName: 'missing.txt'
      }
      mockedValidateFileForImport.mockResolvedValue(mockResult)

      const result = await converter.validate('/path/to/missing.txt')

      expect(result.valid).toBe(false)
      expect(result.error).toBe(ErrorCode.IMPORT_FILE_NOT_FOUND)
    })

    it('should return size warning for large files', async () => {
      const mockResult: ValidationResult = {
        valid: true,
        error: ErrorCode.IMPORT_TOO_LARGE,
        sizeInMB: 60,
        fileName: 'large.txt'
      }
      mockedValidateFileForImport.mockResolvedValue(mockResult)

      const result = await converter.validate('/path/to/large.txt')

      expect(result.valid).toBe(true)
      expect(result.error).toBe(ErrorCode.IMPORT_TOO_LARGE)
    })
  })

  describe('convert', () => {
    describe('successful read scenarios', () => {
      it('should return success with content for valid UTF-8 text', async () => {
        const textContent = 'Hello, World!'
        mockedReadFile.mockResolvedValue(textContent)

        const result = await converter.convert('/path/to/file.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(textContent)
        expect(result.error).toBeUndefined()
        expect(result.errorCode).toBeUndefined()
      })

      it('should call readFile with utf-8 encoding', async () => {
        mockedReadFile.mockResolvedValue('content')

        await converter.convert('/path/to/file.txt')

        expect(mockedReadFile).toHaveBeenCalledWith('/path/to/file.txt', 'utf-8')
      })

      it('should handle multiline text content', async () => {
        const multilineContent = 'Line 1\nLine 2\nLine 3'
        mockedReadFile.mockResolvedValue(multilineContent)

        const result = await converter.convert('/path/to/file.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(multilineContent)
      })

      it('should handle unicode content', async () => {
        const unicodeContent = 'Hello World'
        mockedReadFile.mockResolvedValue(unicodeContent)

        const result = await converter.convert('/path/to/file.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(unicodeContent)
      })

      it('should handle large text files', async () => {
        const largeContent = 'x'.repeat(10000)
        mockedReadFile.mockResolvedValue(largeContent)

        const result = await converter.convert('/path/to/large.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(largeContent)
      })

      it('should handle JSON content', async () => {
        const jsonContent = '{"key": "value", "number": 42}'
        mockedReadFile.mockResolvedValue(jsonContent)

        const result = await converter.convert('/path/to/data.json')

        expect(result.success).toBe(true)
        expect(result.content).toBe(jsonContent)
      })

      it('should handle markdown content', async () => {
        const markdownContent = '# Heading\n\n**Bold** text'
        mockedReadFile.mockResolvedValue(markdownContent)

        const result = await converter.convert('/path/to/readme.md')

        expect(result.success).toBe(true)
        expect(result.content).toBe(markdownContent)
      })
    })

    describe('file read errors', () => {
      it('should return error for ENOENT (file not found)', async () => {
        mockedReadFile.mockRejectedValue(new Error('ENOENT: no such file or directory'))

        const result = await converter.convert('/path/to/nonexistent.txt')

        expect(result.success).toBe(false)
        expect(result.error).toContain('Failed to read file')
        expect(result.error).toContain('ENOENT')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
      })

      it('should return error for permission denied', async () => {
        mockedReadFile.mockRejectedValue(new Error('EACCES: permission denied'))

        const result = await converter.convert('/path/to/protected.txt')

        expect(result.success).toBe(false)
        expect(result.error).toContain('Failed to read file')
        expect(result.error).toContain('EACCES')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
      })

      it('should return error for generic read errors', async () => {
        mockedReadFile.mockRejectedValue(new Error('Some filesystem error'))

        const result = await converter.convert('/path/to/file.txt')

        expect(result.success).toBe(false)
        expect(result.error).toContain('Failed to read file')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
      })

      it('should handle non-Error thrown values', async () => {
        mockedReadFile.mockRejectedValue('String error')

        const result = await converter.convert('/path/to/file.txt')

        expect(result.success).toBe(false)
        expect(result.error).toContain('Failed to read file')
        expect(result.error).toContain('String error')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
      })
    })

    describe('encoding errors', () => {
      it('should return encoding error for EILSEQ', async () => {
        mockedReadFile.mockRejectedValue(new Error('EILSEQ: illegal byte sequence'))

        const result = await converter.convert('/path/to/binary.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File has invalid text encoding (not valid UTF-8)')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_TEXT_ENCODING_ERROR)
      })

      it('should return encoding error when message contains "invalid"', async () => {
        mockedReadFile.mockRejectedValue(new Error('invalid UTF-8 byte sequence'))

        const result = await converter.convert('/path/to/file.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File has invalid text encoding (not valid UTF-8)')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_TEXT_ENCODING_ERROR)
      })

      it('should return encoding error when message contains "encoding"', async () => {
        mockedReadFile.mockRejectedValue(new Error('text encoding error'))

        const result = await converter.convert('/path/to/file.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File has invalid text encoding (not valid UTF-8)')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_TEXT_ENCODING_ERROR)
      })

      it('should be case-sensitive for encoding keywords', async () => {
        // "INVALID" uppercase should NOT match "invalid" check (includes is case-sensitive)
        mockedReadFile.mockRejectedValue(new Error('some INVALID path'))

        const result = await converter.convert('/path/to/file.txt')

        // Should return generic error because includes() is case-sensitive
        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
      })
    })

    describe('empty file detection', () => {
      it('should return error for completely empty file', async () => {
        mockedReadFile.mockResolvedValue('')

        const result = await converter.convert('/path/to/empty.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File has no content to import')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      })

      it('should return error for whitespace-only file (spaces)', async () => {
        mockedReadFile.mockResolvedValue('   ')

        const result = await converter.convert('/path/to/spaces.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File has no content to import')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      })

      it('should return error for whitespace-only file (tabs)', async () => {
        mockedReadFile.mockResolvedValue('\t\t\t')

        const result = await converter.convert('/path/to/tabs.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File has no content to import')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      })

      it('should return error for whitespace-only file (newlines)', async () => {
        mockedReadFile.mockResolvedValue('\n\n\n')

        const result = await converter.convert('/path/to/newlines.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File has no content to import')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      })

      it('should return error for mixed whitespace-only file', async () => {
        mockedReadFile.mockResolvedValue('  \t\n  \r\n  ')

        const result = await converter.convert('/path/to/mixed.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File has no content to import')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      })

      it('should accept file with single character', async () => {
        mockedReadFile.mockResolvedValue('a')

        const result = await converter.convert('/path/to/single.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe('a')
      })

      it('should accept file with whitespace and content', async () => {
        mockedReadFile.mockResolvedValue('  hello  ')

        const result = await converter.convert('/path/to/file.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe('  hello  ')
      })
    })

    describe('binary content detection', () => {
      it('should reject file with >10% replacement characters', async () => {
        // 100 characters total, 11 replacement chars = 11% (> 10%)
        const binaryContent = '\uFFFD'.repeat(11) + 'a'.repeat(89)
        mockedReadFile.mockResolvedValue(binaryContent)

        const result = await converter.convert('/path/to/binary.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File appears to be binary, not text')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_TEXT_ENCODING_ERROR)
      })

      it('should accept file with exactly 10% replacement characters', async () => {
        // 100 characters total, 10 replacement chars = exactly 10% (not > 10%)
        const content = '\uFFFD'.repeat(10) + 'a'.repeat(90)
        mockedReadFile.mockResolvedValue(content)

        const result = await converter.convert('/path/to/borderline.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(content)
      })

      it('should reject file with 10.1% replacement characters', async () => {
        // 1000 characters total, 101 replacement chars = 10.1% (> 10%)
        const binaryContent = '\uFFFD'.repeat(101) + 'a'.repeat(899)
        mockedReadFile.mockResolvedValue(binaryContent)

        const result = await converter.convert('/path/to/binary.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File appears to be binary, not text')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_TEXT_ENCODING_ERROR)
      })

      it('should accept file with 9.9% replacement characters', async () => {
        // 1000 characters total, 99 replacement chars = 9.9% (< 10%)
        const content = '\uFFFD'.repeat(99) + 'a'.repeat(901)
        mockedReadFile.mockResolvedValue(content)

        const result = await converter.convert('/path/to/almostbinary.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(content)
      })

      it('should accept file with no replacement characters', async () => {
        const cleanContent = 'Hello World, this is clean text!'
        mockedReadFile.mockResolvedValue(cleanContent)

        const result = await converter.convert('/path/to/clean.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(cleanContent)
      })

      it('should accept file with few replacement characters', async () => {
        // 100 characters total, 5 replacement chars = 5% (< 10%)
        const content = '\uFFFD'.repeat(5) + 'Hello World!'.repeat(8)
        mockedReadFile.mockResolvedValue(content)

        const result = await converter.convert('/path/to/few-bad.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(content)
      })

      it('should reject file that is all replacement characters', async () => {
        // 100% replacement characters
        const binaryContent = '\uFFFD'.repeat(100)
        mockedReadFile.mockResolvedValue(binaryContent)

        const result = await converter.convert('/path/to/allbinary.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File appears to be binary, not text')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_TEXT_ENCODING_ERROR)
      })

      it('should handle single replacement character in content', async () => {
        // 10 characters total, 1 replacement char = 10% (not > 10%)
        const content = '\uFFFD' + 'abcdefghi'
        mockedReadFile.mockResolvedValue(content)

        const result = await converter.convert('/path/to/onereplacement.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(content)
      })

      it('should reject two replacement characters in 10-char content', async () => {
        // 10 characters total, 2 replacement chars = 20% (> 10%)
        const content = '\uFFFD\uFFFD' + 'abcdefgh'
        mockedReadFile.mockResolvedValue(content)

        const result = await converter.convert('/path/to/tworeplacement.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File appears to be binary, not text')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_TEXT_ENCODING_ERROR)
      })
    })

    describe('edge cases', () => {
      it('should handle single character file', async () => {
        mockedReadFile.mockResolvedValue('x')

        const result = await converter.convert('/path/to/single.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe('x')
      })

      it('should handle file with only replacement character', async () => {
        // 1 replacement char out of 1 total = 100% (> 10%)
        mockedReadFile.mockResolvedValue('\uFFFD')

        const result = await converter.convert('/path/to/singlebad.txt')

        expect(result.success).toBe(false)
        expect(result.error).toBe('File appears to be binary, not text')
      })

      it('should handle content with null bytes (converted to replacement chars)', async () => {
        // If Node reads null bytes as replacement characters
        const content = 'hello\uFFFDworld'
        mockedReadFile.mockResolvedValue(content)

        const result = await converter.convert('/path/to/nulls.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(content)
      })

      it('should preserve Windows line endings', async () => {
        const windowsContent = 'Line 1\r\nLine 2\r\n'
        mockedReadFile.mockResolvedValue(windowsContent)

        const result = await converter.convert('/path/to/windows.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(windowsContent)
      })

      it('should preserve BOM if present', async () => {
        const bomContent = '\uFEFFHello World'
        mockedReadFile.mockResolvedValue(bomContent)

        const result = await converter.convert('/path/to/bom.txt')

        expect(result.success).toBe(true)
        expect(result.content).toBe(bomContent)
      })
    })
  })

  describe('createTextConverter factory', () => {
    it('should create a new TextConverter instance', () => {
      const converter = createTextConverter()
      expect(converter).toBeInstanceOf(TextConverter)
    })

    it('should create independent instances', () => {
      const converter1 = createTextConverter()
      const converter2 = createTextConverter()
      expect(converter1).not.toBe(converter2)
    })
  })
})

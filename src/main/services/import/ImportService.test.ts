// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ImportService.test.ts
 *
 * Comprehensive tests for ImportService
 *
 * Test coverage:
 * - getConverter() - Returns converter for supported/unsupported extensions
 * - isSupported() - Checks explicit and text-like extensions
 * - getSupportedExtensions() - Returns all registered extensions
 * - validate() - Delegates to converter, handles unsupported types
 * - importFile() - Full workflow with all error conditions
 * - createImportService() - Factory function
 * - importService singleton
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { ErrorCode, AppError } from '../../../shared/errors'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  cp: vi.fn(),
  rm: vi.fn()
}))

// Mock fileUtils
vi.mock('../../utils/fileUtils', () => ({
  sanitizeFileName: vi.fn((name) => name),
  findAvailableFileName: vi.fn(),
  getExtension: vi.fn(),
  changeExtension: vi.fn()
}))

// Mock ConverterRegistry - we'll create controlled mocks
vi.mock('./ConverterRegistry', () => ({
  createConverterRegistry: vi.fn(),
  ConverterRegistry: vi.fn(),
  converterRegistry: {} // placeholder – overridden per-test via constructor injection
}))

// Import after mocking
import { writeFile, mkdir, cp, rm } from 'fs/promises'
import {
  sanitizeFileName,
  findAvailableFileName,
  getExtension,
  changeExtension
} from '../../utils/fileUtils'
import { createConverterRegistry } from './ConverterRegistry'
import { ImportService, createImportService } from './ImportService'
import type { IConverter, ValidationResult, ConversionResult, FileTypeCategory, ImportOptions } from './types'

const mockedWriteFile = vi.mocked(writeFile)
const mockedMkdir = vi.mocked(mkdir)
const mockedCp = vi.mocked(cp)
const mockedRm = vi.mocked(rm)
const mockedSanitizeFileName = vi.mocked(sanitizeFileName)
const mockedFindAvailableFileName = vi.mocked(findAvailableFileName)
const mockedGetExtension = vi.mocked(getExtension)
const mockedChangeExtension = vi.mocked(changeExtension)
const mockedCreateConverterRegistry = vi.mocked(createConverterRegistry)

// ============================================================================
// Mock Converters and Registry
// ============================================================================

/**
 * Creates a mock converter for testing
 */
function createMockConverter(options: {
  extensions: string[]
  requiresConversion: boolean
  category: FileTypeCategory
  validateResult?: ValidationResult
  convertResult?: ConversionResult
}): IConverter {
  return {
    supportedExtensions: options.extensions,
    requiresConversion: options.requiresConversion,
    category: options.category,
    validate: vi.fn().mockResolvedValue(
      options.validateResult ?? {
        valid: true,
        sizeInMB: 1,
        fileName: 'test.pdf'
      }
    ),
    convert: vi.fn().mockResolvedValue(
      options.convertResult ?? {
        success: true,
        content: '# Converted Content'
      }
    )
  }
}

/**
 * Creates a mock ConverterRegistry
 */
function createMockRegistry(converters: Map<string, IConverter> = new Map()) {
  const categoryMap = new Map<string, IConverter>()

  // Build category map from converters
  for (const converter of converters.values()) {
    categoryMap.set(converter.category, converter)
  }

  return {
    getConverter: vi.fn((ext: string) => converters.get(ext.toLowerCase())),
    getConverterByCategory: vi.fn((cat: string) => categoryMap.get(cat)),
    isSupported: vi.fn((ext: string) => converters.has(ext.toLowerCase())),
    getSupportedExtensions: vi.fn(() => Array.from(converters.keys())),
    mightBeTextFile: vi.fn(() => false),
    register: vi.fn(),
    getExtensionsByConversionType: vi.fn(() => ({ requiresConversion: [], passthrough: [] })),
    getCategories: vi.fn(() => [])
  }
}

describe('ImportService', () => {
  let service: ImportService
  let mockRegistry: ReturnType<typeof createMockRegistry>
  let pdfConverter: IConverter
  let textConverter: IConverter

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock converters
    pdfConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })

    textConverter = createMockConverter({
      extensions: ['txt', 'md', 'json'],
      requiresConversion: false,
      category: 'text'
    })

    // Create mock registry with converters
    const converterMap = new Map<string, IConverter>([
      ['pdf', pdfConverter],
      ['txt', textConverter],
      ['md', textConverter],
      ['json', textConverter]
    ])

    mockRegistry = createMockRegistry(converterMap)
    mockedCreateConverterRegistry.mockReturnValue(mockRegistry as never)

    // Create service with mock registry
    service = new ImportService(mockRegistry as never)

    // Default mock implementations
    mockedGetExtension.mockImplementation((path: string) => {
      const parts = path.split('.')
      return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
    })

    mockedSanitizeFileName.mockImplementation((name) => name)
    mockedChangeExtension.mockImplementation((name, ext) => {
      const parts = name.split('.')
      parts.pop()
      return parts.join('.') + ext
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // getConverter()
  // ==========================================================================

  describe('getConverter', () => {
    it('should return converter for supported extension', () => {
      mockedGetExtension.mockReturnValue('pdf')

      const converter = service.getConverter('/path/to/document.pdf')

      expect(mockedGetExtension).toHaveBeenCalledWith('/path/to/document.pdf')
      expect(mockRegistry.getConverter).toHaveBeenCalledWith('pdf')
      expect(converter).toBe(pdfConverter)
    })

    it('should return undefined for unsupported extension', () => {
      mockedGetExtension.mockReturnValue('exe')

      const converter = service.getConverter('/path/to/program.exe')

      expect(mockRegistry.getConverter).toHaveBeenCalledWith('exe')
      expect(converter).toBeUndefined()
    })

    it('should extract extension from full path', () => {
      mockedGetExtension.mockReturnValue('txt')

      service.getConverter('/very/deep/path/to/file.txt')

      expect(mockedGetExtension).toHaveBeenCalledWith('/very/deep/path/to/file.txt')
    })

    it('should return text converter for text extensions', () => {
      mockedGetExtension.mockReturnValue('md')

      const converter = service.getConverter('/path/to/readme.md')

      expect(converter).toBe(textConverter)
    })
  })

  // ==========================================================================
  // isSupported()
  // ==========================================================================

  describe('isSupported', () => {
    describe('explicitly supported extensions', () => {
      it('should return true for pdf extension', () => {
        mockedGetExtension.mockReturnValue('pdf')
        mockRegistry.isSupported.mockReturnValue(true)

        const result = service.isSupported('/path/to/document.pdf')

        expect(result).toBe(true)
      })

      it('should return true for txt extension', () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.isSupported.mockReturnValue(true)

        const result = service.isSupported('/path/to/file.txt')

        expect(result).toBe(true)
      })

      it('should return true for md extension', () => {
        mockedGetExtension.mockReturnValue('md')
        mockRegistry.isSupported.mockReturnValue(true)

        const result = service.isSupported('/path/to/readme.md')

        expect(result).toBe(true)
      })
    })

    describe('text-like extensions via mightBeTextFile', () => {
      it('should return true for js extension via mightBeTextFile', () => {
        mockedGetExtension.mockReturnValue('js')
        mockRegistry.isSupported.mockReturnValue(false)
        mockRegistry.mightBeTextFile.mockReturnValue(true)

        const result = service.isSupported('/path/to/script.js')

        expect(mockRegistry.isSupported).toHaveBeenCalledWith('js')
        expect(mockRegistry.mightBeTextFile).toHaveBeenCalledWith('js')
        expect(result).toBe(true)
      })

      it('should return true for py extension via mightBeTextFile', () => {
        mockedGetExtension.mockReturnValue('py')
        mockRegistry.isSupported.mockReturnValue(false)
        mockRegistry.mightBeTextFile.mockReturnValue(true)

        const result = service.isSupported('/path/to/script.py')

        expect(result).toBe(true)
      })
    })

    describe('unsupported extensions', () => {
      it('should return false for exe extension', () => {
        mockedGetExtension.mockReturnValue('exe')
        mockRegistry.isSupported.mockReturnValue(false)
        mockRegistry.mightBeTextFile.mockReturnValue(false)

        const result = service.isSupported('/path/to/program.exe')

        expect(result).toBe(false)
      })

      it('should return false for dll extension', () => {
        mockedGetExtension.mockReturnValue('dll')
        mockRegistry.isSupported.mockReturnValue(false)
        mockRegistry.mightBeTextFile.mockReturnValue(false)

        const result = service.isSupported('/path/to/library.dll')

        expect(result).toBe(false)
      })

      it('should return false for unknown extension', () => {
        mockedGetExtension.mockReturnValue('xyz')
        mockRegistry.isSupported.mockReturnValue(false)
        mockRegistry.mightBeTextFile.mockReturnValue(false)

        const result = service.isSupported('/path/to/file.xyz')

        expect(result).toBe(false)
      })
    })
  })

  // ==========================================================================
  // getSupportedExtensions()
  // ==========================================================================

  describe('getSupportedExtensions', () => {
    it('should return all registered extensions', () => {
      mockRegistry.getSupportedExtensions.mockReturnValue(['pdf', 'txt', 'md', 'json'])

      const extensions = service.getSupportedExtensions()

      expect(mockRegistry.getSupportedExtensions).toHaveBeenCalled()
      expect(extensions).toEqual(['pdf', 'txt', 'md', 'json'])
    })

    it('should return empty array when no extensions registered', () => {
      mockRegistry.getSupportedExtensions.mockReturnValue([])

      const extensions = service.getSupportedExtensions()

      expect(extensions).toEqual([])
    })
  })

  // ==========================================================================
  // validate()
  // ==========================================================================

  describe('validate', () => {
    it('should return validation for supported file', async () => {
      mockedGetExtension.mockReturnValue('pdf')
      const expectedResult: ValidationResult = {
        valid: true,
        sizeInMB: 2.5,
        fileName: 'document.pdf'
      }
      ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue(expectedResult)

      const result = await service.validate('/path/to/document.pdf')

      expect(mockRegistry.getConverter).toHaveBeenCalledWith('pdf')
      expect(pdfConverter.validate).toHaveBeenCalledWith('/path/to/document.pdf')
      expect(result).toEqual(expectedResult)
    })

    it('should use text converter for text-like extensions not explicitly registered', async () => {
      mockedGetExtension.mockReturnValue('js')
      mockRegistry.getConverter.mockReturnValue(undefined)
      mockRegistry.mightBeTextFile.mockReturnValue(true)
      mockRegistry.getConverterByCategory.mockReturnValue(textConverter)

      const expectedResult: ValidationResult = {
        valid: true,
        sizeInMB: 0.1,
        fileName: 'script.js'
      }
      ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue(expectedResult)

      const result = await service.validate('/path/to/script.js')

      expect(mockRegistry.getConverter).toHaveBeenCalledWith('js')
      expect(mockRegistry.mightBeTextFile).toHaveBeenCalledWith('js')
      expect(mockRegistry.getConverterByCategory).toHaveBeenCalledWith('text')
      expect(textConverter.validate).toHaveBeenCalledWith('/path/to/script.js')
      expect(result).toEqual(expectedResult)
    })

    it('should return IMPORT_UNSUPPORTED_TYPE for unsupported extension', async () => {
      mockedGetExtension.mockReturnValue('exe')
      mockRegistry.getConverter.mockReturnValue(undefined)
      mockRegistry.mightBeTextFile.mockReturnValue(false)

      const result = await service.validate('/path/to/program.exe')

      expect(result.valid).toBe(false)
      expect(result.error).toBe(ErrorCode.IMPORT_UNSUPPORTED_TYPE)
      expect(result.sizeInMB).toBe(0)
      expect(result.fileName).toBe('program.exe')
    })

    it('should delegate validation to converter', async () => {
      mockedGetExtension.mockReturnValue('txt')
      mockRegistry.getConverter.mockReturnValue(textConverter)
      const validationResult: ValidationResult = {
        valid: true,
        error: ErrorCode.IMPORT_TOO_LARGE,
        sizeInMB: 60,
        fileName: 'large.txt'
      }
      ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue(validationResult)

      const result = await service.validate('/path/to/large.txt')

      expect(textConverter.validate).toHaveBeenCalledWith('/path/to/large.txt')
      expect(result).toEqual(validationResult)
    })
  })

  // ==========================================================================
  // importFile() - Full workflow
  // ==========================================================================

  describe('importFile', () => {
    const projectPath = path.join('/project', 'root')
    const importDir = path.join('/project', 'root', 'import')

    beforeEach(() => {
      mockedMkdir.mockResolvedValue(undefined)
      mockedWriteFile.mockResolvedValue(undefined)
      mockedCp.mockResolvedValue(undefined)
      mockedRm.mockResolvedValue(undefined)
    })

    describe('successful imports', () => {
      it('should successfully import PDF (converted to .md)', async () => {
        mockedGetExtension.mockReturnValue('pdf')
        mockRegistry.getConverter.mockReturnValue(pdfConverter)
        ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 1,
          fileName: 'document.pdf'
        })
        ;(pdfConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: '# PDF Content'
        })
        mockedSanitizeFileName.mockReturnValue('document.pdf')
        mockedChangeExtension.mockReturnValue('document.md')
        mockedFindAvailableFileName.mockResolvedValue('/project/root/import/document.md')

        const result = await service.importFile('/path/to/document.pdf', projectPath)

        expect(result.success).toBe(true)
        expect(result.outputPath).toBe('/project/root/import/document.md')
        expect(mockedMkdir).toHaveBeenCalledWith(importDir, { recursive: true })
        expect(mockedWriteFile).toHaveBeenCalledWith(
          '/project/root/import/document.md',
          '# PDF Content',
          'utf-8'
        )
        expect(mockedChangeExtension).toHaveBeenCalledWith('document.pdf', '.md')
      })

      it('should successfully import text file (keeps extension)', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.5,
          fileName: 'notes.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'Text content here'
        })
        mockedSanitizeFileName.mockReturnValue('notes.txt')
        mockedFindAvailableFileName.mockResolvedValue('/project/root/import/notes.txt')

        const result = await service.importFile('/path/to/notes.txt', projectPath)

        expect(result.success).toBe(true)
        expect(result.outputPath).toBe('/project/root/import/notes.txt')
        // Text converter has requiresConversion=false, so changeExtension should NOT be called
        expect(mockedChangeExtension).not.toHaveBeenCalled()
        expect(mockedWriteFile).toHaveBeenCalledWith(
          '/project/root/import/notes.txt',
          'Text content here',
          'utf-8'
        )
      })

      it('should return correct outputPath on success', async () => {
        mockedGetExtension.mockReturnValue('md')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'readme.md'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: '# README'
        })
        mockedSanitizeFileName.mockReturnValue('readme.md')
        mockedFindAvailableFileName.mockResolvedValue('/project/root/import/readme.md')

        const result = await service.importFile('/path/to/readme.md', projectPath)

        expect(result.success).toBe(true)
        expect(result.outputPath).toBe('/project/root/import/readme.md')
        expect(result.error).toBeUndefined()
        expect(result.errorCode).toBeUndefined()
      })
    })

    describe('unsupported file type', () => {
      it('should return error for unsupported file type', async () => {
        mockedGetExtension.mockReturnValue('exe')
        mockRegistry.getConverter.mockReturnValue(undefined)
        mockRegistry.mightBeTextFile.mockReturnValue(false)

        const result = await service.importFile('/path/to/program.exe', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('File type .exe is not supported for import')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_UNSUPPORTED_TYPE)
      })
    })

    describe('validation failures', () => {
      it('should return error when validation fails', async () => {
        mockedGetExtension.mockReturnValue('pdf')
        mockRegistry.getConverter.mockReturnValue(pdfConverter)
        ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: false,
          error: ErrorCode.IMPORT_ENCRYPTED,
          sizeInMB: 0,
          fileName: 'encrypted.pdf'
        })

        const result = await service.importFile('/path/to/encrypted.pdf', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('File validation failed: encrypted.pdf')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
      })

      it('should allow import when IMPORT_TOO_LARGE warning (just a warning)', async () => {
        mockedGetExtension.mockReturnValue('pdf')
        mockRegistry.getConverter.mockReturnValue(pdfConverter)
        // IMPORT_TOO_LARGE is valid=false but should still proceed
        ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: false,
          error: ErrorCode.IMPORT_TOO_LARGE,
          sizeInMB: 60,
          fileName: 'large.pdf'
        })
        ;(pdfConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: '# Large PDF Content'
        })
        mockedSanitizeFileName.mockReturnValue('large.pdf')
        mockedChangeExtension.mockReturnValue('large.md')
        mockedFindAvailableFileName.mockResolvedValue('/project/root/import/large.md')

        const result = await service.importFile('/path/to/large.pdf', projectPath)

        // Should succeed because IMPORT_TOO_LARGE is just a warning
        expect(result.success).toBe(true)
        expect(result.outputPath).toBe('/project/root/import/large.md')
      })

      it('should return error for IMPORT_EMPTY validation failure', async () => {
        mockedGetExtension.mockReturnValue('pdf')
        mockRegistry.getConverter.mockReturnValue(pdfConverter)
        ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: false,
          error: ErrorCode.IMPORT_EMPTY,
          sizeInMB: 0,
          fileName: 'empty.pdf'
        })

        const result = await service.importFile('/path/to/empty.pdf', projectPath)

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      })
    })

    describe('conversion failures', () => {
      it('should return error when conversion fails', async () => {
        mockedGetExtension.mockReturnValue('pdf')
        mockRegistry.getConverter.mockReturnValue(pdfConverter)
        ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 1,
          fileName: 'corrupt.pdf'
        })
        ;(pdfConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: 'PDF parsing failed',
          errorCode: ErrorCode.IMPORT_CORRUPT
        })

        const result = await service.importFile('/path/to/corrupt.pdf', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('PDF parsing failed')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_CORRUPT)
      })

      it('should use default error code when conversion fails without errorCode', async () => {
        mockedGetExtension.mockReturnValue('pdf')
        mockRegistry.getConverter.mockReturnValue(pdfConverter)
        ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 1,
          fileName: 'file.pdf'
        })
        ;(pdfConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: 'Unknown conversion error'
        })

        const result = await service.importFile('/path/to/file.pdf', projectPath)

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe(ErrorCode.IMPORT_CONVERSION_FAILED)
      })

      it('should use default error message when conversion fails without error message', async () => {
        mockedGetExtension.mockReturnValue('pdf')
        mockRegistry.getConverter.mockReturnValue(pdfConverter)
        ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 1,
          fileName: 'file.pdf'
        })
        ;(pdfConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false
        })

        const result = await service.importFile('/path/to/file.pdf', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Conversion failed')
      })

      it('should return error when conversion returns no content', async () => {
        mockedGetExtension.mockReturnValue('pdf')
        mockRegistry.getConverter.mockReturnValue(pdfConverter)
        ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 1,
          fileName: 'file.pdf'
        })
        ;(pdfConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: undefined
        })

        const result = await service.importFile('/path/to/file.pdf', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Conversion failed')
      })
    })

    describe('directory creation', () => {
      it('should create import directory if not exists', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'file.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'content'
        })
        mockedSanitizeFileName.mockReturnValue('file.txt')
        mockedFindAvailableFileName.mockResolvedValue('/project/root/import/file.txt')

        await service.importFile('/path/to/file.txt', projectPath)

        expect(mockedMkdir).toHaveBeenCalledWith(importDir, { recursive: true })
      })

      it('should return error if mkdir fails', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'file.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'content'
        })
        mockedMkdir.mockRejectedValue(new Error('EACCES: permission denied'))

        const result = await service.importFile('/path/to/file.txt', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Failed to create import directory')
        expect(result.error).toContain('EACCES')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_DIR_CREATE_FAILED)
      })

      it('should handle non-Error thrown from mkdir', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'file.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'content'
        })
        mockedMkdir.mockRejectedValue('String error')

        const result = await service.importFile('/path/to/file.txt', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Failed to create import directory')
        expect(result.error).toContain('String error')
      })
    })

    describe('filename conflict handling', () => {
      it('should handle filename conflicts with findAvailableFileName', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'file.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'content'
        })
        mockedSanitizeFileName.mockReturnValue('file.txt')
        // Simulate conflict resolution
        mockedFindAvailableFileName.mockResolvedValue('/project/root/import/file (1).txt')

        const result = await service.importFile('/path/to/file.txt', projectPath)

        expect(mockedFindAvailableFileName).toHaveBeenCalledWith(
          importDir,
          'file.txt'
        )
        expect(result.success).toBe(true)
        expect(result.outputPath).toBe('/project/root/import/file (1).txt')
      })

      it('should return error if findAvailableFileName throws AppError', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'file.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'content'
        })
        mockedSanitizeFileName.mockReturnValue('file.txt')
        mockedFindAvailableFileName.mockRejectedValue(
          new AppError('Cannot create more than 1000 copies', ErrorCode.IMPORT_WRITE_FAILED)
        )

        const result = await service.importFile('/path/to/file.txt', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Cannot create more than 1000 copies')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_WRITE_FAILED)
      })

      it('should return error if findAvailableFileName throws generic error', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'file.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'content'
        })
        mockedSanitizeFileName.mockReturnValue('file.txt')
        mockedFindAvailableFileName.mockRejectedValue(new Error('Filesystem error'))

        const result = await service.importFile('/path/to/file.txt', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Filesystem error')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_WRITE_FAILED)
      })

      it('should handle non-Error thrown from findAvailableFileName', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'file.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'content'
        })
        mockedSanitizeFileName.mockReturnValue('file.txt')
        mockedFindAvailableFileName.mockRejectedValue('String error')

        const result = await service.importFile('/path/to/file.txt', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toBe('String error')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_WRITE_FAILED)
      })
    })

    describe('file writing', () => {
      it('should return error if writeFile fails', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'file.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'content'
        })
        mockedSanitizeFileName.mockReturnValue('file.txt')
        mockedFindAvailableFileName.mockResolvedValue('/project/root/import/file.txt')
        mockedWriteFile.mockRejectedValue(new Error('ENOSPC: no space left on device'))

        const result = await service.importFile('/path/to/file.txt', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Failed to write imported file')
        expect(result.error).toContain('ENOSPC')
        expect(result.errorCode).toBe(ErrorCode.IMPORT_WRITE_FAILED)
      })

      it('should handle non-Error thrown from writeFile', async () => {
        mockedGetExtension.mockReturnValue('txt')
        mockRegistry.getConverter.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'file.txt'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'content'
        })
        mockedSanitizeFileName.mockReturnValue('file.txt')
        mockedFindAvailableFileName.mockResolvedValue('/project/root/import/file.txt')
        mockedWriteFile.mockRejectedValue('Write error string')

        const result = await service.importFile('/path/to/file.txt', projectPath)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Write error string')
      })
    })

    describe('text-like file handling', () => {
      it('should use text converter for code files via mightBeTextFile', async () => {
        mockedGetExtension.mockReturnValue('js')
        mockRegistry.getConverter.mockReturnValue(undefined)
        mockRegistry.mightBeTextFile.mockReturnValue(true)
        mockRegistry.getConverterByCategory.mockReturnValue(textConverter)
        ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
          sizeInMB: 0.1,
          fileName: 'script.js'
        })
        ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          content: 'const x = 1;'
        })
        mockedSanitizeFileName.mockReturnValue('script.js')
        mockedFindAvailableFileName.mockResolvedValue('/project/root/import/script.js')

        const result = await service.importFile('/path/to/script.js', projectPath)

        expect(mockRegistry.getConverter).toHaveBeenCalledWith('js')
        expect(mockRegistry.mightBeTextFile).toHaveBeenCalledWith('js')
        expect(mockRegistry.getConverterByCategory).toHaveBeenCalledWith('text')
        expect(result.success).toBe(true)
        expect(result.outputPath).toBe('/project/root/import/script.js')
      })
    })
  })

  // ==========================================================================
  // importFile() with ImportOptions (IConfigurableConverter)
  // ==========================================================================

  describe('importFile with ImportOptions', () => {
    const projectPath = path.join('/project', 'root')

    // Build a configurable converter whose createConfigured returns a distinct
    // converter with its own convert mock so we can assert which one ran.
    let mockConfiguredConvert: ReturnType<typeof vi.fn>
    let mockCreateConfigured: ReturnType<typeof vi.fn>
    let configurableConverter: IConverter & { createConfigured: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      mockedMkdir.mockResolvedValue(undefined)
      mockedWriteFile.mockResolvedValue(undefined)
      mockedCp.mockResolvedValue(undefined)
      mockedRm.mockResolvedValue(undefined)

      mockConfiguredConvert = vi.fn().mockResolvedValue({
        success: true,
        content: 'configured result'
      })
      mockCreateConfigured = vi.fn().mockReturnValue({
        supportedExtensions: ['pdf'],
        requiresConversion: true,
        category: 'document',
        validate: vi.fn().mockResolvedValue({ valid: true, sizeInMB: 1, fileName: 'test.pdf' }),
        convert: mockConfiguredConvert
      })
      configurableConverter = {
        supportedExtensions: ['pdf'],
        requiresConversion: true,
        category: 'document',
        validate: vi.fn().mockResolvedValue({ valid: true, sizeInMB: 1, fileName: 'test.pdf' }),
        convert: vi.fn().mockResolvedValue({ success: true, content: 'base result' }),
        createConfigured: mockCreateConfigured
      }
    })

    it('should call createConfigured(options) when converter is configurable and options are provided', async () => {
      mockedGetExtension.mockReturnValue('pdf')
      mockRegistry.getConverter.mockReturnValue(configurableConverter)
      mockedSanitizeFileName.mockReturnValue('test.pdf')
      mockedChangeExtension.mockReturnValue('test.md')
      mockedFindAvailableFileName.mockResolvedValue('/project/root/import/test.md')

      const options: ImportOptions = { ocr: false, ocrLanguage: 'de' }
      await service.importFile('/path/to/test.pdf', projectPath, options)

      expect(mockCreateConfigured).toHaveBeenCalledWith(options)
    })

    it('should use the configured converter convert() instead of the base converter', async () => {
      mockedGetExtension.mockReturnValue('pdf')
      mockRegistry.getConverter.mockReturnValue(configurableConverter)
      mockedSanitizeFileName.mockReturnValue('test.pdf')
      mockedChangeExtension.mockReturnValue('test.md')
      mockedFindAvailableFileName.mockResolvedValue('/project/root/import/test.md')

      const options: ImportOptions = { ocr: true }
      const result = await service.importFile('/path/to/test.pdf', projectPath, options)

      // configured converter was used
      expect(mockConfiguredConvert).toHaveBeenCalledWith('/path/to/test.pdf')
      // base converter.convert should NOT have been called
      expect(configurableConverter.convert).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('should NOT call createConfigured when converter is not configurable', async () => {
      mockedGetExtension.mockReturnValue('txt')
      mockRegistry.getConverter.mockReturnValue(textConverter)
      ;(textConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
        sizeInMB: 0.1,
        fileName: 'notes.txt'
      })
      ;(textConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        content: 'text content'
      })
      mockedSanitizeFileName.mockReturnValue('notes.txt')
      mockedFindAvailableFileName.mockResolvedValue('/project/root/import/notes.txt')

      const options: ImportOptions = { ocr: false }
      const result = await service.importFile('/path/to/notes.txt', projectPath, options)

      // textConverter has no createConfigured – import should still succeed using base converter
      expect(result.success).toBe(true)
      expect(textConverter.convert).toHaveBeenCalledWith('/path/to/notes.txt')
    })

    it('should NOT call createConfigured when no options are provided even for configurable converter', async () => {
      mockedGetExtension.mockReturnValue('pdf')
      mockRegistry.getConverter.mockReturnValue(configurableConverter)
      mockedSanitizeFileName.mockReturnValue('test.pdf')
      mockedChangeExtension.mockReturnValue('test.md')
      mockedFindAvailableFileName.mockResolvedValue('/project/root/import/test.md')

      // No options argument
      await service.importFile('/path/to/test.pdf', projectPath)

      expect(mockCreateConfigured).not.toHaveBeenCalled()
      // Base converter.convert should have been used
      expect(configurableConverter.convert).toHaveBeenCalledWith('/path/to/test.pdf')
    })
  })

  // ==========================================================================
  // importFile() screenshot copy / cleanup
  // ==========================================================================

  describe('screenshot handling', () => {
    const projectPath = path.join('/project', 'root')

    function setupSuccessfulImport(screenshotDir?: string): void {
      mockedGetExtension.mockReturnValue('pdf')
      mockRegistry.getConverter.mockReturnValue(pdfConverter)
      ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
        sizeInMB: 1,
        fileName: 'doc.pdf'
      })
      ;(pdfConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        content: '# Content',
        ...(screenshotDir ? { screenshotDir } : {})
      })
      mockedSanitizeFileName.mockReturnValue('doc.pdf')
      mockedChangeExtension.mockReturnValue('doc.md')
      mockedFindAvailableFileName.mockResolvedValue('/project/root/import/doc.md')
    }

    beforeEach(() => {
      mockedMkdir.mockResolvedValue(undefined)
      mockedWriteFile.mockResolvedValue(undefined)
      mockedCp.mockResolvedValue(undefined)
      mockedRm.mockResolvedValue(undefined)
    })

    it('should copy screenshots and clean up temp dir on happy path', async () => {
      const screenshotDir = '/tmp/erfana-screenshots-abc123'
      setupSuccessfulImport(screenshotDir)

      const result = await service.importFile('/path/to/doc.pdf', projectPath)

      expect(result.success).toBe(true)
      expect(mockedCp).toHaveBeenCalledWith(
        screenshotDir,
        expect.stringContaining('screenshots'),
        { recursive: true }
      )
      expect(mockedRm).toHaveBeenCalledWith(screenshotDir, { recursive: true, force: true })
    })

    it('should still succeed and call rm for cleanup when cp fails', async () => {
      const screenshotDir = '/tmp/erfana-screenshots-abc123'
      setupSuccessfulImport(screenshotDir)
      mockedCp.mockRejectedValue(new Error('EACCES: permission denied'))

      const result = await service.importFile('/path/to/doc.pdf', projectPath)

      // Import succeeds even though screenshot copy failed
      expect(result.success).toBe(true)
      expect(result.outputPath).toBe('/project/root/import/doc.md')
      // Cleanup should still run
      expect(mockedRm).toHaveBeenCalledWith(screenshotDir, { recursive: true, force: true })
    })

    it('should still succeed when rm cleanup fails (silently swallowed)', async () => {
      const screenshotDir = '/tmp/erfana-screenshots-abc123'
      setupSuccessfulImport(screenshotDir)
      mockedRm.mockRejectedValue(new Error('EBUSY: resource busy'))

      const result = await service.importFile('/path/to/doc.pdf', projectPath)

      // rm failure is silently swallowed
      expect(result.success).toBe(true)
      expect(result.outputPath).toBe('/project/root/import/doc.md')
    })

    it('should not call cp or rm when conversion result has no screenshotDir', async () => {
      setupSuccessfulImport() // no screenshotDir

      await service.importFile('/path/to/doc.pdf', projectPath)

      expect(mockedCp).not.toHaveBeenCalled()
      expect(mockedRm).not.toHaveBeenCalled()
    })

    it('should call rm to clean up screenshotDir when writeFile throws', async () => {
      const screenshotDir = '/tmp/erfana-screenshots-abc123'
      setupSuccessfulImport(screenshotDir)
      mockedWriteFile.mockRejectedValue(new Error('ENOSPC: no space left on device'))

      const result = await service.importFile('/path/to/doc.pdf', projectPath)

      expect(result.success).toBe(false)
      expect(mockedRm).toHaveBeenCalledWith(screenshotDir, { recursive: true, force: true })
    })

    it('should clean up screenshotDir when conversion fails with partial result', async () => {
      const screenshotDir = '/tmp/erfana-screenshots-partial'
      mockedGetExtension.mockReturnValue('pdf')
      mockRegistry.getConverter.mockReturnValue(pdfConverter)
      ;(pdfConverter.validate as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
        sizeInMB: 1,
        fileName: 'doc.pdf'
      })
      ;(pdfConverter.convert as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Parse failed',
        errorCode: ErrorCode.IMPORT_CONVERSION_FAILED,
        screenshotDir
      })

      const result = await service.importFile('/path/to/doc.pdf', projectPath)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_CONVERSION_FAILED)
      expect(mockedRm).toHaveBeenCalledWith(screenshotDir, { recursive: true, force: true })
    })
  })

  // ==========================================================================
  // createImportService() factory
  // ==========================================================================

  describe('createImportService', () => {
    it('should create a new ImportService instance', () => {
      const service = createImportService(mockRegistry as never)
      expect(service).toBeInstanceOf(ImportService)
    })

    it('should use provided registry', () => {
      const customRegistry = createMockRegistry()
      customRegistry.getSupportedExtensions.mockReturnValue(['custom'])

      const service = createImportService(customRegistry as never)
      const extensions = service.getSupportedExtensions()

      expect(extensions).toEqual(['custom'])
    })

    it('should create service with default shared registry if not provided', () => {
      const service = createImportService()

      // Uses the shared converterRegistry singleton as default
      expect(service).toBeInstanceOf(ImportService)
    })
  })
})

// ============================================================================
// importService Singleton Tests (Integration with real registry)
// ============================================================================

describe('importService singleton', () => {
  // Reset mocks for integration tests
  beforeEach(() => {
    vi.clearAllMocks()
    // For singleton tests, let createConverterRegistry use real implementation
    mockedCreateConverterRegistry.mockImplementation(() => {
      // Return a mock that behaves like a real registry
      const registry = createMockRegistry(
        new Map([
          [
            'pdf',
            createMockConverter({
              extensions: ['pdf'],
              requiresConversion: true,
              category: 'document'
            })
          ],
          [
            'txt',
            createMockConverter({
              extensions: ['txt'],
              requiresConversion: false,
              category: 'text'
            })
          ]
        ])
      )
      return registry as never
    })
  })

  it('should export importService singleton', async () => {
    // Re-import to get the singleton
    const { importService } = await import('./ImportService')
    expect(importService).toBeDefined()
    expect(importService).toBeInstanceOf(ImportService)
  })
})

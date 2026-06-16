// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ConverterRegistry.test.ts
 *
 * Comprehensive tests for the ConverterRegistry class
 *
 * Test coverage:
 * - ConverterRegistry class methods
 *   - register() - adds converters, maps extensions
 *   - getConverter() - retrieves by extension, case insensitive
 *   - getConverterByCategory() - retrieves by category
 *   - isSupported() - checks extension support
 *   - getSupportedExtensions() - returns all extensions
 *   - getExtensionsByConversionType() - groups by conversion requirement
 *   - getCategories() - returns all categories
 *   - mightBeTextFile() - text file detection
 * - createConverterRegistry() - factory with built-in converters
 * - converterRegistry singleton - pre-configured instance
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ConverterRegistry,
  createConverterRegistry,
  converterRegistry
} from './ConverterRegistry'
import type { IConverter, FileTypeCategory, ValidationResult, ConversionResult } from './types'
import { TEXT_EXTENSIONS, CODE_EXTENSIONS } from './extensions'
import { LiteParseConverter } from './converters/LiteParseConverter'
import { logger } from '../LoggingService'

// ============================================================================
// Mock Converters for Isolated Testing
// ============================================================================

/**
 * Creates a mock converter for testing
 */
function createMockConverter(options: {
  extensions: string[]
  requiresConversion: boolean
  category: FileTypeCategory
}): IConverter {
  return {
    supportedExtensions: options.extensions,
    requiresConversion: options.requiresConversion,
    category: options.category,
    validate: async (): Promise<ValidationResult> => ({
      valid: true,
      sizeInMB: 1,
      fileName: 'test.txt'
    }),
    convert: async (): Promise<ConversionResult> => ({
      success: true,
      content: 'test content'
    })
  }
}

// ============================================================================
// ConverterRegistry Tests
// ============================================================================

describe('ConverterRegistry', () => {
  let registry: ConverterRegistry

  beforeEach(() => {
    registry = new ConverterRegistry()
  })

  // --------------------------------------------------------------------------
  // register()
  // --------------------------------------------------------------------------

  describe('register', () => {
    it('should register a converter by category', () => {
      const converter = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })

      registry.register(converter)

      expect(registry.getConverterByCategory('document')).toBe(converter)
    })

    it('should map all supported extensions to the converter', () => {
      const converter = createMockConverter({
        extensions: ['txt', 'text', 'md'],
        requiresConversion: false,
        category: 'text'
      })

      registry.register(converter)

      expect(registry.getConverter('txt')).toBe(converter)
      expect(registry.getConverter('text')).toBe(converter)
      expect(registry.getConverter('md')).toBe(converter)
    })

    it('should normalize extensions to lowercase when registering', () => {
      const converter = createMockConverter({
        extensions: ['PDF', 'DOC'],
        requiresConversion: true,
        category: 'document'
      })

      registry.register(converter)

      expect(registry.getConverter('pdf')).toBe(converter)
      expect(registry.getConverter('doc')).toBe(converter)
    })

    it('should allow registering multiple converters', () => {
      const docConverter = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })
      const textConverter = createMockConverter({
        extensions: ['txt', 'md'],
        requiresConversion: false,
        category: 'text'
      })

      registry.register(docConverter)
      registry.register(textConverter)

      expect(registry.getConverter('pdf')).toBe(docConverter)
      expect(registry.getConverter('txt')).toBe(textConverter)
      expect(registry.getConverterByCategory('document')).toBe(docConverter)
      expect(registry.getConverterByCategory('text')).toBe(textConverter)
    })

    it('should override converter if same category is registered again', () => {
      const converter1 = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })
      const converter2 = createMockConverter({
        extensions: ['docx'],
        requiresConversion: true,
        category: 'document'
      })

      registry.register(converter1)
      registry.register(converter2)

      expect(registry.getConverterByCategory('document')).toBe(converter2)
    })

    it('should override extension mapping if same extension is registered again', () => {
      const converter1 = createMockConverter({
        extensions: ['md'],
        requiresConversion: false,
        category: 'text'
      })
      const converter2 = createMockConverter({
        extensions: ['md'],
        requiresConversion: true,
        category: 'document'
      })

      registry.register(converter1)
      registry.register(converter2)

      expect(registry.getConverter('md')).toBe(converter2)
    })
  })

  // --------------------------------------------------------------------------
  // getConverter()
  // --------------------------------------------------------------------------

  describe('getConverter', () => {
    beforeEach(() => {
      const converter = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })
      registry.register(converter)
    })

    it('should return converter for registered extension', () => {
      const converter = registry.getConverter('pdf')
      expect(converter).toBeDefined()
      expect(converter?.category).toBe('document')
    })

    it('should return undefined for unregistered extension', () => {
      expect(registry.getConverter('xyz')).toBeUndefined()
      expect(registry.getConverter('unknown')).toBeUndefined()
    })

    describe('case insensitivity', () => {
      it('should handle lowercase extension', () => {
        expect(registry.getConverter('pdf')).toBeDefined()
      })

      it('should handle uppercase extension', () => {
        expect(registry.getConverter('PDF')).toBeDefined()
      })

      it('should handle mixed case extension', () => {
        expect(registry.getConverter('Pdf')).toBeDefined()
        expect(registry.getConverter('pDf')).toBeDefined()
      })
    })

    describe('dot handling', () => {
      it('should handle extension without leading dot', () => {
        expect(registry.getConverter('pdf')).toBeDefined()
      })

      it('should handle extension with leading dot', () => {
        expect(registry.getConverter('.pdf')).toBeDefined()
      })

      it('should handle extension with dot and uppercase', () => {
        expect(registry.getConverter('.PDF')).toBeDefined()
        expect(registry.getConverter('.Pdf')).toBeDefined()
      })
    })

    it('should handle empty string', () => {
      expect(registry.getConverter('')).toBeUndefined()
    })

    it('should handle dot-only string', () => {
      expect(registry.getConverter('.')).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // getConverterByCategory()
  // --------------------------------------------------------------------------

  describe('getConverterByCategory', () => {
    it('should return converter for registered category', () => {
      const converter = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })
      registry.register(converter)

      expect(registry.getConverterByCategory('document')).toBe(converter)
    })

    it('should return undefined for unregistered category', () => {
      expect(registry.getConverterByCategory('document')).toBeUndefined()
      expect(registry.getConverterByCategory('audio')).toBeUndefined()
      expect(registry.getConverterByCategory('video')).toBeUndefined()
    })

    it('should return correct converter when multiple categories registered', () => {
      const docConverter = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })
      const textConverter = createMockConverter({
        extensions: ['txt'],
        requiresConversion: false,
        category: 'text'
      })

      registry.register(docConverter)
      registry.register(textConverter)

      expect(registry.getConverterByCategory('document')).toBe(docConverter)
      expect(registry.getConverterByCategory('text')).toBe(textConverter)
      expect(registry.getConverterByCategory('audio')).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // isSupported()
  // --------------------------------------------------------------------------

  describe('isSupported', () => {
    beforeEach(() => {
      const converter = createMockConverter({
        extensions: ['pdf', 'txt', 'md'],
        requiresConversion: false,
        category: 'text'
      })
      registry.register(converter)
    })

    it('should return true for registered extensions', () => {
      expect(registry.isSupported('pdf')).toBe(true)
      expect(registry.isSupported('txt')).toBe(true)
      expect(registry.isSupported('md')).toBe(true)
    })

    it('should return false for unregistered extensions', () => {
      expect(registry.isSupported('xyz')).toBe(false)
      expect(registry.isSupported('unknown')).toBe(false)
      expect(registry.isSupported('docx')).toBe(false)
    })

    it('should be case insensitive', () => {
      expect(registry.isSupported('PDF')).toBe(true)
      expect(registry.isSupported('Pdf')).toBe(true)
      expect(registry.isSupported('TXT')).toBe(true)
    })

    it('should handle extension with leading dot', () => {
      expect(registry.isSupported('.pdf')).toBe(true)
      expect(registry.isSupported('.txt')).toBe(true)
      expect(registry.isSupported('.xyz')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(registry.isSupported('')).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // getSupportedExtensions()
  // --------------------------------------------------------------------------

  describe('getSupportedExtensions', () => {
    it('should return empty array when no converters registered', () => {
      expect(registry.getSupportedExtensions()).toEqual([])
    })

    it('should return all registered extensions', () => {
      const converter = createMockConverter({
        extensions: ['pdf', 'txt', 'md'],
        requiresConversion: false,
        category: 'text'
      })
      registry.register(converter)

      const extensions = registry.getSupportedExtensions()
      expect(extensions).toContain('pdf')
      expect(extensions).toContain('txt')
      expect(extensions).toContain('md')
      expect(extensions).toHaveLength(3)
    })

    it('should return extensions in lowercase', () => {
      const converter = createMockConverter({
        extensions: ['PDF', 'TXT'],
        requiresConversion: false,
        category: 'text'
      })
      registry.register(converter)

      const extensions = registry.getSupportedExtensions()
      expect(extensions).toContain('pdf')
      expect(extensions).toContain('txt')
      expect(extensions).not.toContain('PDF')
      expect(extensions).not.toContain('TXT')
    })

    it('should return extensions from multiple converters', () => {
      const docConverter = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })
      const textConverter = createMockConverter({
        extensions: ['txt', 'md'],
        requiresConversion: false,
        category: 'text'
      })

      registry.register(docConverter)
      registry.register(textConverter)

      const extensions = registry.getSupportedExtensions()
      expect(extensions).toContain('pdf')
      expect(extensions).toContain('txt')
      expect(extensions).toContain('md')
      expect(extensions).toHaveLength(3)
    })
  })

  // --------------------------------------------------------------------------
  // getExtensionsByConversionType()
  // --------------------------------------------------------------------------

  describe('getExtensionsByConversionType', () => {
    it('should return empty arrays when no converters registered', () => {
      const result = registry.getExtensionsByConversionType()
      expect(result.requiresConversion).toEqual([])
      expect(result.passthrough).toEqual([])
    })

    it('should separate extensions by requiresConversion flag', () => {
      const docConverter = createMockConverter({
        extensions: ['pdf', 'docx'],
        requiresConversion: true,
        category: 'document'
      })
      const textConverter = createMockConverter({
        extensions: ['txt', 'md'],
        requiresConversion: false,
        category: 'text'
      })

      registry.register(docConverter)
      registry.register(textConverter)

      const result = registry.getExtensionsByConversionType()

      expect(result.requiresConversion).toContain('pdf')
      expect(result.requiresConversion).toContain('docx')
      expect(result.passthrough).toContain('txt')
      expect(result.passthrough).toContain('md')
    })

    it('should return only requiresConversion extensions when all require conversion', () => {
      const converter = createMockConverter({
        extensions: ['pdf', 'docx'],
        requiresConversion: true,
        category: 'document'
      })
      registry.register(converter)

      const result = registry.getExtensionsByConversionType()

      expect(result.requiresConversion).toHaveLength(2)
      expect(result.passthrough).toHaveLength(0)
    })

    it('should return only passthrough extensions when none require conversion', () => {
      const converter = createMockConverter({
        extensions: ['txt', 'md', 'json'],
        requiresConversion: false,
        category: 'text'
      })
      registry.register(converter)

      const result = registry.getExtensionsByConversionType()

      expect(result.requiresConversion).toHaveLength(0)
      expect(result.passthrough).toHaveLength(3)
    })
  })

  // --------------------------------------------------------------------------
  // getCategories()
  // --------------------------------------------------------------------------

  describe('getCategories', () => {
    it('should return empty array when no converters registered', () => {
      expect(registry.getCategories()).toEqual([])
    })

    it('should return single category when one converter registered', () => {
      const converter = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })
      registry.register(converter)

      expect(registry.getCategories()).toEqual(['document'])
    })

    it('should return all registered categories', () => {
      const docConverter = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })
      const textConverter = createMockConverter({
        extensions: ['txt'],
        requiresConversion: false,
        category: 'text'
      })
      const audioConverter = createMockConverter({
        extensions: ['mp3'],
        requiresConversion: true,
        category: 'audio'
      })

      registry.register(docConverter)
      registry.register(textConverter)
      registry.register(audioConverter)

      const categories = registry.getCategories()
      expect(categories).toContain('document')
      expect(categories).toContain('text')
      expect(categories).toContain('audio')
      expect(categories).toHaveLength(3)
    })

    it('should not have duplicate categories', () => {
      const converter1 = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })
      const converter2 = createMockConverter({
        extensions: ['docx'],
        requiresConversion: true,
        category: 'document'
      })

      registry.register(converter1)
      registry.register(converter2)

      expect(registry.getCategories()).toEqual(['document'])
    })
  })

  // --------------------------------------------------------------------------
  // mightBeTextFile()
  // --------------------------------------------------------------------------

  describe('mightBeTextFile', () => {
    beforeEach(() => {
      // Register a text converter
      const textConverter = createMockConverter({
        extensions: ['txt', 'md', 'json'],
        requiresConversion: false,
        category: 'text'
      })
      // Register a document converter
      const docConverter = createMockConverter({
        extensions: ['pdf'],
        requiresConversion: true,
        category: 'document'
      })

      registry.register(textConverter)
      registry.register(docConverter)
    })

    describe('explicitly registered text extensions', () => {
      it('should return true for registered text category extensions', () => {
        expect(registry.mightBeTextFile('txt')).toBe(true)
        expect(registry.mightBeTextFile('md')).toBe(true)
        expect(registry.mightBeTextFile('json')).toBe(true)
      })

      it('should be case insensitive', () => {
        expect(registry.mightBeTextFile('TXT')).toBe(true)
        expect(registry.mightBeTextFile('MD')).toBe(true)
        expect(registry.mightBeTextFile('Json')).toBe(true)
      })

      it('should handle leading dot', () => {
        expect(registry.mightBeTextFile('.txt')).toBe(true)
        expect(registry.mightBeTextFile('.md')).toBe(true)
      })
    })

    describe('document category extensions', () => {
      it('should return false for document category extensions', () => {
        expect(registry.mightBeTextFile('pdf')).toBe(false)
      })

      it('should return false for document extensions regardless of case', () => {
        expect(registry.mightBeTextFile('PDF')).toBe(false)
        expect(registry.mightBeTextFile('.pdf')).toBe(false)
      })
    })

    describe('CODE_EXTENSIONS fallback', () => {
      it('should return true for code extensions not explicitly registered', () => {
        // These are in CODE_EXTENSIONS but not registered in our test registry
        expect(registry.mightBeTextFile('js')).toBe(true)
        expect(registry.mightBeTextFile('ts')).toBe(true)
        expect(registry.mightBeTextFile('py')).toBe(true)
        expect(registry.mightBeTextFile('java')).toBe(true)
        expect(registry.mightBeTextFile('go')).toBe(true)
        expect(registry.mightBeTextFile('rs')).toBe(true)
      })

      it('should handle code extensions with leading dot', () => {
        expect(registry.mightBeTextFile('.js')).toBe(true)
        expect(registry.mightBeTextFile('.ts')).toBe(true)
      })

      it('should handle code extensions case insensitively', () => {
        expect(registry.mightBeTextFile('JS')).toBe(true)
        expect(registry.mightBeTextFile('TS')).toBe(true)
        expect(registry.mightBeTextFile('Py')).toBe(true)
      })
    })

    describe('unknown extensions', () => {
      it('should return false for unknown extensions', () => {
        expect(registry.mightBeTextFile('xyz')).toBe(false)
        expect(registry.mightBeTextFile('unknown')).toBe(false)
        expect(registry.mightBeTextFile('abc123')).toBe(false)
      })

      it('should return false for binary file extensions', () => {
        expect(registry.mightBeTextFile('exe')).toBe(false)
        expect(registry.mightBeTextFile('dll')).toBe(false)
        expect(registry.mightBeTextFile('bin')).toBe(false)
        expect(registry.mightBeTextFile('jpg')).toBe(false)
        expect(registry.mightBeTextFile('png')).toBe(false)
        expect(registry.mightBeTextFile('mp3')).toBe(false)
        expect(registry.mightBeTextFile('mp4')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(registry.mightBeTextFile('')).toBe(false)
      })
    })
  })
})

// ============================================================================
// createConverterRegistry() Factory Tests
// ============================================================================

describe('createConverterRegistry', () => {
  it('should create a new ConverterRegistry instance', () => {
    const registry = createConverterRegistry()
    expect(registry).toBeInstanceOf(ConverterRegistry)
  })

  it('should register built-in PDF converter', () => {
    const registry = createConverterRegistry()
    const converter = registry.getConverter('pdf')

    expect(converter).toBeDefined()
    expect(converter?.category).toBe('document')
    expect(converter?.requiresConversion).toBe(true)
    expect(converter?.supportedExtensions).toContain('pdf')
  })

  it('should register built-in text converter', () => {
    const registry = createConverterRegistry()
    const converter = registry.getConverter('txt')

    expect(converter).toBeDefined()
    expect(converter?.category).toBe('text')
    expect(converter?.requiresConversion).toBe(false)
  })

  it('should support all TEXT_EXTENSIONS through text converter', () => {
    const registry = createConverterRegistry()

    for (const ext of TEXT_EXTENSIONS) {
      const converter = registry.getConverter(ext)
      expect(converter, `Extension '${ext}' should be supported`).toBeDefined()
      expect(converter?.category).toBe('text')
    }
  })

  it('should return document and text categories', () => {
    const registry = createConverterRegistry()
    const categories = registry.getCategories()

    expect(categories).toContain('document')
    expect(categories).toContain('text')
  })

  it('should register LiteParseConverter as the document converter', () => {
    const registry = createConverterRegistry()
    const converter = registry.getConverterByCategory('document')

    expect(converter).toBeDefined()
    expect(converter).toBeInstanceOf(LiteParseConverter)
  })

  it('should create independent registry instances', () => {
    const registry1 = createConverterRegistry()
    const registry2 = createConverterRegistry()

    expect(registry1).not.toBe(registry2)

    // Register custom converter in registry1 only
    const customConverter = createMockConverter({
      extensions: ['custom'],
      requiresConversion: true,
      category: 'audio'
    })
    registry1.register(customConverter)

    expect(registry1.isSupported('custom')).toBe(true)
    expect(registry2.isSupported('custom')).toBe(false)
  })
})

// ============================================================================
// converterRegistry Singleton Tests
// ============================================================================

describe('converterRegistry singleton', () => {
  it('should be an instance of ConverterRegistry', () => {
    expect(converterRegistry).toBeInstanceOf(ConverterRegistry)
  })

  it('should have PDF converter registered', () => {
    const converter = converterRegistry.getConverter('pdf')
    expect(converter).toBeDefined()
    expect(converter?.category).toBe('document')
    expect(converter?.requiresConversion).toBe(true)
  })

  it('should have text converter registered', () => {
    const converter = converterRegistry.getConverter('txt')
    expect(converter).toBeDefined()
    expect(converter?.category).toBe('text')
    expect(converter?.requiresConversion).toBe(false)
  })

  it('should support markdown extensions', () => {
    expect(converterRegistry.isSupported('md')).toBe(true)
    expect(converterRegistry.isSupported('markdown')).toBe(true)
    expect(converterRegistry.isSupported('mdown')).toBe(true)
  })

  it('should support data format extensions', () => {
    expect(converterRegistry.isSupported('json')).toBe(true)
    expect(converterRegistry.isSupported('yaml')).toBe(true)
    expect(converterRegistry.isSupported('yml')).toBe(true)
    expect(converterRegistry.isSupported('xml')).toBe(true)
    expect(converterRegistry.isSupported('csv')).toBe(true)
  })

  it('should correctly classify PDF as requiring conversion', () => {
    const result = converterRegistry.getExtensionsByConversionType()
    expect(result.requiresConversion).toContain('pdf')
  })

  it('should correctly classify text files as passthrough', () => {
    const result = converterRegistry.getExtensionsByConversionType()
    expect(result.passthrough).toContain('txt')
    expect(result.passthrough).toContain('md')
    expect(result.passthrough).toContain('json')
  })

  it('should detect text files via mightBeTextFile', () => {
    // Registered text extensions
    expect(converterRegistry.mightBeTextFile('txt')).toBe(true)
    expect(converterRegistry.mightBeTextFile('md')).toBe(true)
    expect(converterRegistry.mightBeTextFile('json')).toBe(true)

    // CODE_EXTENSIONS fallback
    expect(converterRegistry.mightBeTextFile('js')).toBe(true)
    expect(converterRegistry.mightBeTextFile('ts')).toBe(true)
    expect(converterRegistry.mightBeTextFile('py')).toBe(true)

    // Document category (not text)
    expect(converterRegistry.mightBeTextFile('pdf')).toBe(false)

    // Unknown
    expect(converterRegistry.mightBeTextFile('exe')).toBe(false)
  })

  it('should include all TEXT_EXTENSIONS in getSupportedExtensions', () => {
    const extensions = converterRegistry.getSupportedExtensions()

    for (const ext of TEXT_EXTENSIONS) {
      expect(extensions, `TEXT_EXTENSIONS '${ext}' should be in supported extensions`).toContain(
        ext
      )
    }
  })

  it('should handle CODE_EXTENSIONS via mightBeTextFile even though not registered', () => {
    // CODE_EXTENSIONS are not directly registered but should be detected as text-like
    for (const ext of CODE_EXTENSIONS) {
      expect(
        converterRegistry.mightBeTextFile(ext),
        `CODE_EXTENSION '${ext}' should be detected as potential text file`
      ).toBe(true)
    }
  })
})

// ============================================================================
// updateConverterExtensions() Tests
// ============================================================================

describe('updateConverterExtensions', () => {
  let registry: ConverterRegistry

  beforeEach(() => {
    registry = new ConverterRegistry()
  })

  it('should add extensions to an existing converter by category', () => {
    const docConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })
    registry.register(docConverter)

    registry.updateConverterExtensions('document', ['doc', 'docx'])

    expect(registry.getConverter('doc')).toBe(docConverter)
    expect(registry.getConverter('docx')).toBe(docConverter)
  })

  it('should skip csv extensions silently', () => {
    const docConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })
    registry.register(docConverter)

    registry.updateConverterExtensions('document', ['csv', 'docx'])

    expect(registry.getConverter('csv')).toBeUndefined()
    expect(registry.getConverter('docx')).toBe(docConverter)
  })

  it('should skip tsv extensions silently', () => {
    const docConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })
    registry.register(docConverter)

    registry.updateConverterExtensions('document', ['tsv', 'doc'])

    expect(registry.getConverter('tsv')).toBeUndefined()
    expect(registry.getConverter('doc')).toBe(docConverter)
  })

  it('should skip svg extensions silently', () => {
    const docConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })
    registry.register(docConverter)

    registry.updateConverterExtensions('document', ['svg', 'png'])

    expect(registry.getConverter('svg')).toBeUndefined()
  })

  it('should be a no-op when category does not exist', () => {
    registry.updateConverterExtensions('document', ['doc', 'docx'])

    // No converter registered – extensions should not be mapped
    expect(registry.getConverter('doc')).toBeUndefined()
    expect(registry.getConverter('docx')).toBeUndefined()
  })

  it('should reflect new additions in getSupportedExtensions()', () => {
    const docConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })
    registry.register(docConverter)

    registry.updateConverterExtensions('document', ['doc', 'docx'])

    const exts = registry.getSupportedExtensions()
    expect(exts).toContain('pdf')
    expect(exts).toContain('doc')
    expect(exts).toContain('docx')
  })

  it('should return the correct converter for newly added extensions via getConverter()', () => {
    const docConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })
    registry.register(docConverter)

    registry.updateConverterExtensions('document', ['jpg', 'png'])

    expect(registry.getConverter('jpg')).toBe(docConverter)
    expect(registry.getConverter('png')).toBe(docConverter)
  })

  it('should overwrite existing extension mapping from another converter', () => {
    const textConverter = createMockConverter({
      extensions: ['rtf'],
      requiresConversion: false,
      category: 'text'
    })
    const docConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })

    registry.register(textConverter)
    registry.register(docConverter)

    // Confirm rtf is mapped to textConverter initially
    expect(registry.getConverter('rtf')).toBe(textConverter)

    // Reassign rtf to docConverter
    registry.updateConverterExtensions('document', ['rtf'])

    expect(registry.getConverter('rtf')).toBe(docConverter)
  })

  it('should normalize extensions to lowercase when updating', () => {
    const docConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })
    registry.register(docConverter)

    registry.updateConverterExtensions('document', ['DOC', 'DOCX'])

    expect(registry.getConverter('doc')).toBe(docConverter)
    expect(registry.getConverter('docx')).toBe(docConverter)
  })

  it('should handle empty extensions array without error', () => {
    const docConverter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })
    registry.register(docConverter)

    expect(() => registry.updateConverterExtensions('document', [])).not.toThrow()

    const exts = registry.getSupportedExtensions()
    expect(exts).toEqual(['pdf'])
  })

  it('should not log when remapping extension to the same converter', () => {
    const converter = createMockConverter({
      extensions: ['pdf'],
      requiresConversion: true,
      category: 'document'
    })
    registry.register(converter)

    const loggerSpy = vi.spyOn(logger, 'info')

    // Remap 'pdf' to the same converter – should NOT log since existing === converter
    registry.updateConverterExtensions('document', ['pdf'])

    expect(loggerSpy).not.toHaveBeenCalled()
    loggerSpy.mockRestore()
  })
})

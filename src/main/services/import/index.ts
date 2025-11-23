/**
 * Import System - Public API
 *
 * Unified import system for converting and importing various file types
 * into Erfana projects.
 *
 * Architecture:
 * - Strategy Pattern: IConverter interface with type-specific implementations
 * - Registry Pattern: ConverterRegistry maps extensions to converters
 * - Factory Pattern: createConverterRegistry, createImportService
 *
 * Usage:
 *   import { importService, converterRegistry } from './import'
 *
 *   // Check if file type is supported
 *   if (converterRegistry.isSupported('pdf')) { ... }
 *
 *   // Import a file
 *   const result = await importService.importFile(filePath, projectPath)
 */

// Types
export type {
  IConverter,
  ValidationResult,
  ConversionResult,
  ImportResult,
  FileTypeCategory
} from './types'

// Registry
export { ConverterRegistry, createConverterRegistry, converterRegistry } from './ConverterRegistry'

// Converters
export { PdfConverter, createPdfConverter } from './converters/PdfConverter'
export { TextConverter, createTextConverter } from './converters/TextConverter'

// Extensions
export {
  TEXT_EXTENSIONS,
  CODE_EXTENSIONS,
  ALL_TEXT_LIKE_EXTENSIONS,
  isTextExtension,
  isCodeExtension,
  isTextLikeExtension
} from './extensions'

// Main service
export { ImportService, createImportService, importService } from './ImportService'

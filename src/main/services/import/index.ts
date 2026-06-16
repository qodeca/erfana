// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
  IConfigurableConverter,
  ValidationResult,
  ConversionResult,
  ImportResult,
  ImportOptions,
  FileTypeCategory,
  DependencyStatus
} from './types'
export { isConfigurableConverter } from './types'

// Registry
export { ConverterRegistry, createConverterRegistry, converterRegistry } from './ConverterRegistry'

// Dependency detection
export { DependencyDetector } from './DependencyDetector'

// Language mapping
export { isoToTessLang } from './isoToTessLang'

// Converters
export { LiteParseConverter, getExtensionsForDependencies, createLiteParseConverter } from './converters/LiteParseConverter'
export { TextConverter, createTextConverter } from './converters/TextConverter'
export { AudioConverter, createAudioConverter } from './converters/AudioConverter'
export { VideoConverter, createVideoConverter } from './converters/VideoConverter'

// Extensions
export {
  TEXT_EXTENSIONS,
  CODE_EXTENSIONS,
  ALL_TEXT_LIKE_EXTENSIONS,
  isTextExtension,
  isCodeExtension,
  isTextLikeExtension,
  VIDEO_EXTENSIONS,
  isVideoExtension,
  LITEPARSE_EXCLUDED_EXTENSIONS
} from './extensions'

// Main service
export { ImportService, createImportService, importService } from './ImportService'

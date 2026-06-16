// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Import System Types
 *
 * Shared types for the unified import system.
 * All converters implement the IConverter interface.
 */

import { ErrorCode } from '../../../shared/errors'
import type { TranscriptionResult } from '../../../shared/ipc/transcription-schema'

/**
 * Result of file validation before import
 */
export interface ValidationResult {
  /** Whether the file is valid for import */
  valid: boolean
  /** Error code if validation failed or has warnings */
  error?: ErrorCode
  /** File size in megabytes */
  sizeInMB: number
  /** Original filename */
  fileName: string
}

/**
 * Result of file conversion/import
 */
export interface ConversionResult {
  /** Whether the conversion succeeded */
  success: boolean
  /** Converted content (markdown or text) */
  content?: string
  /** Error message if conversion failed */
  error?: string
  /** Structured error code for categorization */
  errorCode?: ErrorCode
  /** Directory containing page screenshots (PNG files), if screenshots were requested */
  screenshotDir?: string
}

/**
 * Result of the full import operation (including file writing)
 */
export interface ImportResult {
  /** Whether the import succeeded */
  success: boolean
  /** Path to the imported file */
  outputPath?: string
  /** Error message if import failed */
  error?: string
  /** Structured error code for categorization */
  errorCode?: ErrorCode
}

/**
 * Options for document import via LiteParseConverter
 *
 * These options configure OCR, screenshots, and DPI for document imports.
 * Used by ImportService when the converter supports configuration via
 * the IConfigurableConverter interface.
 */
export interface ImportOptions {
  /** Enable OCR text recognition (default: true) */
  ocr?: boolean
  /** OCR language code in ISO 639-1 format (e.g., 'en', 'de') – mapped to ISO 639-3 internally */
  ocrLanguage?: string
  /** Generate page screenshots as PNG files (default: false) */
  screenshots?: boolean
  /** Screenshot DPI resolution (default: 150) */
  dpi?: number
}

/**
 * File type category for grouping similar file types
 */
export type FileTypeCategory = 'document' | 'text' | 'audio' | 'video'

/** Interface for TranscriptionService dependency (used by audio/video converters) */
export interface ITranscriptionServiceLike {
  transcribe(
    filePath: string,
    language: 'auto' | string,
    onProgress: (progress: { percent: number; phase: string }) => void,
    signal?: AbortSignal
  ): Promise<TranscriptionResult>
}

/**
 * Converter interface - Strategy Pattern
 *
 * Each converter implements this interface to handle a specific
 * category of files (PDF, text, audio, video, etc.)
 *
 * SOLID Principles:
 * - Single Responsibility: Each converter handles one file category
 * - Open/Closed: New converters can be added without modifying ImportService
 * - Liskov Substitution: All converters are interchangeable via this interface
 * - Interface Segregation: Minimal interface with essential methods only
 * - Dependency Inversion: ImportService depends on IConverter abstraction
 */
export interface IConverter {
  /**
   * File extensions this converter handles (lowercase, without dot)
   * Example: ['pdf'] for LiteParseConverter, ['txt', 'md', 'json'] for TextConverter
   */
  readonly supportedExtensions: string[]

  /**
   * Whether this converter transforms the content
   *
   * - true: Content is converted (e.g., PDF → Markdown, Audio → Transcript)
   * - false: Content is imported as-is (e.g., .txt, .md, .json files)
   *
   * This affects how the output file extension is determined:
   * - requiresConversion=true: output gets .md extension
   * - requiresConversion=false: output keeps original extension
   */
  readonly requiresConversion: boolean

  /**
   * Human-readable category for this converter
   */
  readonly category: FileTypeCategory

  /**
   * Validate a file before conversion
   *
   * Should check:
   * - File exists and is readable
   * - File size (return warning for large files)
   * - File format validity (if determinable without full conversion)
   *
   * @param filePath - Absolute path to the file
   * @returns Validation result with file info
   */
  validate(filePath: string): Promise<ValidationResult>

  /**
   * Convert/read the file content
   *
   * For converters with requiresConversion=true:
   * - Transform content to Markdown format
   *
   * For converters with requiresConversion=false:
   * - Read content as-is (text files)
   *
   * @param filePath - Absolute path to the file
   * @returns Conversion result with content or error
   */
  convert(filePath: string): Promise<ConversionResult>
}

/**
 * Extended converter interface for converters that support per-import configuration.
 *
 * Converters implementing this interface can produce a configured instance
 * with specific import options, while keeping the base IConverter.convert()
 * signature unchanged.
 *
 * Used by ImportService to detect configurable converters via type guard
 * instead of instanceof checks (OCP compliance).
 */
export interface IConfigurableConverter extends IConverter {
  /**
   * Create a new converter instance configured with the given options.
   * The returned instance should be used for a single import operation.
   *
   * @param options - Import configuration options
   * @returns A new converter instance with options baked in
   */
  createConfigured(options: ImportOptions): IConverter
}

/**
 * Type guard for IConfigurableConverter
 *
 * @param converter - Converter to check
 * @returns true if the converter supports createConfigured()
 */
export function isConfigurableConverter(
  converter: IConverter
): converter is IConfigurableConverter {
  return 'createConfigured' in converter && typeof (converter as IConfigurableConverter).createConfigured === 'function'
}

/**
 * Runtime dependency detection result
 *
 * Indicates which optional system tools are available for document conversion.
 * LibreOffice enables Office format support; ImageMagick enables image OCR.
 */
export interface DependencyStatus {
  /** Whether LibreOffice (soffice) is available */
  libreOffice: boolean
  /** Whether ImageMagick (magick/convert) is available */
  imageMagick: boolean
}

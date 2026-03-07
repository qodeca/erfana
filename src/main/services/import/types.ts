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
   * Example: ['pdf'] for PdfConverter, ['txt', 'md', 'json'] for TextConverter
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

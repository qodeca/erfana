// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { writeFile, mkdir, cp, rm } from 'fs/promises'
import { join, basename, parse as parsePath } from 'path'
import { IMPORT } from '../../../shared/constants'
import { ErrorCode, AppError } from '../../../shared/errors'
import {
  sanitizeFileName,
  findAvailableFileName,
  getExtension,
  changeExtension
} from '../../utils/fileUtils'
import { ConverterRegistry, converterRegistry as sharedRegistry } from './ConverterRegistry'
import type { ValidationResult, ImportResult, IConverter, ImportOptions } from './types'
import { isConfigurableConverter } from './types'

/**
 * Import Service
 *
 * Unified service for importing files of various types into Erfana projects.
 * Uses the Strategy Pattern via ConverterRegistry to handle different file types.
 *
 * Workflow:
 * 1. Get converter for file extension from registry
 * 2. Validate file using converter
 * 3. Convert file content (if converter.requiresConversion)
 * 4. Write to project's import/ directory
 * 5. Return result with output path
 *
 * The import/ directory is auto-created if it doesn't exist.
 * Filename conflicts are resolved by auto-incrementing (file.md, file (1).md, etc.)
 */
export class ImportService {
  constructor(private registry: ConverterRegistry = sharedRegistry) {}

  /**
   * Get converter for a file
   *
   * @param filePath - Path to the file
   * @returns Converter or undefined if not supported
   */
  getConverter(filePath: string): IConverter | undefined {
    const ext = getExtension(filePath)
    return this.registry.getConverter(ext)
  }

  /**
   * Check if a file type is supported for import
   *
   * @param filePath - Path to the file (or just extension)
   * @returns true if the file type can be imported
   */
  isSupported(filePath: string): boolean {
    const ext = getExtension(filePath)
    return this.registry.isSupported(ext) || this.registry.mightBeTextFile(ext)
  }

  /**
   * Get all supported file extensions
   *
   * @returns Array of extensions (lowercase, without dot)
   */
  getSupportedExtensions(): string[] {
    return this.registry.getSupportedExtensions()
  }

  /**
   * Validate a file before import
   *
   * @param filePath - Absolute path to the file
   * @returns Validation result with file info and any warnings
   */
  async validate(filePath: string): Promise<ValidationResult> {
    const ext = getExtension(filePath)
    let converter = this.registry.getConverter(ext)

    // If extension not explicitly supported, try text converter for text-like files
    if (!converter && this.registry.mightBeTextFile(ext)) {
      converter = this.registry.getConverterByCategory('text')
    }

    if (!converter) {
      return {
        valid: false,
        error: ErrorCode.IMPORT_UNSUPPORTED_TYPE,
        sizeInMB: 0,
        fileName: basename(filePath)
      }
    }

    return converter.validate(filePath)
  }

  /**
   * Import a file into a project
   *
   * Full import workflow:
   * 1. Get appropriate converter
   * 2. Validate file
   * 3. Convert content (or read as-is)
   * 4. Create import directory
   * 5. Write to import directory with conflict resolution
   *
   * @param filePath - Absolute path to the source file
   * @param projectPath - Absolute path to the project root
   * @returns Import result with output path or error
   */
  async importFile(filePath: string, projectPath: string, options?: ImportOptions): Promise<ImportResult> {
    const ext = getExtension(filePath)
    let converter = this.registry.getConverter(ext)

    // If extension not explicitly supported, try text converter
    if (!converter && this.registry.mightBeTextFile(ext)) {
      converter = this.registry.getConverterByCategory('text')
    }

    if (!converter) {
      return {
        success: false,
        error: `File type .${ext} is not supported for import`,
        errorCode: ErrorCode.IMPORT_UNSUPPORTED_TYPE
      }
    }

    // Validate file
    const validation = await converter.validate(filePath)
    if (!validation.valid && validation.error !== ErrorCode.IMPORT_TOO_LARGE) {
      return {
        success: false,
        error: `File validation failed: ${validation.fileName}`,
        errorCode: validation.error
      }
    }

    // Use configured converter if options provided and converter supports it
    let activeConverter: IConverter = converter
    if (options && isConfigurableConverter(converter)) {
      activeConverter = converter.createConfigured(options)
    }

    // Convert content
    const conversion = await activeConverter.convert(filePath)
    if (!conversion.success || !conversion.content) {
      // Clean up temp screenshots if conversion had partial results
      if (conversion.screenshotDir) {
        rm(conversion.screenshotDir, { recursive: true, force: true }).catch(() => {})
      }
      return {
        success: false,
        error: conversion.error || 'Conversion failed',
        errorCode: conversion.errorCode || ErrorCode.IMPORT_CONVERSION_FAILED
      }
    }

    // Create import directory
    const importDir = join(projectPath, IMPORT.DIR_NAME)
    try {
      await mkdir(importDir, { recursive: true })
    } catch (error) {
      return {
        success: false,
        error: `Failed to create import directory: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: ErrorCode.IMPORT_DIR_CREATE_FAILED
      }
    }

    // Determine output filename
    const originalFileName = sanitizeFileName(basename(filePath))
    let outputFileName: string

    if (converter.requiresConversion) {
      // Converters that transform content get .md extension
      outputFileName = changeExtension(originalFileName, '.md')
    } else {
      // Text files keep their original extension
      outputFileName = originalFileName
    }

    // Find available filename (handle conflicts)
    let finalPath: string
    try {
      finalPath = await findAvailableFileName(importDir, outputFileName)
    } catch (error) {
      if (error instanceof AppError) {
        return {
          success: false,
          error: error.message,
          errorCode: error.code
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: ErrorCode.IMPORT_WRITE_FAILED
      }
    }

    // Write file
    try {
      await writeFile(finalPath, conversion.content, 'utf-8')
    } catch (error) {
      // Clean up temp screenshots on write failure
      if (conversion.screenshotDir) {
        rm(conversion.screenshotDir, { recursive: true, force: true }).catch(() => {})
      }
      return {
        success: false,
        error: `Failed to write imported file: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: ErrorCode.IMPORT_WRITE_FAILED
      }
    }

    // Copy screenshots if present (write .md first – screenshots are non-critical)
    if (conversion.screenshotDir) {
      try {
        const stem = parsePath(outputFileName).name
        const screenshotDest = join(importDir, 'screenshots', stem)
        await mkdir(screenshotDest, { recursive: true })
        await cp(conversion.screenshotDir, screenshotDest, { recursive: true })
      } catch {
        // Screenshot copy failure is non-fatal – .md file already written
      } finally {
        // Clean up temp directory
        try {
          await rm(conversion.screenshotDir, { recursive: true, force: true })
        } catch {
          // Cleanup failure is non-fatal
        }
      }
    }

    return {
      success: true,
      outputPath: finalPath
    }
  }
}

/**
 * Factory function for ImportService
 *
 * @param registry - Optional custom ConverterRegistry (for testing)
 */
export function createImportService(registry?: ConverterRegistry): ImportService {
  return new ImportService(registry)
}

// Singleton instance for convenience
export const importService = createImportService()

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFile } from 'fs/promises'
import { ErrorCode } from '../../../../shared/errors'
import { validateFileForImport } from '../../../utils/fileUtils'
import { TEXT_EXTENSIONS } from '../extensions'
import type { IConverter, ValidationResult, ConversionResult, FileTypeCategory } from '../types'

/**
 * Text Converter
 *
 * Handles text-based files that can be read as UTF-8.
 * No conversion is performed - content is imported as-is.
 *
 * Supports any file that can be read as valid UTF-8 text.
 * The supported extensions list includes common text formats,
 * but the converter can handle any text file.
 */
export class TextConverter implements IConverter {
  /**
   * Common text file extensions
   * This list is used for file dialog filters but the converter
   * can handle any UTF-8 text file
   */
  readonly supportedExtensions = [...TEXT_EXTENSIONS]

  readonly requiresConversion = false
  readonly category: FileTypeCategory = 'text'

  /**
   * Validate a text file before import
   */
  async validate(filePath: string): Promise<ValidationResult> {
    return validateFileForImport(filePath)
  }

  /**
   * Read text file content
   *
   * Reads the file as UTF-8 text. If the file contains invalid
   * UTF-8 sequences, they will be replaced with the replacement
   * character (U+FFFD).
   *
   * @param filePath - Absolute path to the text file
   * @returns Conversion result with text content or error
   */
  async convert(filePath: string): Promise<ConversionResult> {
    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check for encoding errors
      if (
        errorMessage.includes('EILSEQ') ||
        errorMessage.includes('invalid') ||
        errorMessage.includes('encoding')
      ) {
        return {
          success: false,
          error: 'File has invalid text encoding (not valid UTF-8)',
          errorCode: ErrorCode.IMPORT_TEXT_ENCODING_ERROR
        }
      }

      return {
        success: false,
        error: `Failed to read file: ${errorMessage}`,
        errorCode: ErrorCode.IMPORT_FILE_UNREADABLE
      }
    }

    // Check if file has any content
    if (content.trim().length === 0) {
      return {
        success: false,
        error: 'File has no content to import',
        errorCode: ErrorCode.IMPORT_EMPTY
      }
    }

    // Check for binary content (replacement characters indicate non-UTF-8 data)
    const replacementCharCount = (content.match(/\uFFFD/g) || []).length
    const totalChars = content.length
    const binaryThreshold = 0.1 // More than 10% replacement chars suggests binary

    if (totalChars > 0 && replacementCharCount / totalChars > binaryThreshold) {
      return {
        success: false,
        error: 'File appears to be binary, not text',
        errorCode: ErrorCode.IMPORT_TEXT_ENCODING_ERROR
      }
    }

    return {
      success: true,
      content
    }
  }
}

/**
 * Factory function for TextConverter
 */
export function createTextConverter(): TextConverter {
  return new TextConverter()
}

import { readFile } from 'fs/promises'
import pdf2md from '@opendocsg/pdf2md'
import { ErrorCode } from '../../../../shared/errors'
import { validateFileForImport } from '../../../utils/fileUtils'
import type { IConverter, ValidationResult, ConversionResult, FileTypeCategory } from '../types'

/**
 * PDF Converter
 *
 * Converts PDF files to Markdown using @opendocsg/pdf2md library.
 * Handles encrypted PDFs, empty PDFs, and conversion errors.
 */
export class PdfConverter implements IConverter {
  readonly supportedExtensions = ['pdf']
  readonly requiresConversion = true
  readonly category: FileTypeCategory = 'document'

  /**
   * Validate a PDF file before conversion
   *
   * Note: Encryption is detected during conversion, not validation
   */
  async validate(filePath: string): Promise<ValidationResult> {
    return validateFileForImport(filePath)
  }

  /**
   * Convert PDF to Markdown
   *
   * @param filePath - Absolute path to the PDF file
   * @returns Conversion result with markdown content or error
   */
  async convert(filePath: string): Promise<ConversionResult> {
    // Read PDF file
    let pdfBuffer: Buffer
    try {
      pdfBuffer = await readFile(filePath)
    } catch (error) {
      return {
        success: false,
        error: `Failed to read PDF file: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: ErrorCode.IMPORT_FILE_UNREADABLE
      }
    }

    // Convert PDF to Markdown
    let markdown: string
    try {
      markdown = await pdf2md(pdfBuffer)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Detect encrypted PDF
      if (
        errorMessage.toLowerCase().includes('password') ||
        errorMessage.toLowerCase().includes('encrypted')
      ) {
        return {
          success: false,
          error: 'PDF is password protected',
          errorCode: ErrorCode.IMPORT_ENCRYPTED
        }
      }

      // Generic conversion failure
      return {
        success: false,
        error: `PDF conversion failed: ${errorMessage}`,
        errorCode: ErrorCode.IMPORT_CORRUPT
      }
    }

    // Check if conversion produced any content
    if (!markdown || markdown.trim().length === 0) {
      return {
        success: false,
        error: 'PDF has no text content to convert',
        errorCode: ErrorCode.IMPORT_EMPTY
      }
    }

    return {
      success: true,
      content: markdown
    }
  }
}

/**
 * Factory function for PdfConverter
 */
export function createPdfConverter(): PdfConverter {
  return new PdfConverter()
}

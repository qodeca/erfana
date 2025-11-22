import { readFile, stat, writeFile, mkdir, access } from 'fs/promises'
import { join, basename, extname } from 'path'
import pdf2md from '@opendocsg/pdf2md'
import { ErrorCode, AppError } from '../../shared/errors'

// Maximum number of auto-numbered copies before rejecting operation (e.g., file.md, file (1).md, ... file (999).md)
const MAX_COPY_ATTEMPTS = 1000

// PDF size warning threshold in bytes (50MB)
const PDF_SIZE_WARNING_THRESHOLD = 50 * 1024 * 1024

// Import directory name
const IMPORT_DIR_NAME = 'import'

export interface PdfValidationResult {
  valid: boolean
  error?: ErrorCode
  sizeInMB: number
  fileName: string
}

export interface PdfConversionResult {
  success: boolean
  outputPath?: string
  error?: string
  errorCode?: ErrorCode
}

/**
 * Service for importing PDF files and converting them to Markdown
 */
export class PdfImportService {
  /**
   * Validate a PDF file before conversion
   *
   * Checks:
   * - File exists
   * - File size (warning if >50MB)
   * - Note: Encryption check happens during conversion
   */
  async validatePdf(pdfPath: string): Promise<PdfValidationResult> {
    const fileName = basename(pdfPath)

    // Check file exists
    try {
      await access(pdfPath)
    } catch {
      return {
        valid: false,
        error: ErrorCode.PDF_CORRUPT,
        sizeInMB: 0,
        fileName
      }
    }

    // Get file stats
    let fileStats
    try {
      fileStats = await stat(pdfPath)
    } catch {
      return {
        valid: false,
        error: ErrorCode.PDF_CORRUPT,
        sizeInMB: 0,
        fileName
      }
    }

    const sizeInMB = fileStats.size / (1024 * 1024)

    // Check if file is too large (warning only, not blocking)
    const isTooLarge = fileStats.size > PDF_SIZE_WARNING_THRESHOLD

    return {
      valid: true,
      error: isTooLarge ? ErrorCode.PDF_TOO_LARGE : undefined,
      sizeInMB,
      fileName
    }
  }

  /**
   * Convert a PDF file to Markdown and save to project's import/ directory
   *
   * @param pdfPath - Absolute path to the PDF file
   * @param projectPath - Absolute path to the project root
   */
  async convertPdf(pdfPath: string, projectPath: string): Promise<PdfConversionResult> {
    // Validate PDF first
    const validation = await this.validatePdf(pdfPath)
    if (!validation.valid && validation.error !== ErrorCode.PDF_TOO_LARGE) {
      return {
        success: false,
        error: `PDF validation failed: ${validation.fileName}`,
        errorCode: validation.error
      }
    }

    // Read PDF file
    let pdfBuffer: Buffer
    try {
      pdfBuffer = await readFile(pdfPath)
    } catch (error) {
      return {
        success: false,
        error: `Failed to read PDF file: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: ErrorCode.PDF_CORRUPT
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
          errorCode: ErrorCode.PDF_ENCRYPTED
        }
      }

      // Generic conversion failure
      return {
        success: false,
        error: `PDF conversion failed: ${errorMessage}`,
        errorCode: ErrorCode.PDF_CORRUPT
      }
    }

    // Check if conversion produced any content
    if (!markdown || markdown.trim().length === 0) {
      return {
        success: false,
        error: 'PDF has no text content to convert',
        errorCode: ErrorCode.PDF_EMPTY
      }
    }

    // Create import directory if it doesn't exist
    const importDir = join(projectPath, IMPORT_DIR_NAME)
    try {
      await mkdir(importDir, { recursive: true })
    } catch (error) {
      return {
        success: false,
        error: `Failed to create import directory: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: ErrorCode.PDF_CONVERSION_FAILED
      }
    }

    // Generate output filename
    const outputFileName = this.sanitizeFileName(basename(pdfPath))
    const baseNameWithoutExt = outputFileName.replace(/\.pdf$/i, '')
    const mdFileName = `${baseNameWithoutExt}.md`

    // Find available filename (handle conflicts)
    let finalPath: string
    try {
      finalPath = await this.findAvailableFileName(importDir, mdFileName)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: ErrorCode.PDF_CONVERSION_FAILED
      }
    }

    // Write markdown file
    try {
      await writeFile(finalPath, markdown, 'utf-8')
    } catch (error) {
      return {
        success: false,
        error: `Failed to write markdown file: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: ErrorCode.PDF_CONVERSION_FAILED
      }
    }

    return {
      success: true,
      outputPath: finalPath
    }
  }

  /**
   * Sanitize filename to remove invalid characters
   * Removes: path separators, null bytes, control characters
   */
  private sanitizeFileName(fileName: string): string {
    // Remove path separators and null bytes
    let sanitized = fileName.replace(/[/\\:]/g, '_')

    // Remove control characters (ASCII 0-31 except tab, newline, carriage return)
    // Using filter to avoid ESLint no-control-regex warning
    sanitized = sanitized
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0)
        // Keep printable characters and safe whitespace (tab=9, newline=10, carriage return=13)
        return code > 31 || code === 9 || code === 10 || code === 13
      })
      .join('')

    // Trim whitespace
    sanitized = sanitized.trim()

    // If empty after sanitization, use default name
    if (!sanitized) {
      sanitized = 'imported.pdf'
    }

    return sanitized
  }

  /**
   * Find an available filename, auto-incrementing if conflicts exist
   */
  private async findAvailableFileName(dirPath: string, fileName: string): Promise<string> {
    const ext = extname(fileName)
    const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName

    // Try original name first
    let targetPath = join(dirPath, fileName)
    let exists = await this.fileExists(targetPath)

    if (!exists) {
      return targetPath
    }

    // Try numbered alternatives
    for (let i = 1; i <= MAX_COPY_ATTEMPTS; i++) {
      const numberedName = `${nameWithoutExt} (${i})${ext}`
      targetPath = join(dirPath, numberedName)
      exists = await this.fileExists(targetPath)

      if (!exists) {
        return targetPath
      }
    }

    throw new AppError(
      `Cannot create more than ${MAX_COPY_ATTEMPTS} copies with the same name`,
      ErrorCode.PDF_CONVERSION_FAILED
    )
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Factory function to create PdfImportService instance
 * Enables dependency injection and testing
 */
export function createPdfImportService(): PdfImportService {
  return new PdfImportService()
}

// Singleton instance for backward compatibility
export const pdfImportService = createPdfImportService()

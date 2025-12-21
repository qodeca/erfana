import { dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { DOCX_EXPORT } from '../../shared/constants'
import { ErrorCode } from '../../shared/errors'
import type { DocxExportResponse } from '../../shared/ipc/docx-schema'
import { htmlToDocxConverter } from './HtmlToDocxConverter'
import { logger } from './LoggingService'

// ============================================================================
// Value Objects
// ============================================================================

/**
 * Export lock value object
 *
 * Encapsulates export mutex logic to prevent concurrent exports.
 * Follows Single Responsibility Principle.
 */
class ExportLock {
  private locked = false

  /**
   * Attempt to acquire the lock
   * @returns true if lock was acquired, false if already locked
   */
  acquire(): boolean {
    if (this.locked) {
      return false
    }
    this.locked = true
    return true
  }

  /**
   * Release the lock
   */
  release(): void {
    this.locked = false
  }

  /**
   * Check if currently locked
   */
  isLocked(): boolean {
    return this.locked
  }
}

// ============================================================================
// Service Interface
// ============================================================================

/**
 * DOCX Service interface
 *
 * Defines the contract for DOCX export functionality.
 * Enables testability and future implementations.
 */
interface IDocxService {
  /**
   * Export HTML content to DOCX
   *
   * Shows native save dialog, parses HTML, generates DOCX file.
   *
   * @param html - HTML content from markdown preview
   * @param fileName - Suggested filename without extension
   * @returns Export result with file path or error
   */
  exportToDocx(html: string, fileName: string): Promise<DocxExportResponse>
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * DOCX Export Service
 *
 * Orchestrates markdown-to-DOCX export workflow:
 * 1. Validates input content
 * 2. Shows native save dialog
 * 3. Converts HTML to DOCX document
 * 4. Writes DOCX file to disk
 *
 * Uses @turbodocx/html-to-docx library for document generation.
 * Mermaid diagrams are pre-converted to PNG in the renderer process.
 *
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */
class DocxService implements IDocxService {
  private exportLock = new ExportLock()

  /**
   * Maximum filename length (without extension)
   * Prevents filesystem issues with very long names
   */
  private static readonly MAX_FILENAME_LENGTH = 200

  /**
   * Export HTML content to DOCX file
   */
  async exportToDocx(html: string, fileName: string): Promise<DocxExportResponse> {
    // Prevent concurrent exports
    if (!this.exportLock.acquire()) {
      return {
        success: false,
        error: 'Export already in progress',
        errorCode: ErrorCode.DOCX_EXPORT_FAILED
      }
    }

    try {
      // Validate content
      const validationError = this.validateContent(html)
      if (validationError) {
        return validationError
      }

      // Show save dialog
      const savePath = await this.showSaveDialog(fileName)
      if (!savePath) {
        return {
          success: false,
          errorCode: ErrorCode.DOCX_EXPORT_CANCELLED
        }
      }

      // Convert HTML to DOCX buffer (using @turbodocx/html-to-docx)
      const buffer = await htmlToDocxConverter.convert(html)

      // Write to file
      await writeFile(savePath, buffer)

      return {
        success: true,
        filePath: savePath
      }
    } catch (error) {
      logger.error('DOCX export failed', error instanceof Error ? error : undefined)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: ErrorCode.DOCX_EXPORT_FAILED
      }
    } finally {
      this.exportLock.release()
    }
  }

  /**
   * Validate HTML content before export
   */
  private validateContent(html: string): DocxExportResponse | null {
    if (!html || html.trim().length === 0) {
      return {
        success: false,
        error: 'No content to export',
        errorCode: ErrorCode.DOCX_EXPORT_NO_CONTENT
      }
    }

    // Security: Check input size to prevent memory exhaustion
    const htmlSize = Buffer.byteLength(html, 'utf-8')
    if (htmlSize > DOCX_EXPORT.MAX_HTML_SIZE) {
      return {
        success: false,
        error: `Content too large (${Math.round(htmlSize / 1024 / 1024)}MB). Maximum allowed is 10MB.`,
        errorCode: ErrorCode.DOCX_EXPORT_FAILED
      }
    }

    return null
  }

  /**
   * Show native save dialog
   *
   * @param suggestedName - Suggested filename without extension
   * @returns Selected file path or undefined if cancelled
   */
  private async showSaveDialog(suggestedName: string): Promise<string | undefined> {
    // Sanitize filename
    const sanitized = this.sanitizeFilename(suggestedName)
    const defaultName = sanitized || DOCX_EXPORT.DEFAULT_FILENAME

    const result = await dialog.showSaveDialog({
      title: 'Export to Word Document',
      defaultPath: `${defaultName}.docx`,
      filters: [
        { name: 'Word Document', extensions: ['docx'] }
      ],
      properties: ['showOverwriteConfirmation']
    })

    if (result.canceled || !result.filePath) {
      return undefined
    }

    // Ensure .docx extension
    let filePath = result.filePath
    if (!filePath.toLowerCase().endsWith('.docx')) {
      filePath += '.docx'
    }

    return filePath
  }

  /**
   * Windows reserved filenames that cannot be used
   * See: https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
   */
  private static readonly WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
  ])

  /**
   * Sanitize filename for filesystem
   */
  private sanitizeFilename(name: string): string {
    // Remove or replace invalid characters
    let sanitized = name
      .replace(/[<>:"/\\|?*]/g, '-') // Invalid on Windows
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f]/g, '') // Control characters (C0 control codes)
      .replace(/^\.+/, '') // Leading dots (hidden files on Unix, problematic on Windows)
      .replace(/\.+$/, '') // Trailing dots (Windows strips them)
      .replace(/\s+$/, '') // Trailing spaces (Windows strips them)
      .trim()

    // Check for Windows reserved names (case-insensitive, with or without extension)
    const baseName = sanitized.split('.')[0].toUpperCase()
    if (DocxService.WINDOWS_RESERVED_NAMES.has(baseName)) {
      sanitized = `_${sanitized}`
    }

    // Truncate if too long
    if (sanitized.length > DocxService.MAX_FILENAME_LENGTH) {
      sanitized = sanitized.substring(0, DocxService.MAX_FILENAME_LENGTH)
    }

    return sanitized
  }
}

// Singleton instance
export const docxService = new DocxService()

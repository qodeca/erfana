// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain } from 'electron'
import { pdfService } from '../services/PdfService'
import { PdfExportRequestSchema, type PdfExportResponse } from '../../shared/ipc/pdf-schema'
import { ErrorCode } from '../../shared/errors'
import { logger } from '../services/LoggingService'

/**
 * Register PDF export IPC handlers
 *
 * Channels:
 * - pdf:exportToPdf - Export HTML content to PDF file
 *
 * @see Issue #58 - markdown-to-PDF export
 */
export function registerPdfHandlers(): void {
  /**
   * Export HTML content to PDF
   *
   * Shows native save dialog, renders in hidden window, writes PDF file.
   *
   * @param request - { html: string, fileName: string }
   * @returns Export result with file path or error
   */
  ipcMain.handle(
    'pdf:exportToPdf',
    async (_event, request: unknown): Promise<PdfExportResponse> => {
      // Validate request schema
      const parseResult = PdfExportRequestSchema.safeParse(request)

      if (!parseResult.success) {
        logger.error('PDF export validation error', parseResult.error)
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.issues[0]?.message,
          errorCode: ErrorCode.PDF_EXPORT_INVALID_REQUEST
        }
      }

      const { html, fileName } = parseResult.data

      try {
        return await pdfService.exportToPdf(html, fileName)
      } catch (error) {
        logger.error('PDF export handler error', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: ErrorCode.PDF_EXPORT_FAILED
        }
      }
    }
  )
}

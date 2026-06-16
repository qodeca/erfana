// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain } from 'electron'
import { docxService } from '../services/DocxService'
import { DocxExportRequestSchema, type DocxExportResponse } from '../../shared/ipc/docx-schema'
import { ErrorCode } from '../../shared/errors'
import { logger } from '../services/LoggingService'

/**
 * Register DOCX export IPC handlers
 *
 * Channels:
 * - docx:exportToDocx - Export HTML content to DOCX file
 *
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */
export function registerDocxHandlers(): void {
  /**
   * Export HTML content to DOCX
   *
   * Shows native save dialog, parses HTML, generates DOCX file.
   *
   * @param request - { html: string, fileName: string }
   * @returns Export result with file path or error
   */
  ipcMain.handle(
    'docx:exportToDocx',
    async (_event, request: unknown): Promise<DocxExportResponse> => {
      // Validate request schema
      const parseResult = DocxExportRequestSchema.safeParse(request)

      if (!parseResult.success) {
        logger.error('DOCX export validation error', parseResult.error)
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.issues[0]?.message,
          errorCode: ErrorCode.DOCX_EXPORT_INVALID_REQUEST
        }
      }

      const { html, fileName } = parseResult.data

      try {
        return await docxService.exportToDocx(html, fileName)
      } catch (error) {
        logger.error('DOCX export handler error', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: ErrorCode.DOCX_EXPORT_FAILED
        }
      }
    }
  )
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { z } from 'zod'

/**
 * PDF Export Request Schema
 *
 * Used for exporting markdown preview to PDF via IPC
 */
export const PdfExportRequestSchema = z.object({
  /** Full HTML content to render (from markdown preview) */
  html: z.string().min(1, 'HTML content required'),
  /** Suggested filename without extension (e.g., "document") */
  fileName: z.string().min(1, 'Filename required')
})

export type PdfExportRequest = z.infer<typeof PdfExportRequestSchema>

/**
 * PDF Export Response Schema
 */
export const PdfExportResponseSchema = z.object({
  success: z.boolean(),
  /** Absolute path to saved PDF (if success) */
  filePath: z.string().optional(),
  /** Error message (if failed) */
  error: z.string().optional(),
  /** Error code for structured handling */
  errorCode: z.string().optional()
})

export type PdfExportResponse = z.infer<typeof PdfExportResponseSchema>

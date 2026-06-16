// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { z } from 'zod'

/**
 * DOCX Export Request Schema
 *
 * Used for exporting markdown preview to DOCX (Word) via IPC
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */
export const DocxExportRequestSchema = z.object({
  /** Full HTML content to render (from markdown preview) */
  html: z.string().min(1, 'HTML content required'),
  /** Suggested filename without extension (e.g., "document") */
  fileName: z.string().min(1, 'Filename required')
})

export type DocxExportRequest = z.infer<typeof DocxExportRequestSchema>

/**
 * DOCX Export Response Schema
 */
export const DocxExportResponseSchema = z.object({
  success: z.boolean(),
  /** Absolute path to saved DOCX (if success) */
  filePath: z.string().optional(),
  /** Error message (if failed) */
  error: z.string().optional(),
  /** Error code for structured handling */
  errorCode: z.string().optional()
})

export type DocxExportResponse = z.infer<typeof DocxExportResponseSchema>

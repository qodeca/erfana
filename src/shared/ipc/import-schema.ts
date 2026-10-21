// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Document Import IPC Schemas and Types
 *
 * Zod schemas and TypeScript types for document import IPC communication.
 * Defines the contract between renderer and main process for document
 * import operations via LiteParse.
 *
 * @see Issue #133 - LiteParse IPC handlers, Zod schemas, and preload bridge
 * @see Spec #021 - LiteParse document import
 */
import { z } from 'zod'
import { UNSAFE_TOOL_NAMES, UNSAFE_TOOL_REASONS } from '../unsafeTool'

/**
 * Import options for document conversion
 *
 * Configures OCR, screenshots, and DPI for the LiteParse converter.
 * All fields are optional with sensible defaults applied by the converter.
 */
export const DocumentImportOptionsSchema = z.object({
  /** Enable OCR text recognition (default: true) */
  ocr: z.boolean().optional(),
  /** OCR language in ISO 639-1/639-3 format (e.g., 'en', 'deu', 'chi_sim') */
  ocrLanguage: z.string().max(10).regex(/^[a-z]{2,3}(_[a-z]+)?$/).optional(),
  /** Generate page screenshots as PNG files (default: false) */
  screenshots: z.boolean().optional(),
  /** Screenshot DPI resolution 72-600 (default: 150) */
  dpi: z.number().int().min(72).max(600).optional()
})
export type DocumentImportOptions = z.infer<typeof DocumentImportOptionsSchema>

/**
 * Document import request from renderer to main process
 */
export const DocumentImportRequestSchema = z.object({
  /** Absolute path to the document file */
  filePath: z.string().min(1),
  /** Optional import configuration */
  options: DocumentImportOptionsSchema.optional()
})
export type DocumentImportRequest = z.infer<typeof DocumentImportRequestSchema>

/**
 * Progress event streamed from main to renderer via webContents.send
 *
 * Document conversion progress is phase-based (indeterminate) since
 * LiteParse has no per-page progress callback.
 */
export interface DocumentImportProgress {
  /** Progress percentage (approximate phase-based: 0, 10, 90, 100) */
  percent: number
  /** Current phase description */
  phase: string
  /** Optional non-fatal warnings (e.g., OCR failure on a page) */
  warnings?: string
}

/**
 * Import result returned via ipcMain.handle response
 */
export interface DocumentImportResult {
  success: boolean
  outputPath?: string
  error?: string
  errorCode?: string
}

/**
 * What LibreOffice detection found (#250). `unsafe`: a LibreOffice exists, but
 * the one a conversion would run is in the open project, a temp folder, a
 * network share or a relative PATH entry, so Office conversions are refused.
 */
export const ToolStateSchema = z.enum(['found', 'missing', 'unsafe'])
export type ToolState = z.infer<typeof ToolStateSchema>

/** For an `unsafe` LibreOffice: which program and why – never a path. Null otherwise. */
export const UnsafeToolSchema = z
  .object({ tool: z.enum(UNSAFE_TOOL_NAMES), reason: z.enum(UNSAFE_TOOL_REASONS) })
  .strict()
  .nullable()
export type UnsafeTool = z.infer<typeof UnsafeToolSchema>

/**
 * Dependency detection result event
 *
 * Broadcast to every window after each detection (startup and "Check again").
 * Tells the renderer whether LibreOffice can be used and the updated list of
 * supported document extensions. Images and PDF need no external tool.
 */
export interface DependencyReadyEvent {
  libreOffice: ToolState
  /** Set only when `libreOffice` is `unsafe` */
  unsafe: UnsafeTool
  /** Full list of supported document extensions after detection */
  extensions: string[]
}

/**
 * Request for the optional import tools' status (#250).
 *
 * `recheck: false` returns the per-session cached result (detecting once if it
 * has not run yet). `recheck: true` clears that cache and probes again – the
 * "Check again" action, so installing a tool needs no restart. Main rate-limits
 * rechecks (see `DOCUMENT_IMPORT.TOOL_RECHECK_MIN_INTERVAL_MS`). Strict: nothing else
 * can ride along.
 */
export const ImportToolStatusRequestSchema = z.object({ recheck: z.boolean() }).strict()
export type ImportToolStatusRequest = z.infer<typeof ImportToolStatusRequestSchema>

/** What detection found, plus the document extensions that follow from it. */
export const ImportToolStatusSchema = z
  .object({
    /** What LibreOffice detection found */
    libreOffice: ToolStateSchema,
    /** Set only when `libreOffice` is `unsafe`: which program and why */
    unsafe: UnsafeToolSchema,
    /** Supported document extensions after detection (same list as `DependencyReadyEvent`) */
    extensions: z.array(z.string()),
    /**
     * True when a recheck was asked for too soon after the previous one and the
     * existing result was returned without probing again.
     */
    throttled: z.boolean()
  })
  .strict()
export type ImportToolStatus = z.infer<typeof ImportToolStatusSchema>

/**
 * Response of `import:toolStatus`. Never rejects: a refused sender or a
 * malformed request arrives as `success: false`.
 */
export type ImportToolStatusResponse =
  | ({ success: true } & ImportToolStatus)
  | { success: false; error: string }

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { z } from 'zod'
import { isAbsolute } from 'path'

/**
 * External File Drop IPC Schema
 *
 * Defines Zod schemas for external file drop operations (Spec #012):
 * - Validation of external files before copy/move
 * - Copy from external location into project
 * - Move from external location into project
 *
 * Security: All paths must be absolute. Validated on main process.
 */

// Custom Zod refinement for absolute paths
const absolutePathString = z.string().min(1, 'Path is required').refine(
  (path) => isAbsolute(path),
  { message: 'Path must be absolute' }
)

// Conflict resolution strategies
export const ConflictResolution = z.enum(['replace', 'keepBoth'])
export type ConflictResolution = z.infer<typeof ConflictResolution>

/**
 * External File Validate Request
 *
 * Validates an external file before copy/move operation
 */
export const ExternalFileValidateRequestSchema = z.object({
  /** Absolute path to the external source file */
  sourcePath: absolutePathString,
  /** Accepted for older callers and ignored: the main process uses the open project */
  projectRoot: z.string().optional()
})

export type ExternalFileValidateRequest = z.infer<typeof ExternalFileValidateRequestSchema>

/**
 * Positional arguments of `file:validateExternal`: source, ignored project root
 */
export const ExternalFileValidateArgsSchema = z.tuple([
  absolutePathString,
  z.string().optional()
])

/**
 * Positional arguments of `file:copyFromExternal` and `file:moveFromExternal`:
 * source, target folder, ignored project root, conflict strategy
 */
export const ExternalFileTransferArgsSchema = z.tuple([
  absolutePathString,
  absolutePathString,
  z.string().optional(),
  ConflictResolution.optional()
])

/**
 * External File Validate Response
 *
 * Returns validation status and file type information
 */
export const ExternalFileValidateResponseSchema = z.object({
  /** Whether the file is valid for import */
  valid: z.boolean(),
  /** Whether the source is a symlink */
  isSymlink: z.boolean(),
  /** Whether the source is a directory (directories rejected) */
  isDirectory: z.boolean(),
  /** Whether the source file exists */
  exists: z.boolean(),
  /** Whether source is a regular file (not device, pipe, socket) */
  isRegularFile: z.boolean(),
  /** Error message if validation failed */
  error: z.string().optional(),
  /** Error code for structured handling */
  errorCode: z.string().optional()
})

export type ExternalFileValidateResponse = z.infer<typeof ExternalFileValidateResponseSchema>

/**
 * External File Copy Request
 *
 * Copies a file from external location into project
 */
export const ExternalFileCopyRequestSchema = z.object({
  /** Absolute path to the external source file */
  sourcePath: absolutePathString,
  /** Absolute path to the target folder within project */
  targetFolder: absolutePathString,
  /** Accepted for older callers and ignored: the main process uses the open project */
  projectRoot: z.string().optional(),
  /** How to handle name conflicts */
  conflictResolution: ConflictResolution.optional()
})

export type ExternalFileCopyRequest = z.infer<typeof ExternalFileCopyRequestSchema>

/**
 * External File Copy Response
 */
export const ExternalFileCopyResponseSchema = z.object({
  /** Whether the operation succeeded */
  success: z.boolean(),
  /** Absolute path to the copied file (if success) */
  path: z.string().optional(),
  /** Whether the copied file is a symlink */
  isSymlink: z.boolean().optional(),
  /** Error message (if failed) */
  error: z.string().optional(),
  /** Error code for structured handling */
  errorCode: z.string().optional()
})

export type ExternalFileCopyResponse = z.infer<typeof ExternalFileCopyResponseSchema>

/**
 * External File Move Request
 *
 * Moves a file from external location into project (deletes source after copy)
 */
export const ExternalFileMoveRequestSchema = z.object({
  /** Absolute path to the external source file */
  sourcePath: absolutePathString,
  /** Absolute path to the target folder within project */
  targetFolder: absolutePathString,
  /** Accepted for older callers and ignored: the main process uses the open project */
  projectRoot: z.string().optional(),
  /** How to handle name conflicts */
  conflictResolution: ConflictResolution.optional()
})

export type ExternalFileMoveRequest = z.infer<typeof ExternalFileMoveRequestSchema>

/**
 * External File Move Response
 */
export const ExternalFileMoveResponseSchema = z.object({
  /** Whether the operation succeeded */
  success: z.boolean(),
  /** Absolute path to the moved file (if success) */
  path: z.string().optional(),
  /** Whether the moved file is a symlink */
  isSymlink: z.boolean().optional(),
  /** Error message (if failed) */
  error: z.string().optional(),
  /** Error code for structured handling */
  errorCode: z.string().optional()
})

export type ExternalFileMoveResponse = z.infer<typeof ExternalFileMoveResponseSchema>

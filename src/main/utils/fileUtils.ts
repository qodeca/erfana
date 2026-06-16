// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { access, stat } from 'fs/promises'
import { join, extname, basename } from 'path'
import { IMPORT } from '../../shared/constants'
import { ErrorCode, AppError } from '../../shared/errors'
import type { ValidationResult } from '../services/import/types'

/**
 * Shared file utilities for the import system
 *
 * These utilities are extracted from PdfImportService to enable
 * reuse across different file type converters.
 */

/**
 * Sanitize filename to remove invalid characters
 *
 * Removes:
 * - Path separators (/, \, :)
 * - Null bytes
 * - Control characters (ASCII 0-31 except tab, newline, carriage return)
 *
 * @param fileName - Original filename
 * @param defaultName - Fallback name if result is empty (default: 'imported')
 * @returns Sanitized filename
 */
export function sanitizeFileName(fileName: string, defaultName = 'imported'): string {
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
    sanitized = defaultName
  }

  return sanitized
}

/**
 * Check if a file exists
 *
 * @param filePath - Absolute path to check
 * @returns true if file exists, false otherwise
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Find an available filename, auto-incrementing if conflicts exist
 *
 * Examples:
 * - If "document.md" doesn't exist → returns "document.md"
 * - If "document.md" exists → returns "document (1).md"
 * - If "document (1).md" also exists → returns "document (2).md"
 *
 * @param dirPath - Directory to check for conflicts
 * @param fileName - Desired filename
 * @param maxAttempts - Maximum numbered attempts (default: IMPORT.MAX_COPY_ATTEMPTS)
 * @returns Available file path
 * @throws AppError if max attempts exceeded
 */
export async function findAvailableFileName(
  dirPath: string,
  fileName: string,
  maxAttempts = IMPORT.MAX_COPY_ATTEMPTS
): Promise<string> {
  const ext = extname(fileName)
  const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName

  // Try original name first
  let targetPath = join(dirPath, fileName)
  let exists = await fileExists(targetPath)

  if (!exists) {
    return targetPath
  }

  // Try numbered alternatives
  for (let i = 1; i <= maxAttempts; i++) {
    const numberedName = `${nameWithoutExt} (${i})${ext}`
    targetPath = join(dirPath, numberedName)
    exists = await fileExists(targetPath)

    if (!exists) {
      return targetPath
    }
  }

  throw new AppError(
    `Cannot create more than ${maxAttempts} copies with the same name`,
    ErrorCode.IMPORT_WRITE_FAILED
  )
}

/**
 * Get file extension in lowercase without the dot
 *
 * @param fileName - Filename or path
 * @returns Extension in lowercase (e.g., 'pdf', 'txt', 'md')
 */
export function getExtension(fileName: string): string {
  const ext = extname(fileName)
  return ext ? ext.slice(1).toLowerCase() : ''
}

/**
 * Change the extension of a filename
 *
 * @param fileName - Original filename
 * @param newExt - New extension (with or without dot)
 * @returns Filename with new extension
 */
export function changeExtension(fileName: string, newExt: string): string {
  const ext = extname(fileName)
  const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName
  const normalizedExt = newExt.startsWith('.') ? newExt : `.${newExt}`
  return `${nameWithoutExt}${normalizedExt}`
}

/**
 * Format duration in seconds to a human-readable string.
 *
 * - Under 1 hour: "M:SS" (e.g., "3:05")
 * - 1 hour or more: "H:MM:SS" (e.g., "1:30:25")
 */
export function formatDuration(seconds: number): string {
  const totalSeconds = Math.floor(seconds)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Validate a file for import
 *
 * Common validation logic shared by all converters:
 * - Checks file exists and is accessible
 * - Gets file stats (size)
 * - Returns size warning if file exceeds threshold
 *
 * @param filePath - Absolute path to the file
 * @returns ValidationResult with file info and any warnings
 */
export async function validateFileForImport(filePath: string): Promise<ValidationResult> {
  const fileName = basename(filePath)

  // Check file exists
  try {
    await access(filePath)
  } catch {
    return {
      valid: false,
      error: ErrorCode.IMPORT_FILE_NOT_FOUND,
      sizeInMB: 0,
      fileName
    }
  }

  // Get file stats
  let fileStats
  try {
    fileStats = await stat(filePath)
  } catch {
    return {
      valid: false,
      error: ErrorCode.IMPORT_FILE_UNREADABLE,
      sizeInMB: 0,
      fileName
    }
  }

  const sizeInMB = fileStats.size / (1024 * 1024)

  // Check if file is too large (warning only, not blocking)
  const isTooLarge = fileStats.size > IMPORT.SIZE_WARNING_THRESHOLD

  return {
    valid: true,
    error: isTooLarge ? ErrorCode.IMPORT_TOO_LARGE : undefined,
    sizeInMB,
    fileName
  }
}

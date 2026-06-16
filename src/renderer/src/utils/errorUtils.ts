// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Error handling utilities for consistent error message formatting
 */

import { INVALID_FILENAME_MARKER } from '../../../shared/errors'

/**
 * Sanitizes IPC error messages by removing Electron's remote method invocation prefix
 *
 * @param error - The error to sanitize
 * @returns Clean, user-friendly error message
 *
 * @example
 * // Input: "Error invoking remote method 'file:moveItem': Error: File not found"
 * // Output: "File not found"
 */
export function sanitizeIpcError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'An unknown error occurred'
  }

  // Remove Electron IPC method invocation prefix
  return error.message.replace(/^Error invoking remote method.*?Error:\s*/i, '')
}

/**
 * Formats file operation error messages with context
 *
 * @param error - The error that occurred
 * @param operation - The operation that failed (e.g., 'move', 'copy', 'delete')
 * @param itemName - Optional name of the item being operated on
 * @returns Formatted error message
 */
export function formatFileOperationError(
  error: unknown,
  operation: string,
  itemName?: string
): string {
  const baseMessage = sanitizeIpcError(error)

  // Handle common error patterns
  if (baseMessage.includes('already exists')) {
    return itemName
      ? `An item named "${itemName}" already exists`
      : 'An item with this name already exists'
  }

  // #161: invalid filename (Windows reserved, forbidden chars, bidi, etc.)
  // The main-process AppError carries a structured, user-friendly message
  // already (e.g. `"CON.md" is not a valid filename — try "_CON.md"`).
  // Detect via the shared INVALID_FILENAME_MARKER constant so the
  // thrower (validateFilename.ts) and detector stay in sync.
  if (baseMessage.includes(INVALID_FILENAME_MARKER)) {
    return baseMessage
  }

  if (baseMessage.includes('ENOENT') || baseMessage.includes('not found')) {
    return itemName
      ? `"${itemName}" not found`
      : 'Item not found'
  }

  if (baseMessage.includes('EACCES') || baseMessage.includes('permission denied')) {
    return itemName
      ? `Permission denied: cannot ${operation} "${itemName}"`
      : `Permission denied: cannot ${operation} item`
  }

  // Return cleaned message with fallback
  return baseMessage || `Failed to ${operation} item`
}

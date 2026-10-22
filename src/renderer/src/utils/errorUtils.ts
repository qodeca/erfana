// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Error handling utilities for consistent error message formatting
 */

import { INVALID_FILENAME_MARKER } from '../../../shared/errors'
import { confinementCodeFromMessage } from '../../../shared/ipc/confinement'
import { redactQuotedPaths } from '../../../shared/redactQuotedPaths'

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

/** What kind of filesystem failure an error message reports, when it is one of the common ones. */
export type FsErrorKind = 'not-found' | 'permission' | 'no-space'

/**
 * The one errno -> kind mapper behind every file-error message in the
 * renderer ({@link formatFileOperationError}, {@link formatSaveError}).
 *
 * @param message - An error message with the IPC prefix already stripped
 * @returns The kind, or `null` for anything else
 */
export function classifyFsError(message: string): FsErrorKind | null {
  if (/\bENOENT\b/.test(message) || message.includes('not found')) return 'not-found'
  if (/\b(EACCES|EPERM)\b/.test(message) || message.includes('permission denied')) {
    return 'permission'
  }
  if (/\bENOSPC\b/.test(message)) return 'no-space'
  return null
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

  const kind = classifyFsError(baseMessage)
  if (kind === 'not-found') {
    return itemName
      ? `"${itemName}" not found`
      : 'Item not found'
  }

  if (kind === 'permission') {
    return itemName
      ? `Permission denied: cannot ${operation} "${itemName}"`
      : `Permission denied: cannot ${operation} item`
  }

  // Return cleaned message with fallback
  return baseMessage || `Failed to ${operation} item`
}

/**
 * The toast text for an editor save that failed. A failed save must never be
 * silent: the tab stays dirty and the buffer keeps the edit, and this tells
 * the user why the write did not land. A missing file on save means its folder
 * is gone (the file itself is simply recreated by a write).
 *
 * @param error - What `fileGateway.writeFile` rejected with
 * @param fileName - The tab's file name, shown in full (toasts keep user values)
 * @returns A one-line reason plus the reassurance that nothing was lost
 *
 * @example
 * ```ts
 * formatSaveError(new Error("ENOENT: no such file or directory, open '/p/docs/a.md'"), 'a.md')
 * // '"a.md" could not be saved: its folder no longer exists on disk. Your changes are still in the editor.'
 * ```
 */
export function formatSaveError(error: unknown, fileName: string): string {
  const reason = sanitizeIpcError(error)
  const kept = 'Your changes are still in the editor.'
  const what: Record<FsErrorKind, string> = {
    'not-found': 'its folder no longer exists on disk',
    permission: 'permission denied',
    'no-space': 'the disk is full'
  }
  const kind = classifyFsError(reason)
  // A save that names the project the file was opened under, after that project was closed
  const projectChanged = confinementCodeFromMessage(reason) === 'PROJECT_CHANGED'
  const why = projectChanged
    ? 'the project was changed since this file was opened'
    : kind
      ? what[kind]
      : reason.replace(/\.$/, '')
  return `"${fileName}" could not be saved: ${why}. ${kept}`
}

/**
 * The copy of an error to hand to `logger.error`, without the absolute paths a
 * Node errno message quotes (`open 'C:\Users\…\notes.md'`). The log file must
 * not hold the user's folder layout; the toast keeps the full message.
 *
 * Returns the ORIGINAL error when there is nothing to remove, so its stack
 * survives; a rewrite drops the stack, which embeds the message verbatim.
 *
 * @param error - The caught error (any value from a `catch` clause)
 * @returns An `Error` safe to log, or `undefined` for non-`Error` input
 */
export function loggableError(error: unknown): Error | undefined {
  if (!(error instanceof Error)) return undefined
  const redacted = redactQuotedPaths(error.message)
  return redacted === error.message ? error : new Error(redacted)
}

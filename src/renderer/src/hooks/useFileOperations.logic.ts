// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure Logic for useFileOperations Hook
 *
 * Extracted for unit testing without React rendering.
 * All functions are pure - no side effects, deterministic outputs.
 */

import type { FileNode } from '../interfaces/IProjectTreeApi'
import { INVALID_FILENAME_MARKER } from '../../../shared/errors'
import { getDirname } from '../utils/fileUtils'

/**
 * Gets the target path for file/folder operations
 *
 * @param selectedFolder - Currently selected folder path
 * @param projectPath - Project root path
 * @returns Target path for operation, or null if no valid target
 */
export function getTargetPath(
  selectedFolder: string | null,
  projectPath: string | null
): string | null {
  return selectedFolder || projectPath
}

/**
 * Checks if target path is valid for operations
 *
 * @param targetPath - Path to validate
 * @returns true if valid, false otherwise
 */
export function isValidTargetPath(targetPath: string | null): boolean {
  return targetPath !== null && targetPath !== undefined && targetPath !== ''
}

/**
 * Gets relative path for display purposes
 *
 * @param targetPath - Full target path
 * @param projectPath - Project root path
 * @returns Relative path string, or '/' if at root
 */
export function getRelativePath(targetPath: string, projectPath: string | null): string {
  if (!projectPath) return targetPath
  const relative = targetPath.replace(projectPath, '')
  return relative || '/'
}

/**
 * Extracts parent directory path from full path
 *
 * @param fullPath - Full file/folder path
 * @returns Parent directory path
 */
export function extractParentPath(fullPath: string): string {
  return getDirname(fullPath) || '/'
}

/**
 * Extracts sibling names from file tree for duplicate detection
 *
 * @param files - File tree nodes
 * @param itemPath - Path of the item being operated on
 * @param currentName - Current name of the item (to exclude from siblings)
 * @returns Array of sibling names
 */
export function getSiblingNames(
  files: FileNode[],
  itemPath: string,
  currentName: string
): string[] {
  const parentPath = extractParentPath(itemPath)
  const siblings = files.filter((file) => {
    const siblingParent = getDirname(file.path) || '/'
    return siblingParent === parentPath && file.name !== currentName
  })
  return siblings.map((s) => s.name)
}

/**
 * Creates confirmation message for file deletion
 *
 * @param fileName - Name of file to delete
 * @returns Confirmation message
 */
export function createDeleteFileMessage(fileName: string): string {
  return `Are you sure you want to delete "${fileName}"? This action cannot be undone.`
}

/**
 * Creates confirmation message for folder deletion
 *
 * @param folderName - Name of folder to delete
 * @returns Confirmation message
 */
export function createDeleteFolderMessage(folderName: string): string {
  return `Are you sure you want to delete "${folderName}" and all its contents? This action cannot be undone.`
}

/**
 * Creates success message for rename operation
 *
 * @returns Success message
 */
export function createRenameSuccessMessage(): string {
  return 'Item renamed successfully'
}

/**
 * Strips IPC error prefix from error messages
 *
 * @param message - Error message from IPC
 * @returns Cleaned error message
 */
export function stripIpcErrorPrefix(message: string): string {
  return message.replace(/^Error invoking remote method.*?Error:\s*/i, '')
}

/**
 * Detects if error message indicates "already exists"
 *
 * @param message - Error message to check
 * @returns true if error is about duplicate, false otherwise
 */
export function isAlreadyExistsError(message: string): boolean {
  return message.includes('already exists')
}

/**
 * Detects if error message indicates an invalid-filename rejection (#161).
 *
 * The main-process `assertValidUserFilename` throws `AppError(INVALID_FILENAME)`
 * with a structured message like `"CON.md" is not a valid filename — try "_CON.md"`.
 * `AppError.code` does not cross the Electron IPC boundary by default, so this
 * detector matches on the well-known marker embedded in the message.
 *
 * The marker phrase is sourced from the shared `INVALID_FILENAME_MARKER`
 * constant in `src/shared/errors.ts`, NOT a literal string here — that's the
 * single source of truth shared with the thrower in
 * `src/main/utils/validateFilename.ts`. Changing the marker means changing
 * the constant; all detectors update automatically.
 *
 * @param message - Error message to check
 * @returns true if error is an invalid-filename rejection, false otherwise
 */
export function isInvalidFilenameError(message: string): boolean {
  return message.includes(INVALID_FILENAME_MARKER)
}

/**
 * Formats error message for file creation
 *
 * @param error - Error object
 * @returns User-friendly error message
 */
export function formatCreateFileError(error: unknown): string {
  if (error instanceof Error) {
    const cleaned = stripIpcErrorPrefix(error.message)
    if (isAlreadyExistsError(cleaned)) {
      return 'A file with this name already exists'
    }
    // #161: invalid-filename rejections already carry a friendly message
    // like `"CON.md" is not a valid filename — try "_CON.md"`. Surface verbatim.
    if (isInvalidFilenameError(cleaned)) {
      return cleaned
    }
    return cleaned
  }
  return 'Failed to create file'
}

/**
 * Formats error message for folder creation
 *
 * @param error - Error object
 * @returns User-friendly error message
 */
export function formatCreateFolderError(error: unknown): string {
  if (error instanceof Error) {
    const cleaned = stripIpcErrorPrefix(error.message)
    if (isAlreadyExistsError(cleaned)) {
      return 'A folder with this name already exists'
    }
    // #161: invalid-filename rejections carry a friendly message verbatim.
    if (isInvalidFilenameError(cleaned)) {
      return cleaned
    }
    return cleaned
  }
  return 'Failed to create folder'
}

/**
 * Formats error message for delete operation
 *
 * @param error - Error object
 * @param itemType - Type of item being deleted
 * @returns User-friendly error message
 */
export function formatDeleteError(error: unknown, itemType: 'file' | 'folder'): string {
  if (error instanceof Error) {
    return error.message
  }
  return `Failed to delete ${itemType}`
}

/**
 * Determines if error indicates permission issue
 *
 * @param error - Error object to check
 * @returns true if permission error, false otherwise
 */
export function isPermissionError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return message.includes('eacces') || message.includes('eperm') || message.includes('permission')
  }
  return false
}

/**
 * Determines if error indicates disk space issue
 *
 * @param error - Error object to check
 * @returns true if disk space error, false otherwise
 */
export function isDiskSpaceError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return message.includes('enospc') || message.includes('no space')
  }
  return false
}

/**
 * Determines if error indicates item not found
 *
 * @param error - Error object to check
 * @returns true if not found error, false otherwise
 */
export function isNotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return message.includes('enoent') || message.includes('not found')
  }
  return false
}

/**
 * Creates log message for file creation error
 *
 * @returns Log message prefix
 */
export function createFileCreationErrorLog(): string {
  return 'Error creating file:'
}

/**
 * Creates log message for folder creation error
 *
 * @returns Log message prefix
 */
export function createFolderCreationErrorLog(): string {
  return 'Error creating folder:'
}

/**
 * Creates log message for file deletion error
 *
 * @returns Log message prefix
 */
export function createFileDeletionErrorLog(): string {
  return 'Error deleting file:'
}

/**
 * Creates log message for folder deletion error
 *
 * @returns Log message prefix
 */
export function createFolderDeletionErrorLog(): string {
  return 'Error deleting folder:'
}

/**
 * Creates log message for rename error
 *
 * @returns Log message prefix
 */
export function createRenameErrorLog(): string {
  return 'Error renaming item:'
}

/**
 * Builds full child path from parent and child name
 *
 * @param parentPath - Parent directory path
 * @param childName - Name of child file/folder
 * @returns Full path to child
 */
export function buildChildPath(parentPath: string, childName: string): string {
  // Handle root path
  if (parentPath === '/') {
    return `/${childName}`
  }
  // Handle normal path with trailing slash check
  // eslint-disable-next-line no-restricted-syntax -- constructs a new child segment; the '/'-join yields a mixed-separator path Node fs accepts on Windows (parses no existing native path; currently no runtime caller)
  return parentPath.endsWith('/') ? `${parentPath}${childName}` : `${parentPath}/${childName}`
}

/**
 * Checks if operation requires confirmation dialog
 *
 * @param operation - Operation type
 * @returns true if requires confirmation, false otherwise
 */
export function requiresConfirmation(operation: 'create' | 'rename' | 'delete'): boolean {
  return operation === 'delete'
}

/**
 * Gets operation title for dialogs
 *
 * @param operation - Operation type
 * @param itemType - Type of item
 * @returns Dialog title
 */
export function getOperationTitle(
  operation: 'create' | 'rename' | 'delete',
  itemType: 'file' | 'folder'
): string {
  const itemLabel = itemType === 'file' ? 'File' : 'Folder'

  switch (operation) {
    case 'create':
      return `Create New ${itemLabel}`
    case 'rename':
      return `Rename ${itemLabel}`
    case 'delete':
      return `Delete ${itemLabel}`
  }
}

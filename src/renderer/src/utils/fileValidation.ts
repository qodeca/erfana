// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File and folder name validation utilities
 *
 * Shared validation logic for file system operations (create, rename).
 * Ensures names are valid across different operating systems.
 */

// OS-reserved names (Windows)
export const RESERVED_NAMES = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
]

// Invalid filename characters (cross-platform)
export const INVALID_CHARS = /[/\\:*?"<>|]/

// Filesystem name length limit (common across most systems)
export const MAX_NAME_LENGTH = 255

/**
 * Validation error codes for programmatic error handling
 */
export enum ValidationErrorCode {
  EMPTY = 'EMPTY',
  TOO_LONG = 'TOO_LONG',
  INVALID_CHARS = 'INVALID_CHARS',
  RESERVED = 'RESERVED',
  UNCHANGED = 'UNCHANGED',
  DUPLICATE = 'DUPLICATE'
}

/**
 * Validation result type
 * - success: true - validation passed
 * - success: false - validation failed with error code and message
 */
export type ValidationResult =
  | { success: true }
  | { success: false; code: ValidationErrorCode; message: string }

/**
 * Validate a file or folder name
 *
 * @param name - The name to validate (will be trimmed)
 * @param existingNames - Array of existing sibling names to check for duplicates
 * @param options - Validation options
 * @returns Validation result with success flag, error code, and message
 *
 * @example
 * ```typescript
 * const result = validateFileSystemName('my-file.md', ['existing.md'])
 * if (result.success) {
 *   // Name is valid
 * } else {
 *   console.error(result.code, result.message)
 * }
 * ```
 */
export function validateFileSystemName(
  name: string,
  existingNames: string[] = [],
  options: {
    currentName?: string // For rename - skip duplicate check if name unchanged
    minLength?: number
    maxLength?: number
  } = {}
): ValidationResult {
  const { currentName, minLength = 1, maxLength = MAX_NAME_LENGTH } = options

  const trimmed = name.trim()

  // Check min length
  if (trimmed.length < minLength) {
    return {
      success: false,
      code: ValidationErrorCode.EMPTY,
      message: 'Name cannot be empty'
    }
  }

  // Check max length
  if (trimmed.length > maxLength) {
    return {
      success: false,
      code: ValidationErrorCode.TOO_LONG,
      message: `Name is too long (max ${maxLength} characters)`
    }
  }

  // Check invalid characters
  if (INVALID_CHARS.test(trimmed)) {
    return {
      success: false,
      code: ValidationErrorCode.INVALID_CHARS,
      message: 'Name cannot contain: / \\ : * ? " < > |'
    }
  }

  // Check reserved names (case-insensitive, Windows)
  const upperName = trimmed.toUpperCase()
  // Also check name without extension for reserved names
  // Handle edge case: files starting with dot (e.g., .gitignore)
  const firstPart = trimmed.startsWith('.') ? trimmed : trimmed.split('.')[0]
  const nameWithoutExt = firstPart.toUpperCase()
  if (RESERVED_NAMES.includes(upperName) || RESERVED_NAMES.includes(nameWithoutExt)) {
    return {
      success: false,
      code: ValidationErrorCode.RESERVED,
      message: 'This name is reserved by the operating system'
    }
  }

  // For rename operations, skip duplicate check if name hasn't changed
  if (currentName && trimmed === currentName) {
    return {
      success: false,
      code: ValidationErrorCode.UNCHANGED,
      message: 'Name must be different'
    }
  }

  // Check for duplicate names in the same directory (case-insensitive for cross-platform safety)
  // On macOS APFS and Windows NTFS, file.txt and FILE.TXT are the same file
  const lowerTrimmed = trimmed.toLowerCase()
  const lowerExistingNames = existingNames.map((n) => n.toLowerCase())
  if (lowerExistingNames.includes(lowerTrimmed)) {
    return {
      success: false,
      code: ValidationErrorCode.DUPLICATE,
      message: 'An item with this name already exists'
    }
  }

  return { success: true }
}

/**
 * Validate a filename specifically
 * Same as validateFileSystemName but with file-specific error messages
 */
export function validateFileName(
  name: string,
  existingNames: string[] = [],
  options: {
    currentName?: string
    minLength?: number
    maxLength?: number
  } = {}
): ValidationResult {
  const result = validateFileSystemName(name, existingNames, options)

  // Customize error messages for files
  if (!result.success) {
    if (result.code === ValidationErrorCode.EMPTY) {
      return {
        success: false,
        code: result.code,
        message: 'File name cannot be empty'
      }
    }
    if (result.code === ValidationErrorCode.DUPLICATE) {
      return {
        success: false,
        code: result.code,
        message: 'A file with this name already exists'
      }
    }
  }

  return result
}

/**
 * Validate a folder name specifically
 * Same as validateFileSystemName but with folder-specific error messages
 */
export function validateFolderName(
  name: string,
  existingNames: string[] = [],
  options: {
    currentName?: string
    minLength?: number
    maxLength?: number
  } = {}
): ValidationResult {
  const result = validateFileSystemName(name, existingNames, options)

  // Customize error messages for folders
  if (!result.success) {
    if (result.code === ValidationErrorCode.EMPTY) {
      return {
        success: false,
        code: result.code,
        message: 'Folder name cannot be empty'
      }
    }
    if (result.code === ValidationErrorCode.DUPLICATE) {
      return {
        success: false,
        code: result.code,
        message: 'A folder with this name already exists'
      }
    }
  }

  return result
}

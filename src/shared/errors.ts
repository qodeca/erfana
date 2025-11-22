/**
 * Standardized Error Codes and Types
 *
 * todo021: Unified error handling across all application layers
 * Provides type-safe error codes and structured error class
 */

export enum ErrorCode {
  // Path validation errors
  PATH_INVALID = 'PATH_INVALID',
  PATH_NOT_ABSOLUTE = 'PATH_NOT_ABSOLUTE',
  PATH_SYSTEM_DIR = 'PATH_SYSTEM_DIR',
  PATH_NOT_ACCESSIBLE = 'PATH_NOT_ACCESSIBLE',
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  SYMLINK_ATTACK = 'SYMLINK_ATTACK',

  // Settings/persistence errors
  SETTINGS_READ_FAILED = 'SETTINGS_READ_FAILED',
  SETTINGS_WRITE_FAILED = 'SETTINGS_WRITE_FAILED',

  // Project errors
  PROJECT_NOT_FOUND = 'PROJECT_NOT_FOUND',
  PROJECT_NOT_DIRECTORY = 'PROJECT_NOT_DIRECTORY',
  PROJECT_OPEN_FAILED = 'PROJECT_OPEN_FAILED',

  // PDF import errors
  PDF_ENCRYPTED = 'PDF_ENCRYPTED',
  PDF_EMPTY = 'PDF_EMPTY',
  PDF_CORRUPT = 'PDF_CORRUPT',
  PDF_TOO_LARGE = 'PDF_TOO_LARGE',
  PDF_CONVERSION_FAILED = 'PDF_CONVERSION_FAILED',

  // Generic errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Structured application error with error code and context
 *
 * Benefits:
 * - Type-safe error handling
 * - Structured error information
 * - Original error preservation for debugging
 * - User-friendly message translation support
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'AppError'

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype)
  }

  /**
   * Create AppError from unknown error with code
   */
  static from(error: unknown, code: ErrorCode): AppError {
    if (error instanceof AppError) {
      return error
    }

    const message = error instanceof Error ? error.message : String(error)
    const originalError = error instanceof Error ? error : undefined
    return new AppError(message, code, originalError)
  }

  /**
   * Check if error has specific code
   */
  hasCode(code: ErrorCode): boolean {
    return this.code === code
  }

  /**
   * Check if error is one of multiple codes
   */
  hasCodes(...codes: ErrorCode[]): boolean {
    return codes.includes(this.code)
  }
}

/**
 * User-friendly error messages for display
 * todo023: Error message translator
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // Path validation errors
  [ErrorCode.PATH_INVALID]: 'The selected path is invalid',
  [ErrorCode.PATH_NOT_ABSOLUTE]: 'Please select an absolute path',
  [ErrorCode.PATH_SYSTEM_DIR]: 'System directories cannot be opened as projects',
  [ErrorCode.PATH_NOT_ACCESSIBLE]: 'Cannot access the selected directory. Please check permissions.',
  [ErrorCode.PATH_TRAVERSAL]: 'Invalid path: path traversal detected',
  [ErrorCode.SYMLINK_ATTACK]: 'This directory link points to a protected location',

  // Settings/persistence errors
  [ErrorCode.SETTINGS_READ_FAILED]: 'Failed to read application settings',
  [ErrorCode.SETTINGS_WRITE_FAILED]: 'Failed to save application settings',

  // Project errors
  [ErrorCode.PROJECT_NOT_FOUND]: 'This project no longer exists',
  [ErrorCode.PROJECT_NOT_DIRECTORY]: 'Selected path is not a directory',
  [ErrorCode.PROJECT_OPEN_FAILED]: 'Failed to open project',

  // PDF import errors
  [ErrorCode.PDF_ENCRYPTED]: 'This PDF is password protected',
  [ErrorCode.PDF_EMPTY]: 'PDF has no text content to convert',
  [ErrorCode.PDF_CORRUPT]: 'Unable to read PDF file',
  [ErrorCode.PDF_TOO_LARGE]: 'PDF file is too large',
  [ErrorCode.PDF_CONVERSION_FAILED]: 'Failed to convert PDF to markdown',

  // Generic errors
  [ErrorCode.UNKNOWN_ERROR]: 'An unexpected error occurred'
}

/**
 * Get user-friendly error message
 *
 * Usage:
 *   const message = getUserFriendlyMessage(error)
 *   // Returns friendly message if AppError, technical message otherwise
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof AppError) {
    return ERROR_MESSAGES[error.code] || error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

/**
 * Check if error indicates project not found
 */
export function isProjectNotFoundError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    (error.code === ErrorCode.PROJECT_NOT_FOUND || error.code === ErrorCode.PATH_NOT_ACCESSIBLE)
  )
}

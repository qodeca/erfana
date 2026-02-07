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
  PATH_OUTSIDE_PROJECT = 'PATH_OUTSIDE_PROJECT',
  SYMLINK_ATTACK = 'SYMLINK_ATTACK',

  // Settings/persistence errors
  SETTINGS_READ_FAILED = 'SETTINGS_READ_FAILED',
  SETTINGS_WRITE_FAILED = 'SETTINGS_WRITE_FAILED',

  // Project errors
  PROJECT_NOT_FOUND = 'PROJECT_NOT_FOUND',
  PROJECT_NOT_DIRECTORY = 'PROJECT_NOT_DIRECTORY',
  PROJECT_OPEN_FAILED = 'PROJECT_OPEN_FAILED',

  // Project settings errors
  PROJECT_SETTINGS_READ_FAILED = 'PROJECT_SETTINGS_READ_FAILED',
  PROJECT_SETTINGS_INVALID_JSON = 'PROJECT_SETTINGS_INVALID_JSON',
  PROJECT_SETTINGS_VALIDATION_FAILED = 'PROJECT_SETTINGS_VALIDATION_FAILED',

  // Global settings errors
  GLOBAL_SETTINGS_READ_FAILED = 'GLOBAL_SETTINGS_READ_FAILED',
  GLOBAL_SETTINGS_WRITE_FAILED = 'GLOBAL_SETTINGS_WRITE_FAILED',
  GLOBAL_SETTINGS_VALIDATION_FAILED = 'GLOBAL_SETTINGS_VALIDATION_FAILED',
  GLOBAL_SETTINGS_DIR_CREATE_FAILED = 'GLOBAL_SETTINGS_DIR_CREATE_FAILED',

  // PDF import errors (legacy - prefer IMPORT_* for new code)
  PDF_ENCRYPTED = 'PDF_ENCRYPTED',
  PDF_EMPTY = 'PDF_EMPTY',
  PDF_CORRUPT = 'PDF_CORRUPT',
  PDF_TOO_LARGE = 'PDF_TOO_LARGE',
  PDF_CONVERSION_FAILED = 'PDF_CONVERSION_FAILED',

  // Generic import errors
  IMPORT_FILE_NOT_FOUND = 'IMPORT_FILE_NOT_FOUND',
  IMPORT_FILE_UNREADABLE = 'IMPORT_FILE_UNREADABLE',
  IMPORT_ENCRYPTED = 'IMPORT_ENCRYPTED',
  IMPORT_EMPTY = 'IMPORT_EMPTY',
  IMPORT_CORRUPT = 'IMPORT_CORRUPT',
  IMPORT_TOO_LARGE = 'IMPORT_TOO_LARGE',
  IMPORT_CONVERSION_FAILED = 'IMPORT_CONVERSION_FAILED',
  IMPORT_UNSUPPORTED_TYPE = 'IMPORT_UNSUPPORTED_TYPE',
  IMPORT_TEXT_ENCODING_ERROR = 'IMPORT_TEXT_ENCODING_ERROR',
  IMPORT_DIR_CREATE_FAILED = 'IMPORT_DIR_CREATE_FAILED',
  IMPORT_WRITE_FAILED = 'IMPORT_WRITE_FAILED',

  // Prompt execution errors
  PROMPT_NOT_FOUND = 'PROMPT_NOT_FOUND',
  PROMPT_VALIDATION_FAILED = 'PROMPT_VALIDATION_FAILED',
  PROMPT_TERMINAL_TIMEOUT = 'PROMPT_TERMINAL_TIMEOUT',
  PROMPT_SEND_FAILED = 'PROMPT_SEND_FAILED',

  // PDF export errors
  PDF_EXPORT_CANCELLED = 'PDF_EXPORT_CANCELLED',
  PDF_EXPORT_FAILED = 'PDF_EXPORT_FAILED',
  PDF_EXPORT_NO_CONTENT = 'PDF_EXPORT_NO_CONTENT',
  PDF_EXPORT_INVALID_REQUEST = 'PDF_EXPORT_INVALID_REQUEST',

  // DOCX export errors
  DOCX_EXPORT_CANCELLED = 'DOCX_EXPORT_CANCELLED',
  DOCX_EXPORT_FAILED = 'DOCX_EXPORT_FAILED',
  DOCX_EXPORT_NO_CONTENT = 'DOCX_EXPORT_NO_CONTENT',
  DOCX_EXPORT_INVALID_REQUEST = 'DOCX_EXPORT_INVALID_REQUEST',

  // Screenshot capture errors
  SCREENSHOT_PERMISSION_DENIED = 'SCREENSHOT_PERMISSION_DENIED',
  SCREENSHOT_TIMEOUT = 'SCREENSHOT_TIMEOUT',
  SCREENSHOT_CANCELLED = 'SCREENSHOT_CANCELLED',
  SCREENSHOT_FAILED = 'SCREENSHOT_FAILED',
  SCREENSHOT_NOT_SUPPORTED = 'SCREENSHOT_NOT_SUPPORTED',

  // Camera capture errors (Spec #014)
  CAMERA_PERMISSION_DENIED = 'CAMERA_PERMISSION_DENIED',
  CAMERA_NOT_FOUND = 'CAMERA_NOT_FOUND',
  CAMERA_DISCONNECTED = 'CAMERA_DISCONNECTED',
  CAMERA_SAVE_FAILED = 'CAMERA_SAVE_FAILED',
  CAMERA_INVALID_DATA = 'CAMERA_INVALID_DATA',

  // Logging errors
  LOGGING_INIT_FAILED = 'LOGGING_INIT_FAILED',
  LOGGING_WRITE_FAILED = 'LOGGING_WRITE_FAILED',
  LOGGING_CLEANUP_FAILED = 'LOGGING_CLEANUP_FAILED',

  // External file drop errors (Spec #012)
  EXTERNAL_FILE_NOT_FOUND = 'EXTERNAL_FILE_NOT_FOUND',
  EXTERNAL_FILE_IS_DIRECTORY = 'EXTERNAL_FILE_IS_DIRECTORY',
  EXTERNAL_FILE_NOT_REGULAR = 'EXTERNAL_FILE_NOT_REGULAR',
  EXTERNAL_FILE_SYMLINK_SYSTEM = 'EXTERNAL_FILE_SYMLINK_SYSTEM',
  EXTERNAL_FILE_COPY_FAILED = 'EXTERNAL_FILE_COPY_FAILED',
  EXTERNAL_FILE_MOVE_FAILED = 'EXTERNAL_FILE_MOVE_FAILED',
  EXTERNAL_FILE_SOURCE_DELETED = 'EXTERNAL_FILE_SOURCE_DELETED',

  // Transcription errors (Issue #75)
  TRANSCRIPTION_NO_API_KEY = 'TRANSCRIPTION_NO_API_KEY',
  TRANSCRIPTION_INVALID_API_KEY = 'TRANSCRIPTION_INVALID_API_KEY',
  TRANSCRIPTION_API_ERROR = 'TRANSCRIPTION_API_ERROR',
  TRANSCRIPTION_RATE_LIMITED = 'TRANSCRIPTION_RATE_LIMITED',
  TRANSCRIPTION_NETWORK_ERROR = 'TRANSCRIPTION_NETWORK_ERROR',
  TRANSCRIPTION_CANCELLED = 'TRANSCRIPTION_CANCELLED',
  TRANSCRIPTION_INVALID_AUDIO = 'TRANSCRIPTION_INVALID_AUDIO',
  TRANSCRIPTION_CHUNK_FAILED = 'TRANSCRIPTION_CHUNK_FAILED',
  TRANSCRIPTION_TIMEOUT = 'TRANSCRIPTION_TIMEOUT',
  TRANSCRIPTION_FAILED = 'TRANSCRIPTION_FAILED',

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
  [ErrorCode.PATH_OUTSIDE_PROJECT]: 'Cannot access directories outside the project',
  [ErrorCode.SYMLINK_ATTACK]: 'This directory link points to a protected location',

  // Settings/persistence errors
  [ErrorCode.SETTINGS_READ_FAILED]: 'Failed to read application settings',
  [ErrorCode.SETTINGS_WRITE_FAILED]: 'Failed to save application settings',

  // Project errors
  [ErrorCode.PROJECT_NOT_FOUND]: 'This project no longer exists',
  [ErrorCode.PROJECT_NOT_DIRECTORY]: 'Selected path is not a directory',
  [ErrorCode.PROJECT_OPEN_FAILED]: 'Failed to open project',

  // Project settings errors
  [ErrorCode.PROJECT_SETTINGS_READ_FAILED]: 'Failed to read project settings file',
  [ErrorCode.PROJECT_SETTINGS_INVALID_JSON]: 'Project settings file contains invalid JSON',
  [ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED]: 'Project settings file has invalid structure',

  // Global settings errors
  [ErrorCode.GLOBAL_SETTINGS_READ_FAILED]: 'Failed to read global settings',
  [ErrorCode.GLOBAL_SETTINGS_WRITE_FAILED]: 'Failed to save global settings',
  [ErrorCode.GLOBAL_SETTINGS_VALIDATION_FAILED]: 'Global settings file has invalid structure',
  [ErrorCode.GLOBAL_SETTINGS_DIR_CREATE_FAILED]: 'Failed to create settings directory',

  // PDF import errors (legacy)
  [ErrorCode.PDF_ENCRYPTED]: 'This PDF is password protected',
  [ErrorCode.PDF_EMPTY]: 'PDF has no text content to convert',
  [ErrorCode.PDF_CORRUPT]: 'Unable to read PDF file',
  [ErrorCode.PDF_TOO_LARGE]: 'PDF file is too large',
  [ErrorCode.PDF_CONVERSION_FAILED]: 'Failed to convert PDF to markdown',

  // Generic import errors
  [ErrorCode.IMPORT_FILE_NOT_FOUND]: 'File not found',
  [ErrorCode.IMPORT_FILE_UNREADABLE]: 'Cannot read file',
  [ErrorCode.IMPORT_ENCRYPTED]: 'File is password protected',
  [ErrorCode.IMPORT_EMPTY]: 'File has no content to import',
  [ErrorCode.IMPORT_CORRUPT]: 'File appears to be corrupted',
  [ErrorCode.IMPORT_TOO_LARGE]: 'File is too large',
  [ErrorCode.IMPORT_CONVERSION_FAILED]: 'Failed to convert file',
  [ErrorCode.IMPORT_UNSUPPORTED_TYPE]: 'File type is not supported',
  [ErrorCode.IMPORT_TEXT_ENCODING_ERROR]: 'File has invalid text encoding',
  [ErrorCode.IMPORT_DIR_CREATE_FAILED]: 'Failed to create import directory',
  [ErrorCode.IMPORT_WRITE_FAILED]: 'Failed to write imported file',

  // Prompt execution errors
  [ErrorCode.PROMPT_NOT_FOUND]: 'Prompt template not found',
  [ErrorCode.PROMPT_VALIDATION_FAILED]: 'Missing required information for this prompt',
  [ErrorCode.PROMPT_TERMINAL_TIMEOUT]: 'Terminal took too long to initialize',
  [ErrorCode.PROMPT_SEND_FAILED]: 'Failed to send prompt to terminal',

  // PDF export errors
  [ErrorCode.PDF_EXPORT_CANCELLED]: 'PDF export was cancelled',
  [ErrorCode.PDF_EXPORT_FAILED]: 'Failed to generate PDF',
  [ErrorCode.PDF_EXPORT_NO_CONTENT]: 'No content to export',
  [ErrorCode.PDF_EXPORT_INVALID_REQUEST]: 'Invalid PDF export request',

  // DOCX export errors
  [ErrorCode.DOCX_EXPORT_CANCELLED]: 'DOCX export was cancelled',
  [ErrorCode.DOCX_EXPORT_FAILED]: 'Failed to generate DOCX',
  [ErrorCode.DOCX_EXPORT_NO_CONTENT]: 'No content to export',
  [ErrorCode.DOCX_EXPORT_INVALID_REQUEST]: 'Invalid DOCX export request',

  // Screenshot capture errors
  [ErrorCode.SCREENSHOT_PERMISSION_DENIED]: 'Screen recording permission required. Grant access in System Settings > Privacy & Security.',
  [ErrorCode.SCREENSHOT_TIMEOUT]: 'Screenshot capture timed out',
  [ErrorCode.SCREENSHOT_CANCELLED]: 'Screenshot capture was cancelled',
  [ErrorCode.SCREENSHOT_FAILED]: 'Failed to capture screenshot',
  [ErrorCode.SCREENSHOT_NOT_SUPPORTED]: 'Screenshot capture is only available on macOS',

  // Camera capture errors (Spec #014)
  [ErrorCode.CAMERA_PERMISSION_DENIED]: 'Camera permission required. Grant access in System Settings > Privacy & Security.',
  [ErrorCode.CAMERA_NOT_FOUND]: 'No camera found. Please connect a camera and try again.',
  [ErrorCode.CAMERA_DISCONNECTED]: 'Camera was disconnected during capture',
  [ErrorCode.CAMERA_SAVE_FAILED]: 'Failed to save photo',
  [ErrorCode.CAMERA_INVALID_DATA]: 'Invalid photo data received',

  // Logging errors
  [ErrorCode.LOGGING_INIT_FAILED]: 'Failed to initialize logging system',
  [ErrorCode.LOGGING_WRITE_FAILED]: 'Failed to write to log file',
  [ErrorCode.LOGGING_CLEANUP_FAILED]: 'Failed to cleanup old log files',

  // External file drop errors (Spec #012)
  [ErrorCode.EXTERNAL_FILE_NOT_FOUND]: 'External file not found or was deleted',
  [ErrorCode.EXTERNAL_FILE_IS_DIRECTORY]: 'Cannot import directories, only files',
  [ErrorCode.EXTERNAL_FILE_NOT_REGULAR]: 'Cannot import special files (devices, pipes, sockets)',
  [ErrorCode.EXTERNAL_FILE_SYMLINK_SYSTEM]: 'Cannot import symlinks pointing to system directories',
  [ErrorCode.EXTERNAL_FILE_COPY_FAILED]: 'Failed to copy external file',
  [ErrorCode.EXTERNAL_FILE_MOVE_FAILED]: 'Failed to move external file',
  [ErrorCode.EXTERNAL_FILE_SOURCE_DELETED]: 'Source file was deleted during operation',

  // Transcription errors (Issue #75)
  [ErrorCode.TRANSCRIPTION_NO_API_KEY]: 'No API key configured. Add your OpenAI API key in Settings.',
  [ErrorCode.TRANSCRIPTION_INVALID_API_KEY]: 'Invalid API key. Please check your OpenAI API key in Settings.',
  [ErrorCode.TRANSCRIPTION_API_ERROR]: 'OpenAI API error. Please try again.',
  [ErrorCode.TRANSCRIPTION_RATE_LIMITED]: 'API rate limit reached. Retrying automatically.',
  [ErrorCode.TRANSCRIPTION_NETWORK_ERROR]: 'Network error. Please check your connection and try again.',
  [ErrorCode.TRANSCRIPTION_CANCELLED]: 'Transcription was cancelled',
  [ErrorCode.TRANSCRIPTION_INVALID_AUDIO]: 'Invalid audio file. Supported formats: MP3, WAV, M4A.',
  [ErrorCode.TRANSCRIPTION_CHUNK_FAILED]: 'Failed to process audio chunk. Retrying.',
  [ErrorCode.TRANSCRIPTION_TIMEOUT]: 'Transcription request timed out',
  [ErrorCode.TRANSCRIPTION_FAILED]: 'Transcription failed. Please try again.',

  // Generic errors
  [ErrorCode.UNKNOWN_ERROR]: 'An unexpected error occurred'
}

/**
 * Get user-friendly error message (sanitized for IPC)
 *
 * Returns sanitized messages that don't expose internal details:
 * - AppError: Returns mapped message from ERROR_MESSAGES
 * - Plain Error: Returns generic message (Issue #74 review fix - security)
 * - Non-Error: Returns generic message
 *
 * This prevents leaking internal error details, stack traces, or sensitive
 * information to the renderer process.
 *
 * Usage:
 *   const message = getUserFriendlyMessage(error)
 *   return { success: false, error: message }  // Safe for IPC
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof AppError) {
    return ERROR_MESSAGES[error.code] || ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR]
  }

  // Security: Don't expose raw error messages - return generic message
  // Internal details are logged separately, not sent to renderer
  return ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR]
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

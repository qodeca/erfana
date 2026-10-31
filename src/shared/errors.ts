// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ERROR_CODE_MARKER_PATTERN, cleanErrorMessage } from './errorCodeMarker'
/**
 * Standardized Error Codes and Types
 *
 * todo021: Unified error handling across all application layers
 * Provides type-safe error codes and structured error class
 */

import type { UnsafeToolReason } from './unsafeTool'

/**
 * Sentinel phrase embedded in `AppError` messages thrown by
 * `assertValidUserFilename`. Renderer formatters discriminate the
 * `INVALID_FILENAME` error class by matching this marker in `error.message`,
 * because Electron IPC strips `AppError.code` by default.
 *
 * Single source of truth for both the thrower (`validateFilename.ts`) and
 * the detector (`useFileOperations.logic.ts`, `errorUtils.ts`). Changing
 * this string requires updating zero call sites — they all import the
 * constant.
 *
 * See #161 (Phase 2) and the architecture review note about the IPC
 * contract bridge.
 */
export const INVALID_FILENAME_MARKER = 'is not a valid filename'

export enum ErrorCode {
  // Path validation errors
  PATH_INVALID = 'PATH_INVALID',
  PATH_NOT_ABSOLUTE = 'PATH_NOT_ABSOLUTE',
  PATH_SYSTEM_DIR = 'PATH_SYSTEM_DIR',
  PATH_NOT_ACCESSIBLE = 'PATH_NOT_ACCESSIBLE',
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  PATH_OUTSIDE_PROJECT = 'PATH_OUTSIDE_PROJECT',
  SYMLINK_ATTACK = 'SYMLINK_ATTACK',
  INVALID_FILENAME = 'INVALID_FILENAME',

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
  /** Non-blocking size warning: returned with `valid: true`; import still proceeds. */
  IMPORT_TOO_LARGE = 'IMPORT_TOO_LARGE',
  /** Blocking size rejection: returned with `valid: false`; import is refused before conversion. */
  IMPORT_EXCEEDS_SIZE_LIMIT = 'IMPORT_EXCEEDS_SIZE_LIMIT',
  IMPORT_CONVERSION_FAILED = 'IMPORT_CONVERSION_FAILED',
  IMPORT_UNSUPPORTED_TYPE = 'IMPORT_UNSUPPORTED_TYPE',
  IMPORT_TEXT_ENCODING_ERROR = 'IMPORT_TEXT_ENCODING_ERROR',
  IMPORT_DIR_CREATE_FAILED = 'IMPORT_DIR_CREATE_FAILED',
  IMPORT_WRITE_FAILED = 'IMPORT_WRITE_FAILED',

  // Document import errors (Issue #132)
  // Reserved for issue 2 – emitted by import:document IPC handler when dependencies missing
  IMPORT_DEPENDENCY_MISSING = 'IMPORT_DEPENDENCY_MISSING',
  // Reserved for issue 2 – reported via progress stream when OCR fails on individual pages
  IMPORT_OCR_FAILED = 'IMPORT_OCR_FAILED',
  IMPORT_PAGE_LIMIT_EXCEEDED = 'IMPORT_PAGE_LIMIT_EXCEEDED',
  IMPORT_TIMEOUT = 'IMPORT_TIMEOUT',
  IMPORT_BUSY = 'IMPORT_BUSY',
  // The tool a conversion would run resolves into the project or a temp folder (#250)
  IMPORT_UNTRUSTED_TOOL = 'IMPORT_UNTRUSTED_TOOL',

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

  // Image export errors (Issue #73)
  /** Save dialog dismissed. Never surfaced — the renderer suppresses the toast. */
  IMAGE_EXPORT_CANCELLED = 'IMAGE_EXPORT_CANCELLED',
  /** Untrusted sender, Zod failure, or an unsupported extension. */
  IMAGE_EXPORT_INVALID_REQUEST = 'IMAGE_EXPORT_INVALID_REQUEST',
  /** The single main-side export lock is already held. */
  IMAGE_EXPORT_BUSY = 'IMAGE_EXPORT_BUSY',
  /** ENOENT / EACCES on the source, or it is not inside the open project. */
  IMAGE_EXPORT_SOURCE_UNREADABLE = 'IMAGE_EXPORT_SOURCE_UNREADABLE',
  /** Source file exceeds the 50 MB read cap. */
  IMAGE_EXPORT_SOURCE_TOO_LARGE = 'IMAGE_EXPORT_SOURCE_TOO_LARGE',
  /** Header parse produced no dimensions, or the harness could not decode. */
  IMAGE_EXPORT_DECODE_FAILED = 'IMAGE_EXPORT_DECODE_FAILED',
  /** Declared or decoded pixel count exceeds the output cap. */
  IMAGE_EXPORT_OUTPUT_TOO_LARGE = 'IMAGE_EXPORT_OUTPUT_TOO_LARGE',
  /** An SVG's intrinsic size multiplied by the 2x factor exceeds the cap. */
  IMAGE_EXPORT_SVG_TOO_LARGE = 'IMAGE_EXPORT_SVG_TOO_LARGE',
  /** Either side exceeds the PDF format's 200-inch page limit. */
  IMAGE_EXPORT_PDF_PAGE_TOO_LARGE = 'IMAGE_EXPORT_PDF_PAGE_TOO_LARGE',
  /** The produced PDF is not exactly one page of the requested geometry. */
  IMAGE_EXPORT_PDF_GEOMETRY_FAILED = 'IMAGE_EXPORT_PDF_GEOMETRY_FAILED',
  /** Decoded dimensions disagree with the largest entry in the .ico directory. */
  IMAGE_EXPORT_ICO_SIZE_MISMATCH = 'IMAGE_EXPORT_ICO_SIZE_MISMATCH',
  /** The chosen destination resolves to the source image, or cannot be proven not to. */
  IMAGE_EXPORT_SOURCE_COLLISION = 'IMAGE_EXPORT_SOURCE_COLLISION',
  /** Writing the exported file threw. */
  IMAGE_EXPORT_WRITE_FAILED = 'IMAGE_EXPORT_WRITE_FAILED',
  /** The OS clipboard rejected the image, or the decoded image was empty. */
  IMAGE_EXPORT_CLIPBOARD_FAILED = 'IMAGE_EXPORT_CLIPBOARD_FAILED',
  /** Catch-all, including harness timeout and hidden-window load failure. */
  IMAGE_EXPORT_FAILED = 'IMAGE_EXPORT_FAILED',

  // Open in default browser errors (Issue #124) – `browser:openFile` refusals
  OPEN_IN_BROWSER_INVALID_REQUEST = 'OPEN_IN_BROWSER_INVALID_REQUEST',
  OPEN_IN_BROWSER_NO_PROJECT = 'OPEN_IN_BROWSER_NO_PROJECT',
  OPEN_IN_BROWSER_OUTSIDE_PROJECT = 'OPEN_IN_BROWSER_OUTSIDE_PROJECT',
  OPEN_IN_BROWSER_NOT_HTML = 'OPEN_IN_BROWSER_NOT_HTML',
  OPEN_IN_BROWSER_MISSING = 'OPEN_IN_BROWSER_MISSING',
  OPEN_IN_BROWSER_LAUNCH_FAILED = 'OPEN_IN_BROWSER_LAUNCH_FAILED',

  // Screenshot capture errors
  SCREENSHOT_PERMISSION_DENIED = 'SCREENSHOT_PERMISSION_DENIED',
  SCREENSHOT_TIMEOUT = 'SCREENSHOT_TIMEOUT',
  SCREENSHOT_CANCELLED = 'SCREENSHOT_CANCELLED',
  SCREENSHOT_FAILED = 'SCREENSHOT_FAILED',
  SCREENSHOT_NOT_SUPPORTED = 'SCREENSHOT_NOT_SUPPORTED',
  SCREENSHOT_OVERLAY_FAILED = 'SCREENSHOT_OVERLAY_FAILED',
  SCREENSHOT_WINDOW_NOT_FOUND = 'SCREENSHOT_WINDOW_NOT_FOUND',
  SCREENSHOT_DISPLAY_NOT_FOUND = 'SCREENSHOT_DISPLAY_NOT_FOUND',

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
  EXTERNAL_FILE_MOVE_NOT_GRANTED = 'EXTERNAL_FILE_MOVE_NOT_GRANTED',
  EXTERNAL_FILE_MOVE_CANCELLED = 'EXTERNAL_FILE_MOVE_CANCELLED',
  EXTERNAL_FILE_MOVE_CHANGED = 'EXTERNAL_FILE_MOVE_CHANGED',
  EXTERNAL_FILE_SAME_FILE = 'EXTERNAL_FILE_SAME_FILE',
  EXTERNAL_FILE_MOVE_SYMLINK = 'EXTERNAL_FILE_MOVE_SYMLINK',
  EXTERNAL_FILE_SOURCE_CHANGED = 'EXTERNAL_FILE_SOURCE_CHANGED',
  EXTERNAL_FILE_IN_PROJECT = 'EXTERNAL_FILE_IN_PROJECT',

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

  // Local Whisper errors (Issue #111)
  WHISPER_BINARY_NOT_FOUND = 'WHISPER_BINARY_NOT_FOUND',
  WHISPER_BINARY_DOWNLOAD_FAILED = 'WHISPER_BINARY_DOWNLOAD_FAILED',
  WHISPER_MODEL_NOT_FOUND = 'WHISPER_MODEL_NOT_FOUND',
  WHISPER_MODEL_INTEGRITY_FAILED = 'WHISPER_MODEL_INTEGRITY_FAILED',
  WHISPER_MODEL_CHANGED_DURING_CHECK = 'WHISPER_MODEL_CHANGED_DURING_CHECK',
  WHISPER_MODEL_DOWNLOAD_FAILED = 'WHISPER_MODEL_DOWNLOAD_FAILED',
  WHISPER_PROCESS_FAILED = 'WHISPER_PROCESS_FAILED',
  WHISPER_PROCESS_TIMEOUT = 'WHISPER_PROCESS_TIMEOUT',
  WHISPER_OUTPUT_PARSE_FAILED = 'WHISPER_OUTPUT_PARSE_FAILED',
  WHISPER_UNSUPPORTED_PLATFORM = 'WHISPER_UNSUPPORTED_PLATFORM',
  /** A pinned whisper artifact's on-disk SHA-256 doesn't match source pin. */
  WHISPER_BINARY_TAMPERED = 'WHISPER_BINARY_TAMPERED',
  /** The audio file path failed argv-hardening validation. */
  WHISPER_INVALID_PATH = 'WHISPER_INVALID_PATH',
  /** The current CPU lacks the minimum required instruction-set features. */
  WHISPER_CPU_UNSUPPORTED = 'WHISPER_CPU_UNSUPPORTED',
  /**
   * Manifest signature verification failed, manifest JSON is malformed, or
   * dual-pubkey trust chain is broken. Distinct from download-I/O failure.
   */
  WHISPER_MANIFEST_INVALID = 'WHISPER_MANIFEST_INVALID',
  /**
   * Manifest's `revisionIndex` is strictly below the effective monotonic
   * floor (`max(MIN_REVISION_INDEX, lastSeenRevision)`). Defeats replay
   * of a legitimately-signed but superseded manifest.
   */
  WHISPER_DOWNGRADE_BLOCKED = 'WHISPER_DOWNGRADE_BLOCKED',
  /**
   * Manifest is signature-valid but its per-platform SHA doesn't match our
   * hard-coded source pin in `whisper-assets.ts`. Signals the source pin
   * was not bumped in lock-step with a new whisper binary release, OR the
   * release contents drifted after manifest generation. Fail-closed.
   */
  WHISPER_SOURCE_PIN_DRIFT = 'WHISPER_SOURCE_PIN_DRIFT',

  // Video import errors (Issue #110)
  VIDEO_NO_AUDIO_TRACK = 'VIDEO_NO_AUDIO_TRACK',
  VIDEO_EXTRACTION_FAILED = 'VIDEO_EXTRACTION_FAILED',
  VIDEO_FFMPEG_UNAVAILABLE = 'VIDEO_FFMPEG_UNAVAILABLE',

  // Preview errors (Issue #74)
  PREVIEW_HOST_NOT_APPROVABLE = 'PREVIEW_HOST_NOT_APPROVABLE',
  PREVIEW_CSP_INVALID = 'PREVIEW_CSP_INVALID',
  PREVIEW_LOCAL_FILE_MISSING = 'PREVIEW_LOCAL_FILE_MISSING',
  PREVIEW_VIEW_LIMIT_REACHED = 'PREVIEW_VIEW_LIMIT_REACHED',
  PREVIEW_ALLOWLIST_FULL = 'PREVIEW_ALLOWLIST_FULL',
  PREVIEW_READ_BUDGET_EXCEEDED = 'PREVIEW_READ_BUDGET_EXCEEDED',
  PREVIEW_LINK_BLOCKED = 'PREVIEW_LINK_BLOCKED',
  /**
   * `preview:open` refused the request before it reached the service: the
   * payload failed `PreviewOpenRequestSchema`. Named, rather than folded into
   * UNKNOWN_ERROR, so the renderer's log line says why — a 249-char path used
   * to fail here on Windows with nothing on screen (ids are bounded in the
   * renderer since v0.19.0, so length is no longer a cause).
   */
  PREVIEW_OPEN_INVALID_REQUEST = 'PREVIEW_OPEN_INVALID_REQUEST',
  /**
   * The band's own deadline on `preview:approveHost` passed without an answer.
   * NOT a refusal: the grant is written before the first await main makes, so
   * it is saved and takes effect on the next load; only the confirmation and
   * the automatic reload are missing.
   */
  PREVIEW_APPROVE_TIMED_OUT = 'PREVIEW_APPROVE_TIMED_OUT',
  /**
   * An open was abandoned because something newer overtook it — a project
   * switch, a close, a suspend, or another open for the same panel.
   *
   * Distinct from `PROJECT_NOT_FOUND`, which previously carried this meaning as
   * well as its own. The renderer could not tell "there is no project" from
   * "your open was superseded", so a benign race — the exact outcome the
   * staleness guard exists to produce — latched the panel into a failure banner
   * for the rest of its mount (lens review F27). This is a no-op for the
   * renderer, not a failure.
   */
  PREVIEW_OPEN_SUPERSEDED = 'PREVIEW_OPEN_SUPERSEDED',
  // `preview:navigate` refusals (Issue #124): target gone; target refused (outside,
  // not HTML, opens as source); no view here or suspended; stale or already pending
  PREVIEW_NAV_TARGET_MISSING = 'PREVIEW_NAV_TARGET_MISSING',
  PREVIEW_NAV_TARGET_REFUSED = 'PREVIEW_NAV_TARGET_REFUSED',
  PREVIEW_NAV_UNAVAILABLE = 'PREVIEW_NAV_UNAVAILABLE',
  PREVIEW_NAV_SKIPPED = 'PREVIEW_NAV_SKIPPED',

  // HTML Preview comments (design §8); meanings in main/services/preview/comments/commentRefusals.ts
  COMMENT_TARGET_MOVED = 'COMMENT_TARGET_MOVED',
  COMMENT_BLOCK_CHANGED = 'COMMENT_BLOCK_CHANGED',
  COMMENT_ENCODING_UNSUPPORTED = 'COMMENT_ENCODING_UNSUPPORTED',
  COMMENT_FILE_CONFLICTED = 'COMMENT_FILE_CONFLICTED',
  COMMENT_DRAFT_EXPIRED = 'COMMENT_DRAFT_EXPIRED',
  COMMENT_KEY_INVALID = 'COMMENT_KEY_INVALID',
  COMMENT_IDENTITY_REQUIRED = 'COMMENT_IDENTITY_REQUIRED',
  COMMENT_LIMIT = 'COMMENT_LIMIT',
  COMMENT_FILE_TOO_LARGE = 'COMMENT_FILE_TOO_LARGE',
  COMMENT_WRITE_REFUSED_LINK = 'COMMENT_WRITE_REFUSED_LINK',
  COMMENT_WRITE_UNSUPPORTED_FS = 'COMMENT_WRITE_UNSUPPORTED_FS',
  COMMENT_UNSAVED_SOURCE = 'COMMENT_UNSAVED_SOURCE',
  COMMENT_FILE_GONE = 'COMMENT_FILE_GONE',
  COMMENT_PATH_REFUSED = 'COMMENT_PATH_REFUSED',
  COMMENT_FILE_READ_ONLY = 'COMMENT_FILE_READ_ONLY',
  COMMENT_WRITE_FAILED = 'COMMENT_WRITE_FAILED',
  COMMENT_SAVE_PENDING = 'COMMENT_SAVE_PENDING',
  COMMENT_RENDER_CHANGED = 'COMMENT_RENDER_CHANGED',

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
export {
  UNSAFE_TOOL_REASONS,
  UNSAFE_TOOL_NAMES,
  type UnsafeToolReason,
  type UnsafeToolName,
  type UnsafeToolInfo
} from './unsafeTool'

const UNSAFE_REASON_TEXT: Record<UnsafeToolReason, { what: string; fix: string }> = {
  project: { what: 'is in the open project', fix: 'Remove that folder from PATH, then try again.' },
  temp: { what: 'is in a temporary folder', fix: 'Remove that folder from PATH, then try again.' },
  network: {
    what: 'would be looked up on a network share listed in PATH',
    fix: 'Remove the network share from PATH, or move it after the local folder, then try again.'
  },
  relative: { what: 'comes from a relative PATH entry', fix: 'Remove that entry from PATH, then try again.' },
  unresolvable: {
    what: 'could not be checked, because its real location cannot be resolved',
    fix: 'Reinstall it in its default folder, then try again.'
  },
  ambiguous: {
    what: 'has copies in more than one PATH folder, and Erfana cannot tell which one would run',
    fix: 'Remove the extra copy from PATH, then try again.'
  }
}

/**
 * Why Erfana will not run LibreOffice (#250), naming the tool or the helper
 * (`which`, `powershell`) at fault, the reason and its fix. Never carries the
 * path. The single wording source: the conversion refusal in main, the
 * Settings → Import tools hint and the import refusal dialog all use it, so
 * they cannot disagree.
 */
export function untrustedToolMessage(tool: string, reason: UnsafeToolReason): string {
  const who = tool === 'which' || tool === 'powershell' ? `the ${tool} program LiteParse uses to find LibreOffice` : tool
  const { what, fix } = UNSAFE_REASON_TEXT[reason]
  return `Erfana will not run LibreOffice: ${who} ${what}. ${fix}`
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // Path validation errors
  [ErrorCode.PATH_INVALID]: 'The selected path is invalid',
  [ErrorCode.PATH_NOT_ABSOLUTE]: 'Please select an absolute path',
  [ErrorCode.PATH_SYSTEM_DIR]: 'System directories cannot be opened as projects',
  [ErrorCode.PATH_NOT_ACCESSIBLE]: 'Cannot access the selected directory. Please check permissions.',
  [ErrorCode.PATH_TRAVERSAL]: 'Invalid path: path traversal detected',
  [ErrorCode.PATH_OUTSIDE_PROJECT]: 'Cannot access directories outside the project',
  [ErrorCode.SYMLINK_ATTACK]: 'This directory link points to a protected location',
  [ErrorCode.INVALID_FILENAME]: 'Filename is not allowed on this platform',

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
  [ErrorCode.IMPORT_EXCEEDS_SIZE_LIMIT]: 'File exceeds the maximum import size',
  [ErrorCode.IMPORT_CONVERSION_FAILED]: 'Failed to convert file',
  [ErrorCode.IMPORT_UNSUPPORTED_TYPE]: 'File type is not supported',
  [ErrorCode.IMPORT_TEXT_ENCODING_ERROR]: 'File has invalid text encoding',
  [ErrorCode.IMPORT_DIR_CREATE_FAILED]: 'Failed to create import directory',
  [ErrorCode.IMPORT_WRITE_FAILED]: 'Failed to write imported file',

  // Document import errors (Issue #132)
  [ErrorCode.IMPORT_DEPENDENCY_MISSING]: 'Required system tool is not installed. Check Settings for details.',
  [ErrorCode.IMPORT_OCR_FAILED]: 'OCR text recognition failed for some pages',
  [ErrorCode.IMPORT_PAGE_LIMIT_EXCEEDED]: 'Document exceeds the maximum page limit',
  [ErrorCode.IMPORT_TIMEOUT]: 'Document conversion timed out',
  [ErrorCode.IMPORT_BUSY]: 'A document import is already in progress',
  [ErrorCode.IMPORT_UNTRUSTED_TOOL]:
    'Erfana did not run LibreOffice: the copy it would use is in the open project, a temporary folder or a network share, or comes from a relative PATH entry. Remove that folder from PATH, then try again.',

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

  // Image export errors (Issue #73)
  [ErrorCode.IMAGE_EXPORT_CANCELLED]: 'Image export was cancelled',
  [ErrorCode.IMAGE_EXPORT_INVALID_REQUEST]: 'Invalid image export request',
  [ErrorCode.IMAGE_EXPORT_BUSY]: 'Another image export is already running',
  [ErrorCode.IMAGE_EXPORT_SOURCE_UNREADABLE]: 'Could not read this image – it may have been moved or deleted',
  [ErrorCode.IMAGE_EXPORT_SOURCE_TOO_LARGE]: 'This image is over the 50 MB export limit',
  [ErrorCode.IMAGE_EXPORT_DECODE_FAILED]: 'Could not decode this image file',
  [ErrorCode.IMAGE_EXPORT_OUTPUT_TOO_LARGE]: 'Too many pixels to export – Erfana never shrinks an export, so nothing was written',
  [ErrorCode.IMAGE_EXPORT_SVG_TOO_LARGE]: 'This SVG renders too large at 2x to export, so nothing was written',
  [ErrorCode.IMAGE_EXPORT_PDF_PAGE_TOO_LARGE]: 'Too big for one PDF page (the limit is 200 inches per side) – export as PNG instead',
  [ErrorCode.IMAGE_EXPORT_PDF_GEOMETRY_FAILED]: 'The PDF page came out the wrong size, so nothing was written',
  [ErrorCode.IMAGE_EXPORT_ICO_SIZE_MISMATCH]: 'Could not export the largest size in this icon file',
  [ErrorCode.IMAGE_EXPORT_SOURCE_COLLISION]: 'That would overwrite the image you are exporting',
  [ErrorCode.IMAGE_EXPORT_WRITE_FAILED]: 'Could not write to that folder',
  [ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED]: 'The clipboard rejected the image',
  [ErrorCode.IMAGE_EXPORT_FAILED]: 'Image export failed',

  // Open in default browser (Issue #124); the renderer's toasts add the file name
  [ErrorCode.OPEN_IN_BROWSER_INVALID_REQUEST]: 'The request to open this file in a browser was rejected.',
  [ErrorCode.OPEN_IN_BROWSER_NO_PROJECT]: 'Open a project first – only its files open in a browser.',
  [ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT]: 'This file leads outside the open project, so Erfana will not open it in a browser.',
  [ErrorCode.OPEN_IN_BROWSER_NOT_HTML]: 'This is not an HTML page. Only .html and .htm files can be opened in a browser.',
  [ErrorCode.OPEN_IN_BROWSER_MISSING]: 'This file is no longer there – it may have been moved or deleted.',
  [ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED]: 'Your browser did not start. Try again, or reveal the file and open it yourself.',

  // Screenshot capture errors
  [ErrorCode.SCREENSHOT_PERMISSION_DENIED]: 'Screen recording permission required. Grant access in System Settings > Privacy & Security.',
  [ErrorCode.SCREENSHOT_TIMEOUT]: 'Screenshot capture timed out',
  [ErrorCode.SCREENSHOT_CANCELLED]: 'Screenshot capture was cancelled',
  [ErrorCode.SCREENSHOT_FAILED]: 'Failed to capture screenshot',
  [ErrorCode.SCREENSHOT_NOT_SUPPORTED]: 'Screenshot capture is not supported on this platform',
  [ErrorCode.SCREENSHOT_OVERLAY_FAILED]: 'Could not open the screenshot selection overlay',
  [ErrorCode.SCREENSHOT_WINDOW_NOT_FOUND]: 'The selected window is no longer available',
  [ErrorCode.SCREENSHOT_DISPLAY_NOT_FOUND]: 'The selected display is no longer available',

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
  [ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED]:
    'Moving needs a file chosen with the Add files dialog; copy the file instead',
  [ErrorCode.EXTERNAL_FILE_MOVE_CANCELLED]: 'Move cancelled',
  [ErrorCode.EXTERNAL_FILE_MOVE_CHANGED]: 'The files changed while waiting; nothing was moved',
  [ErrorCode.EXTERNAL_FILE_SAME_FILE]: 'The file is already there',
  [ErrorCode.EXTERNAL_FILE_MOVE_SYMLINK]: 'A link can be copied but not moved; copy it instead',
  [ErrorCode.EXTERNAL_FILE_SOURCE_CHANGED]:
    'The original changed during the move, so it was left in place; the copy was kept',
  [ErrorCode.EXTERNAL_FILE_IN_PROJECT]: 'This file is already in the project; move it from the project tree',

  // Transcription errors (Issue #75)
  [ErrorCode.TRANSCRIPTION_NO_API_KEY]: 'No API key configured. Add your OpenAI API key in Settings.',
  [ErrorCode.TRANSCRIPTION_INVALID_API_KEY]: 'Invalid API key. Please check your OpenAI API key in Settings.',
  [ErrorCode.TRANSCRIPTION_API_ERROR]: 'OpenAI API error. Please try again.',
  [ErrorCode.TRANSCRIPTION_RATE_LIMITED]: 'API rate limit reached. Retrying automatically.',
  [ErrorCode.TRANSCRIPTION_NETWORK_ERROR]: 'Network error. Please check your connection and try again.',
  [ErrorCode.TRANSCRIPTION_CANCELLED]: 'Transcription was cancelled',
  [ErrorCode.TRANSCRIPTION_INVALID_AUDIO]: 'Invalid audio file. Supported formats: MP3, WAV, M4A, OGG, FLAC.',
  [ErrorCode.TRANSCRIPTION_CHUNK_FAILED]: 'Failed to process audio chunk. Retrying.',
  [ErrorCode.TRANSCRIPTION_TIMEOUT]: 'Transcription request timed out',
  [ErrorCode.TRANSCRIPTION_FAILED]: 'Transcription failed. Please try again.',

  // Local Whisper errors (Issue #111)
  [ErrorCode.WHISPER_BINARY_NOT_FOUND]: 'Whisper binary not found. Please download it from Settings.',
  [ErrorCode.WHISPER_BINARY_DOWNLOAD_FAILED]: 'Failed to download whisper binary. Please check your connection and try again.',
  [ErrorCode.WHISPER_MODEL_NOT_FOUND]: 'Whisper model not found. Please download it from Settings.',
  [ErrorCode.WHISPER_MODEL_CHANGED_DURING_CHECK]: 'The whisper model file changed while it was being checked. Please try again.',
  [ErrorCode.WHISPER_MODEL_INTEGRITY_FAILED]: 'The whisper model failed its integrity check and was removed. Please download it again from Settings.',
  [ErrorCode.WHISPER_MODEL_DOWNLOAD_FAILED]: 'Failed to download whisper model. Please check your connection and try again.',
  [ErrorCode.WHISPER_PROCESS_FAILED]: 'Local transcription failed. Please try again or switch to OpenAI backend.',
  [ErrorCode.WHISPER_PROCESS_TIMEOUT]: 'Local transcription timed out. Try a smaller model or shorter file.',
  [ErrorCode.WHISPER_OUTPUT_PARSE_FAILED]: 'Failed to parse transcription output. Please try again.',
  [ErrorCode.WHISPER_UNSUPPORTED_PLATFORM]: 'Local Whisper is not supported on this platform.',
  [ErrorCode.WHISPER_BINARY_TAMPERED]: 'The local Whisper binary on disk has been modified or corrupted. Re-download it from Settings.',
  [ErrorCode.WHISPER_INVALID_PATH]: 'The audio file path is not supported by local Whisper. Use a regular local file path (no UNC, no Windows reserved names).',
  [ErrorCode.WHISPER_CPU_UNSUPPORTED]: 'Your CPU lacks the instruction-set features local Whisper requires. Use the OpenAI API backend instead.',
  [ErrorCode.WHISPER_MANIFEST_INVALID]: 'The local Whisper release manifest could not be verified. The download is blocked to protect integrity — please try again later or update Erfana.',
  [ErrorCode.WHISPER_DOWNGRADE_BLOCKED]: 'A newer local Whisper build was already installed here; refusing to replace it with an older one. Update Erfana to pick up the newest release.',
  [ErrorCode.WHISPER_SOURCE_PIN_DRIFT]: 'The local Whisper release on GitHub does not match the version Erfana expects. Update Erfana — this typically means your app is outdated.',

  // Video import errors (Issue #110)
  [ErrorCode.VIDEO_NO_AUDIO_TRACK]: 'This video file contains no audio track to transcribe.',
  [ErrorCode.VIDEO_EXTRACTION_FAILED]: 'Failed to extract audio from video file.',
  [ErrorCode.VIDEO_FFMPEG_UNAVAILABLE]: 'Video import requires ffmpeg which is not available.',

  // Preview errors (Issue #74)
  [ErrorCode.PREVIEW_HOST_NOT_APPROVABLE]: 'This host cannot be approved for preview.',
  [ErrorCode.PREVIEW_CSP_INVALID]: 'The preview security policy is invalid; the page was not served.',
  // The path must stay quoted: redactUserInput's QUOTED_SPAN redacts only the
  // span between the first and last '"', so an unquoted path would survive.
  [ErrorCode.PREVIEW_LOCAL_FILE_MISSING]: '"<path>" could not be read',
  [ErrorCode.PREVIEW_VIEW_LIMIT_REACHED]: 'A preview is already open.',
  [ErrorCode.PREVIEW_ALLOWLIST_FULL]: 'The preview host allowlist is full.',
  [ErrorCode.PREVIEW_READ_BUDGET_EXCEEDED]:
    'The preview asked for too many files at once; some were not loaded.',
  [ErrorCode.PREVIEW_LINK_BLOCKED]: 'That link was blocked.',
  [ErrorCode.PREVIEW_OPEN_INVALID_REQUEST]: 'The preview request was rejected.',
  [ErrorCode.PREVIEW_APPROVE_TIMED_OUT]: 'Saved, but the preview did not confirm. Reload it.',
  [ErrorCode.PREVIEW_OPEN_SUPERSEDED]: 'The preview was replaced before it finished opening.',
  // Same-tab navigation (Issue #124); the renderer's toasts add the file names
  [ErrorCode.PREVIEW_NAV_TARGET_MISSING]: 'That page is no longer there – it may have been moved or deleted.',
  [ErrorCode.PREVIEW_NAV_TARGET_REFUSED]: 'That page cannot be shown as a preview here.',
  [ErrorCode.PREVIEW_NAV_UNAVAILABLE]: 'This preview is not ready. Try again in a moment.',
  [ErrorCode.PREVIEW_NAV_SKIPPED]: 'This tab was still loading another page.',

  // HTML Preview comments, as §10.10 words them; `{file}` is the file's name, filled by the comment window
  [ErrorCode.COMMENT_TARGET_MOVED]: 'This element changed in the file since you picked it. Close and pick it again – your text will be restored.',
  [ErrorCode.COMMENT_BLOCK_CHANGED]: 'This comment changed on disk. Erfana reloaded it – try again.',
  [ErrorCode.COMMENT_ENCODING_UNSUPPORTED]: 'Erfana can only add comments to UTF-8 files.',
  [ErrorCode.COMMENT_FILE_CONFLICTED]: '{file} has unresolved git conflicts. Resolve them first.',
  [ErrorCode.COMMENT_DRAFT_EXPIRED]: 'This comment window was open too long. Pick the element again – your text is kept.',
  [ErrorCode.COMMENT_KEY_INVALID]: 'This window is out of date – the comment changed or was removed. Close it and open the comment again.',
  [ErrorCode.COMMENT_IDENTITY_REQUIRED]: 'Enter a name to add comments.',
  [ErrorCode.COMMENT_LIMIT]: 'This would go over a comment size limit, so nothing was saved.',
  [ErrorCode.COMMENT_FILE_TOO_LARGE]: 'Erfana adds comments only to files of up to 25 MB and 640,000 elements.',
  [ErrorCode.COMMENT_WRITE_REFUSED_LINK]: "{file} is a link to another file, so Erfana won't write to it.",
  [ErrorCode.COMMENT_WRITE_UNSUPPORTED_FS]: "Erfana can't write to {file} on this drive.",
  [ErrorCode.COMMENT_UNSAVED_SOURCE]: "{file} has unsaved changes in another tab. Save them first so your edits and this comment don't overwrite each other.",
  [ErrorCode.COMMENT_FILE_GONE]: '{file} no longer exists. Copy your text before closing.',
  [ErrorCode.COMMENT_PATH_REFUSED]: "Erfana doesn't write comments to this file.",
  [ErrorCode.COMMENT_FILE_READ_ONLY]: "Couldn't save: {file} is read-only. Your text is still here.",
  [ErrorCode.COMMENT_WRITE_FAILED]: "Couldn't save the comment. Your text is still here – try again.",
  [ErrorCode.COMMENT_SAVE_PENDING]: 'Still saving to {file}. Your comment appears here once it is written – no need to save again.',
  [ErrorCode.COMMENT_RENDER_CHANGED]: "Erfana can't add a comment here without changing how {file} looks in the preview, so nothing was saved. Your text is still here.",

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

  // An error that crossed IPC is a plain Error; main marks the code on the end of its message
  const carried = errorCodeInMessage(error)
  if (carried) {
    return ERROR_MESSAGES[carried]
  }

  // Security: Don't expose raw error messages - return generic message
  // Internal details are logged separately, not sent to renderer
  return ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR]
}

/**
 * What to show a person for a failed operation, in a toast or inline: the
 * friendly text of the error's code when it has one (an `AppError`, or an error
 * that crossed IPC with its code marked), otherwise its message without the
 * Electron prefix and code marker.
 */
export function getDisplayMessage(error: unknown): string {
  const code = error instanceof AppError ? error.code : errorCodeInMessage(error)
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code]
  }
  if (error instanceof Error) return cleanErrorMessage(error.message)
  if (typeof error === 'string') return cleanErrorMessage(error)
  return String(error)
}

/** The code main marked on the end of an error's message (see errorCodeMarker.ts), if any. */
export function errorCodeInMessage(error: unknown): ErrorCode | null {
  if (!(error instanceof Error)) return null
  const match = ERROR_CODE_MARKER_PATTERN.exec(error.message)
  if (!match) return null
  return (Object.values(ErrorCode) as string[]).includes(match[1]) ? (match[1] as ErrorCode) : null
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

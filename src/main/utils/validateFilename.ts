/**
 * Filename validation + safe-derivation for cross-platform file operations.
 *
 * Two entry-point contracts, picked by caller intent (not by what is checked):
 *
 *   - `assertValidUserFilename(name)` — for user-typed input. Throws
 *     `AppError(INVALID_FILENAME)` on invalid; the caller surfaces the error
 *     to the user (toast, dialog, etc.). Use at `FileService.createFile/
 *     createFolder/rename` call sites.
 *
 *   - `deriveSafeFilename(name)` — for app-derived paths. Total function:
 *     always returns a safe string, silently transforms invalid inputs
 *     (prepends `_` for reserved names, strips invalid chars, etc.). Use at
 *     `PdfService.getSavePath` / `DocxService.sanitizeFilename` call sites.
 *
 * Naming follows "what to do" (imperative verb), not "what is checked" — a
 * maintainer picking between the two does not have to read JSDoc to know
 * which path throws vs. transforms.
 *
 * See #161 (Phase 2 Windows enablement — reserved filename guard).
 *
 * ## Operation-order invariant (pinned by `validateFilename.test.ts`)
 *
 * The pipeline order is load-bearing; any reorder silently changes output
 * for some inputs:
 *
 *   1. strip leading dots        (Unix-hidden / Windows-problematic)
 *   2. strip invalid chars       (`<>:"/\|?*` on Windows only)
 *   3. strip bidi overrides      (security — both platforms)
 *   4. strip trailing dots       (Windows only)
 *   5. strip trailing spaces     (Windows only)
 *   6. trim                      (whitespace around the whole name)
 *   7. handle reserved basename  (prepend `_` on Windows only)
 *   8. enforce max length        (truncate)
 *   9. fall back to 'untitled'   (empty-after-all-above)
 *
 * The original `DocxService.sanitizeFilename` at `DocxService.ts:221-244`
 * (pre-#161) used steps 1–7 above in that order; this module preserves
 * that order and adds steps 3 (bidi) and 9 (empty fallback).
 */

import { AppError, ErrorCode } from '../../shared/errors'

/**
 * Reserved basenames on Windows. Case-insensitive. Apply with or without
 * extension (e.g. `CON`, `CON.md`, `con.txt` are all reserved).
 *
 * @see https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
 */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

/** Max filename length (bytes on ext4/NTFS; chars on HFS+). Conservative common denominator. */
const MAX_FILENAME_LENGTH = 255

/** Windows-forbidden chars: reserved on all Windows filesystems. */
// eslint-disable-next-line no-useless-escape
const WIN_INVALID_CHARS = /[<>:"/\\|?*]/g

/** Control chars (C0: 0x00-0x1F) — portable security concern on any OS. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f]/g

/**
 * Unicode bidi-override chars that enable right-to-left override attacks.
 * Example: `codrlo‮gnp.exe` displays as `codexe.png` but executes.
 * See https://trojansource.codes for the canonical vulnerability class.
 */
// eslint-disable-next-line no-misleading-character-class
const BIDI_OVERRIDES = /[‪-‮⁦-⁩‎‏]/g

const DEFAULT_FALLBACK = 'untitled'

export type FilenameValidation =
  | { valid: true }
  | {
      valid: false
      reason:
        | 'reserved'
        | 'invalid_chars'
        | 'control_chars'
        | 'bidi_override'
        | 'trailing_dots'
        | 'trailing_spaces'
        | 'too_long'
        | 'empty'
      suggestion?: string
    }

/**
 * Pure inspection — used internally by both entry points and directly by
 * tests. Does not throw; does not transform.
 *
 * @param name - The candidate filename (basename only, not a path).
 * @returns `{ valid: true }` if the name is acceptable on the current
 * platform; otherwise `{ valid: false, reason, suggestion? }`.
 */
export function validateFilename(name: string): FilenameValidation {
  if (!name || !name.trim()) {
    return { valid: false, reason: 'empty' }
  }

  // Bidi overrides — both platforms (security).
  if (BIDI_OVERRIDES.test(name)) {
    BIDI_OVERRIDES.lastIndex = 0 // reset stateful regex
    return { valid: false, reason: 'bidi_override' }
  }
  BIDI_OVERRIDES.lastIndex = 0

  // Control chars — both platforms.
  if (CONTROL_CHARS.test(name)) {
    CONTROL_CHARS.lastIndex = 0
    return { valid: false, reason: 'control_chars' }
  }
  CONTROL_CHARS.lastIndex = 0

  // Length — both platforms.
  if (name.length > MAX_FILENAME_LENGTH) {
    return { valid: false, reason: 'too_long' }
  }

  // --- Windows-only checks below ---
  if (process.platform === 'win32') {
    if (WIN_INVALID_CHARS.test(name)) {
      WIN_INVALID_CHARS.lastIndex = 0
      return { valid: false, reason: 'invalid_chars' }
    }
    WIN_INVALID_CHARS.lastIndex = 0

    if (/\.+$/.test(name)) {
      return { valid: false, reason: 'trailing_dots' }
    }

    if (/\s+$/.test(name)) {
      return { valid: false, reason: 'trailing_spaces' }
    }

    const baseName = name.split('.')[0].toUpperCase()
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
      return { valid: false, reason: 'reserved', suggestion: `_${name}` }
    }
  }

  return { valid: true }
}

/**
 * User-typed-input path. Validates per current platform; throws
 * `AppError(INVALID_FILENAME)` on invalid so the caller can surface the
 * error to the user.
 */
export function assertValidUserFilename(name: string): void {
  const result = validateFilename(name)
  if (result.valid) return

  const reasonSuffix =
    result.reason === 'reserved'
      ? ` — try "${result.suggestion}"`
      : result.reason === 'invalid_chars'
        ? ' — remove the characters < > : " / \\ | ? *'
        : result.reason === 'bidi_override'
          ? ' — contains Unicode direction-override characters (security risk)'
          : result.reason === 'control_chars'
            ? ' — contains non-printable characters'
            : result.reason === 'trailing_dots'
              ? ' — remove trailing dot(s)'
              : result.reason === 'trailing_spaces'
                ? ' — remove trailing space(s)'
                : result.reason === 'too_long'
                  ? ` — must be 255 characters or fewer (got ${name.length})`
                  : ' — filename must not be empty'

  const displayName = name.length > 40 ? `${name.slice(0, 37)}...` : name
  throw new AppError(`"${displayName}" is not a valid filename${reasonSuffix}`, ErrorCode.INVALID_FILENAME)
}

/**
 * App-derived output path. Always returns a safe filename — transforms
 * invalid inputs (strips invalid chars, prepends `_` for reserved, etc.).
 * Total function; never throws.
 *
 * For empty/whitespace-only input (or input that reduces to empty after
 * transformations), returns the provided `fallback` (defaults to `'untitled'`).
 * Callers with their own canonical empty-fallback (e.g. `DocxService`'s
 * `'document'`) should pass it explicitly.
 */
export function deriveSafeFilename(name: string, fallback: string = DEFAULT_FALLBACK): string {
  // Step 1: strip leading dots (Unix-hidden / Windows-problematic).
  let safe = name.replace(/^\.+/, '')

  // Step 2: strip Windows-invalid chars (on all platforms — we want the
  // derived name to be portable to Windows even if we're on POSIX).
  safe = safe.replace(WIN_INVALID_CHARS, '-')

  // Step 3: strip control chars + bidi overrides (security, both platforms).
  safe = safe.replace(CONTROL_CHARS, '').replace(BIDI_OVERRIDES, '')

  // Step 4: strip trailing dots (Windows strips them anyway).
  safe = safe.replace(/\.+$/, '')

  // Step 5: strip trailing spaces (Windows strips them).
  safe = safe.replace(/\s+$/, '')

  // Step 6: trim whitespace.
  safe = safe.trim()

  // Step 7: handle Windows-reserved basename (prepend `_`).
  if (safe) {
    const baseName = safe.split('.')[0].toUpperCase()
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
      safe = `_${safe}`
    }
  }

  // Step 8: enforce max length.
  if (safe.length > MAX_FILENAME_LENGTH) {
    safe = safe.substring(0, MAX_FILENAME_LENGTH)
  }

  // Step 9: empty fallback (caller-provided or DEFAULT_FALLBACK).
  if (!safe) {
    safe = fallback
  }

  return safe
}

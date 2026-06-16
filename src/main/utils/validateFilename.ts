// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
 * **Cross-platform contract asymmetry:**
 *
 *   - `assertValidUserFilename` respects `process.platform` — Windows-only
 *     rules (reserved names, `<>:"/\|?*`, trailing dots/spaces) are no-ops
 *     on POSIX so existing macOS/Linux files like `Q4: report?.md` still
 *     validate. Universal rules (control chars, bidi overrides, empty,
 *     length) reject on every platform.
 *   - `deriveSafeFilename` applies Windows-strict rules **on every platform**
 *     by design. The output is intended to be portable to Windows even when
 *     it is generated on POSIX (e.g. PDF/DOCX exports from a macOS dev
 *     machine that may later be opened on a Windows box).
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
 *   9. fall back to caller-supplied default (empty-after-all-above)
 *
 * The original `DocxService.sanitizeFilename` at `DocxService.ts:221-244`
 * (pre-#161) used steps 1–7 above in that order; this module preserves
 * that order and adds steps 3 (bidi) and 9 (empty fallback).
 */

import { AppError, ErrorCode, INVALID_FILENAME_MARKER } from '../../shared/errors'

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

/**
 * Windows-forbidden chars: reserved on all Windows filesystems.
 * Non-stateful (no `/g` flag) — `.test()` semantics are simple boolean,
 * `.replace()` callers in `deriveSafeFilename` use a fresh regex literal.
 */
 
const WIN_INVALID_CHARS = /[<>:"/\\|?*]/

/** Control chars (C0: 0x00-0x1F) — portable security concern on any OS. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f]/

/**
 * Unicode bidi-override + direction-mark chars that enable RTL spoofing
 * (Trojan Source vulnerability class). A filename like `cod‮gnp.exe`
 * displays as `codexe.png` but executes as `codgnp.exe`.
 *
 * Covers all six classes:
 *   - U+202A LRE   - LEFT-TO-RIGHT EMBEDDING
 *   - U+202B RLE   - RIGHT-TO-LEFT EMBEDDING
 *   - U+202C PDF   - POP DIRECTIONAL FORMATTING
 *   - U+202D LRO   - LEFT-TO-RIGHT OVERRIDE
 *   - U+202E RLO   - RIGHT-TO-LEFT OVERRIDE
 *   - U+2066 LRI   - LEFT-TO-RIGHT ISOLATE
 *   - U+2067 RLI   - RIGHT-TO-LEFT ISOLATE
 *   - U+2068 FSI   - FIRST STRONG ISOLATE
 *   - U+2069 PDI   - POP DIRECTIONAL ISOLATE
 *   - U+200E LRM   - LEFT-TO-RIGHT MARK
 *   - U+200F RLM   - RIGHT-TO-LEFT MARK
 *
 * Uses **hex escapes + `u` flag** for engine-consistent code-point matching.
 * Without the `u` flag, JS treats supplementary-plane chars as surrogate
 * halves and these BMP ranges may not match in some runtimes.
 */
const BIDI_OVERRIDES = /[‪-‮⁦-⁩‎‏]/u

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
    return { valid: false, reason: 'bidi_override' }
  }

  // Control chars — both platforms.
  if (CONTROL_CHARS.test(name)) {
    return { valid: false, reason: 'control_chars' }
  }

  // Length — both platforms.
  if (name.length > MAX_FILENAME_LENGTH) {
    return { valid: false, reason: 'too_long' }
  }

  // --- Windows-only checks below ---
  if (process.platform === 'win32') {
    if (WIN_INVALID_CHARS.test(name)) {
      return { valid: false, reason: 'invalid_chars' }
    }

    if (/\.+$/.test(name)) {
      return { valid: false, reason: 'trailing_dots' }
    }

    if (/\s+$/.test(name)) {
      return { valid: false, reason: 'trailing_spaces' }
    }

    // Trim leading whitespace before reserved-name check so `' CON.md'`
    // is correctly identified as reserved (Windows would treat it the
    // same way at the syscall layer — surrounding whitespace is stripped).
    const trimmed = name.trim()
    const baseName = trimmed.split('.')[0].toUpperCase()
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
      return { valid: false, reason: 'reserved', suggestion: `_${trimmed}` }
    }
  }

  return { valid: true }
}

/**
 * User-typed-input path. Validates per current platform; throws
 * `AppError(INVALID_FILENAME)` on invalid so the caller can surface the
 * error to the user.
 *
 * The thrown message starts with the well-known marker
 * `INVALID_FILENAME_MARKER` (exported from `shared/errors.ts`) so renderer
 * formatters can discriminate this error class without coupling to the
 * full English phrasing. Electron IPC strips `AppError.code`, but
 * `Error.message` survives intact — the marker is the contract bridge.
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

  // Display the user's input but cap at 40 chars to prevent toast bloat.
  // Whitespace-only inputs are shown with their original spacing for
  // diagnostic clarity (rather than the empty-after-trim version).
  const displayName = name.length > 40 ? `${name.slice(0, 37)}...` : name
  throw new AppError(
    `"${displayName}" ${INVALID_FILENAME_MARKER}${reasonSuffix}`,
    ErrorCode.INVALID_FILENAME,
  )
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
 *
 * **Note:** The `fallback` is returned **as-is** without sanitization.
 * Callers MUST pass a string that is already safe (no Windows-reserved
 * basename, no forbidden chars). Passing `'CON'` or `'foo<>'` produces
 * unsafe output.
 */
export function deriveSafeFilename(name: string, fallback: string = DEFAULT_FALLBACK): string {
  // Step 1: strip leading dots (Unix-hidden / Windows-problematic).
  let safe = name.replace(/^\.+/, '')

  // Step 2: strip Windows-invalid chars (on all platforms — we want the
  // derived name to be portable to Windows even if we're on POSIX).
  // Use a fresh `/g` regex literal each time to avoid any `lastIndex` state
  // leakage from the boolean-test regex above.
  safe = safe.replace(/[<>:"/\\|?*]/g, '-')

  // Step 3: strip control chars + bidi overrides (security, both platforms).
  // eslint-disable-next-line no-control-regex
  safe = safe.replace(/[\x00-\x1f]/g, '').replace(/[‪-‮⁦-⁩‎‏]/gu, '')

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

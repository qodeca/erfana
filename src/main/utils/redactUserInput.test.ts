// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { redactUserInput, redactedLogError, redactPath } from './redactUserInput'
import { AppError, ErrorCode, INVALID_FILENAME_MARKER } from '../../shared/errors'

const PLACEHOLDER = '[redacted-filename]'

describe('redactUserInput', () => {
  it('redacts the single quoted segment of an INVALID_FILENAME message', () => {
    // Mirrors a non-suffix-quote reason (e.g. control_chars / too_long).
    const filename = 'my secret report'
    const message = `"${filename}" ${INVALID_FILENAME_MARKER} — contains non-printable characters`

    const result = redactUserInput(message, ErrorCode.INVALID_FILENAME)

    expect(result).toContain(PLACEHOLDER)
    expect(result).not.toContain(filename)
    // Static prose survives.
    expect(result).toContain(INVALID_FILENAME_MARKER)
    expect(result).toContain('contains non-printable characters')
  })

  it('redacts BOTH quoted segments of the reserved-name message', () => {
    // reasonSuffix for `reserved` adds a second user-derived quoted segment.
    const filename = 'CON.md'
    const suggestion = '_CON.md'
    const message = `"${filename}" ${INVALID_FILENAME_MARKER} — try "${suggestion}"`

    const result = redactUserInput(message, ErrorCode.INVALID_FILENAME)

    expect(result).toContain(PLACEHOLDER)
    expect(result).not.toContain(filename)
    // The suggestion is derived from user input — it must not survive either.
    expect(result).not.toContain(suggestion)
    expect(result).not.toContain('CON')
  })

  it('does not leak a filename fragment when input contains an embedded quote', () => {
    // invalid_chars message embeds a STRAY single `"` in static prose, and a
    // Windows-invalid filename can itself contain `"`. Pairwise redaction would
    // mis-pair these and leak the `b` between the quotes; the greedy span must not.
    const message =
      `"a"b" ${INVALID_FILENAME_MARKER} — remove the characters < > : " / \\ | ? *`

    const result = redactUserInput(message, ErrorCode.INVALID_FILENAME)

    expect(result).toContain(PLACEHOLDER)
    // No fragment of the user's filename (`a`, `b`, or the embedded quote run)
    // may survive. The only non-redacted text is static trailing prose.
    expect(result.startsWith(PLACEHOLDER)).toBe(true)
    expect(result).not.toMatch(/\bb\b/)
    expect(result).toBe(`${PLACEHOLDER} / \\ | ? *`)
  })

  it('covers filenames containing newlines (control chars)', () => {
    const message = `"line1\nline2" ${INVALID_FILENAME_MARKER} — contains non-printable characters`

    const result = redactUserInput(message, ErrorCode.INVALID_FILENAME)

    expect(result).not.toContain('line1')
    expect(result).not.toContain('line2')
    expect(result).toContain(PLACEHOLDER)
  })

  it('leaves messages for non-user-input codes unchanged', () => {
    const message = '"file.md" was not found on disk'

    expect(redactUserInput(message, ErrorCode.IMPORT_FILE_NOT_FOUND)).toBe(message)
    expect(redactUserInput(message, ErrorCode.UNKNOWN_ERROR)).toBe(message)
  })

  it('leaves messages unchanged when no code is supplied', () => {
    const message = '"file.md" is not a valid filename — remove trailing dot(s)'

    expect(redactUserInput(message, undefined)).toBe(message)
  })
})

describe('redactedLogError', () => {
  it('returns a fresh Error with a redacted message for INVALID_FILENAME', () => {
    const filename = 'leak me.md'
    const original = new AppError(
      `"${filename}" ${INVALID_FILENAME_MARKER} — remove trailing dot(s)`,
      ErrorCode.INVALID_FILENAME,
    )

    const logged = redactedLogError(original)

    expect(logged).toBeInstanceOf(Error)
    expect(logged).not.toBe(original)
    expect(logged?.message).toContain(PLACEHOLDER)
    expect(logged?.message).not.toContain(filename)
    // The stack must not re-leak the filename (Error.stack embeds the message).
    expect(logged?.stack ?? '').not.toContain(filename)
  })

  it('returns the ORIGINAL error (preserving stack) for non-user-input codes', () => {
    const original = new AppError('disk write failed', ErrorCode.IMPORT_WRITE_FAILED)

    const logged = redactedLogError(original)

    expect(logged).toBe(original)
  })

  it('returns the ORIGINAL error for a plain Error with no code', () => {
    const original = new Error('Invalid directory path')

    expect(redactedLogError(original)).toBe(original)
  })

  it('returns undefined for non-Error input', () => {
    expect(redactedLogError('a string')).toBeUndefined()
    expect(redactedLogError(undefined)).toBeUndefined()
    expect(redactedLogError(null)).toBeUndefined()
  })
})

describe('redactPath', () => {
  it('keeps only the basename for Windows-style absolute paths', () => {
    expect(redactPath('C:\\Users\\alice\\Documents\\secret-project')).toBe(
      '[redacted]/secret-project'
    )
  })

  it('keeps only the basename for POSIX-style absolute paths', () => {
    expect(redactPath('/Users/alice/Documents/secret-project')).toBe('[redacted]/secret-project')
  })

  it('handles nested paths with multiple separators', () => {
    expect(redactPath('/Users/alice/Documents/secret-project/sub/dir')).toBe('[redacted]/dir')
  })

  it('passes through empty strings unchanged', () => {
    expect(redactPath('')).toBe('')
  })

  it('passes through single-segment values (no separator) unchanged', () => {
    expect(redactPath('myproject')).toBe('myproject')
  })

  it('handles trailing separators gracefully', () => {
    // Trailing slash causes pop() to yield '' as the tail, so the result is '[redacted]/'.
    // This is the documented behavior — callers should strip trailing separators before
    // logging, or accept that a trailing-slash path redacts to the prefix form.
    expect(redactPath('/Users/alice/proj/')).toBe('[redacted]/')
  })
})

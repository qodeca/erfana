// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * redactUserInput PREVIEW_LOCAL_FILE_MISSING tests (Issue #74, work items 1/2/20).
 *
 * The message template quotes the path (`"<path>" could not be read`) so
 * `redactUserInput`'s greedy first-quote-to-last-quote span redacts it. An
 * unquoted template would make the redaction a no-op — this pins that contract.
 */
import { describe, it, expect } from 'vitest'
import { redactUserInput } from './redactUserInput'
import { ErrorCode, ERROR_MESSAGES } from '../../shared/errors'

const PLACEHOLDER = '[redacted-filename]'

describe('redactUserInput PREVIEW_LOCAL_FILE_MISSING', () => {
  it('quotes the path in the message template (so redaction can act on it)', () => {
    const template = ERROR_MESSAGES[ErrorCode.PREVIEW_LOCAL_FILE_MISSING]
    // Must contain a quoted span for QUOTED_SPAN to redact.
    expect(template).toContain('"')
    expect(template).toMatch(/".*".*could not be read/)
  })

  it('redacts the quoted path with no path fragment surviving', () => {
    const secretPath = '/Users/alice/secret-project/notes.html'
    const message = `"${secretPath}" could not be read`

    const result = redactUserInput(message, ErrorCode.PREVIEW_LOCAL_FILE_MISSING)

    expect(result).toContain(PLACEHOLDER)
    expect(result).not.toContain(secretPath)
    expect(result).not.toContain('secret-project')
    // Static prose survives.
    expect(result).toContain('could not be read')
  })

  it('leaves the message untouched for an unrelated code', () => {
    const message = '"/Users/alice/x.html" could not be read'
    expect(redactUserInput(message, ErrorCode.UNKNOWN_ERROR)).toBe(message)
  })

  it('leaves the message untouched when no code is supplied', () => {
    const message = '"/Users/alice/x.html" could not be read'
    expect(redactUserInput(message)).toBe(message)
  })
})

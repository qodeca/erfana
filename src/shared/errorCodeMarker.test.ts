// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { withErrorCodeMarker } from './errorCodeMarker'
import { ERROR_MESSAGES, ErrorCode, errorCodeInMessage, getUserFriendlyMessage } from './errors'

describe('error code marker', () => {
  it('round-trips a code through an error message', () => {
    const error = new Error(withErrorCodeMarker('Refused', ErrorCode.PATH_SYSTEM_DIR))
    expect(error.message).toBe('Refused [PATH_SYSTEM_DIR]')
    expect(errorCodeInMessage(error)).toBe(ErrorCode.PATH_SYSTEM_DIR)
  })

  it('reads the code after the wrapping Electron adds to an IPC error', () => {
    const wrapped = new Error(
      "Error invoking remote method 'x': Error: Refused [PATH_SYSTEM_DIR]"
    )
    expect(errorCodeInMessage(wrapped)).toBe(ErrorCode.PATH_SYSTEM_DIR)
  })

  it.each([
    ['no marker', new Error('Refused')],
    ['an unknown code', new Error('Refused [NOT_A_CODE]')],
    ['a marker that is not last', new Error('[PATH_SYSTEM_DIR] Refused')],
    ['a value that is not an error', 'Refused [PATH_SYSTEM_DIR]']
  ])('finds no code in %s', (_name, value) => {
    expect(errorCodeInMessage(value)).toBeNull()
  })

  it('words a marked plain error from the code, and any other plain error generically', () => {
    expect(getUserFriendlyMessage(new Error('Refused [PATH_SYSTEM_DIR]'))).toBe(
      ERROR_MESSAGES[ErrorCode.PATH_SYSTEM_DIR]
    )
    expect(getUserFriendlyMessage(new Error('Refused'))).toBe(ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR])
  })
})

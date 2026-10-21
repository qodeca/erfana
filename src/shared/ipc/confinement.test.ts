// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Confinement codes – reading the refusal code back from a rejected `invoke`.
 */
import { describe, it, expect } from 'vitest'
import {
  CONFINEMENT_MESSAGES,
  OUTSIDE_PROJECT_CHANGE_MESSAGE,
  PROJECT_FOLDER_GONE_MESSAGE,
  confinementCodeFromMessage,
  type ConfinementErrorCode
} from './confinement'

const IPC_PREFIX = "Error invoking remote method 'file:writeFile': ConfinementError: "

describe('confinementCodeFromMessage', () => {
  const codes = Object.keys(CONFINEMENT_MESSAGES) as ConfinementErrorCode[]

  it.each(codes)('reads %s from its own message, bare or behind the IPC prefix', (code) => {
    expect(confinementCodeFromMessage(CONFINEMENT_MESSAGES[code])).toBe(code)
    expect(confinementCodeFromMessage(IPC_PREFIX + CONFINEMENT_MESSAGES[code])).toBe(code)
  })

  it('reads the messages a code is also thrown with', () => {
    expect(confinementCodeFromMessage(OUTSIDE_PROJECT_CHANGE_MESSAGE)).toBe('OUTSIDE_PROJECT')
    expect(confinementCodeFromMessage(IPC_PREFIX + PROJECT_FOLDER_GONE_MESSAGE)).toBe('NOT_FOUND')
  })

  it.each([
    '',
    'ENOENT: no such file or directory',
    "Error invoking remote method 'file:writeFile': Error: EACCES: permission denied",
    'Too big: expected string to have <=128 characters'
  ])('answers null for a message that is not a refusal: %j', (message) => {
    expect(confinementCodeFromMessage(message)).toBeNull()
  })

  it('has a distinct message per code, so one message names one code', () => {
    expect(new Set(Object.values(CONFINEMENT_MESSAGES)).size).toBe(codes.length)
  })
})

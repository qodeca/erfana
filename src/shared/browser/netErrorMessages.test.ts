// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NET_ERROR_MESSAGE,
  isCertificateError,
  netErrorCodeText,
  netErrorCodes,
  netErrorEntry,
  netErrorMessage,
  showsLoadErrorPage
} from './netErrorMessages'

describe('load-error messages (025-FR-059)', () => {
  it('maps the causes the spec names to one sentence each', () => {
    expect(netErrorMessage(-102)).toMatch(/refused the connection/)
    expect(netErrorMessage(-105)).toMatch(/could not be found/)
    expect(netErrorMessage(-118)).toMatch(/too long/)
    expect(netErrorMessage(-21)).toMatch(/network changed/)
  })

  it('falls back to a default sentence for an unknown code', () => {
    expect(netErrorMessage(-999)).toBe(DEFAULT_NET_ERROR_MESSAGE)
    expect(netErrorEntry(-999)).toBeNull()
  })

  it('shows the code with Chromium name', () => {
    expect(netErrorCodeText(-102)).toBe('ERR_CONNECTION_REFUSED (-102)')
    expect(netErrorCodeText(-999)).toBe('(-999)')
  })

  it('has one full sentence per code, all negative', () => {
    for (const code of netErrorCodes()) {
      expect(code).toBeLessThan(0)
      expect(netErrorMessage(code)).toMatch(/^[A-Z].*\.$/)
      expect(netErrorEntry(code)?.name).toMatch(/^[A-Z0-9_]+$/)
    }
  })

  it('shows no error page for an aborted load', () => {
    expect(showsLoadErrorPage(-3)).toBe(false)
    expect(showsLoadErrorPage(-102)).toBe(true)
  })

  it('names the certificate block, -200 to -299, and nothing else', () => {
    for (const code of [-200, -201, -202, -207, -299]) expect(isCertificateError(code)).toBe(true)
    for (const code of [-199, -300, -102, -3, 0, -200.5]) expect(isCertificateError(code)).toBe(false)
  })
})

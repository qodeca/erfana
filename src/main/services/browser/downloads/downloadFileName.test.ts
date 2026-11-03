// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The name a download is offered under (spec 025, 025-FR-020, S-18). */
import { describe, expect, it } from 'vitest'
import { DOWNLOAD_FALLBACK_NAME, DOWNLOAD_NAME_MAX_CHARS, sanitizeDownloadName } from './downloadFileName'

describe('sanitizeDownloadName', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\Windows\\system.ini', 'system.ini'],
    ['/abs/path/file.txt', 'file.txt'],
    ['dir/', DOWNLOAD_FALLBACK_NAME],
    ['', DOWNLOAD_FALLBACK_NAME],
    ['...', DOWNLOAD_FALLBACK_NAME],
    ['.hidden', 'hidden'],
    ['a<b>c:d"e|f?g*.txt', 'a-b-c-d-e-f-g-.txt'],
    ['trailing. . ', 'trailing'],
    ['CON', '_CON'],
    ['con.txt', '_con.txt'],
    ['NUL.tar.gz', '_NUL.tar.gz'],
    ['COM1', '_COM1'],
    ['lpt9.log', '_lpt9.log'],
    ['CON .txt', '_CON .txt'],
    ['CONSOLE.txt', 'CONSOLE.txt']
  ])('025-AC-020 %j → %j', (input, expected) => {
    expect(sanitizeDownloadName(input)).toBe(expected)
  })

  it('removes bidi overrides, so "…txt.exe" cannot be drawn as "…exe.txt" (S-18)', () => {
    expect(sanitizeDownloadName('invoice\u202Etxt.exe')).toBe('invoicetxt.exe')
  })

  it('removes invisible characters and turns control characters into spaces', () => {
    expect(sanitizeDownloadName('a\u0000b\u200Bc\nd.txt')).toBe('a bc d.txt')
  })

  it('cuts a long name in its stem and keeps the extension', () => {
    const name = sanitizeDownloadName(`${'x'.repeat(400)}.pdf`)
    expect(name).toHaveLength(DOWNLOAD_NAME_MAX_CHARS)
    expect(name.endsWith('.pdf')).toBe(true)
  })

  it('cuts a long name with a long tail as a whole, never inside a surrogate pair', () => {
    const name = sanitizeDownloadName(`${'😀'.repeat(150)}`)
    expect(name.length).toBeLessThanOrEqual(DOWNLOAD_NAME_MAX_CHARS)
    expect(name).not.toMatch(/[\ud800-\udbff]$/)
    expect(sanitizeDownloadName(`${'a'.repeat(300)}.${'b'.repeat(30)}`)).toHaveLength(DOWNLOAD_NAME_MAX_CHARS)
  })
})

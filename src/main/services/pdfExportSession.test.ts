// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

vi.mock('electron', () => ({ session: { fromPartition: vi.fn() } }))
vi.mock('./LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { buildPdfCsp, describeUrlForLog, isAllowedPdfRequest } from './pdfExportSession'

const PAGE = pathToFileURL(join(tmpdir(), 'erfana-pdf-abc', 'export.html')).href

describe('isAllowedPdfRequest', () => {
  it('allows exactly the temp page, ignoring query and fragment', () => {
    expect(isAllowedPdfRequest(PAGE, 'mainFrame', PAGE)).toBe(true)
    expect(isAllowedPdfRequest(`${PAGE}#top`, 'mainFrame', PAGE)).toBe(true)
  })

  it('refuses any other file URL', () => {
    const other = pathToFileURL(join(tmpdir(), 'erfana-pdf-abc', 'other.html')).href
    expect(isAllowedPdfRequest(other, 'image', PAGE)).toBe(false)
    expect(isAllowedPdfRequest(pathToFileURL(join(tmpdir(), 'x.png')).href, 'image', PAGE)).toBe(false)
  })

  it('allows data and https only as images; plain http is refused', () => {
    expect(isAllowedPdfRequest('data:image/png;base64,AAAA', 'image', PAGE)).toBe(true)
    expect(isAllowedPdfRequest('https://example.com/a.png', 'image', PAGE)).toBe(true)
    expect(isAllowedPdfRequest('http://example.com/a.png', 'image', PAGE)).toBe(false)
    expect(isAllowedPdfRequest('https://example.com/a.js', 'script', PAGE)).toBe(false)
    expect(isAllowedPdfRequest('https://example.com/', 'subFrame', PAGE)).toBe(false)
    expect(isAllowedPdfRequest('https://example.com/', 'xhr', PAGE)).toBe(false)
  })

  it('refuses other schemes and unparseable URLs', () => {
    expect(isAllowedPdfRequest('ftp://example.com/a.png', 'image', PAGE)).toBe(false)
    expect(isAllowedPdfRequest('ws://example.com/', 'webSocket', PAGE)).toBe(false)
    expect(isAllowedPdfRequest('not a url', 'image', PAGE)).toBe(false)
  })
})

describe('buildPdfCsp', () => {
  it('locks everything down except the hashed script, styles and images', () => {
    const csp = buildPdfCsp('HASH')
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'sha256-HASH'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain('img-src data: https:')
    expect(csp).not.toContain('http:;')
    expect(csp).not.toMatch(/script-src[^;]*unsafe/)
  })
})

describe('describeUrlForLog', () => {
  it('keeps only scheme and host', () => {
    expect(describeUrlForLog('https://example.com/a/b.png?token=secret#x')).toBe('https://example.com')
  })

  it('never logs file names', () => {
    expect(describeUrlForLog(PAGE)).toBe('file:')
    expect(describeUrlForLog('data:image/png;base64,AAAA')).toBe('data:')
    expect(describeUrlForLog('not a url')).toBe('[unparseable-url]')
  })
})

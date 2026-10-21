// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { normaliseRealRoot, displayRootSpelling } from './ProjectSession'

vi.mock('../LoggingService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

describe('normaliseRealRoot', () => {
  it.each([
    ['\\\\?\\C:\\Users\\me\\proj', 'C:\\Users\\me\\proj'],
    ['\\\\?\\UNC\\server\\share\\proj', '\\\\server\\share\\proj'],
    ['/Users/me/proj', '/Users/me/proj'],
    ['/Users/me/proj/', '/Users/me/proj'],
    ['/', '/']
  ])('%s -> %s', (input, expected) => {
    expect(normaliseRealRoot(input)).toBe(expected)
  })
})

describe('displayRootSpelling', () => {
  it('shows the native realpath spelling on Windows', () => {
    expect(displayRootSpelling('c:\\users\\x~1', 'C:\\Users\\Xavier', 'win32')).toBe('C:\\Users\\Xavier')
  })

  it('keeps the resolved spelling elsewhere', () => {
    expect(displayRootSpelling('/a/link', '/b/target', 'darwin')).toBe('/a/link')
    expect(displayRootSpelling('/a/link', '/b/target', 'linux')).toBe('/a/link')
  })
})

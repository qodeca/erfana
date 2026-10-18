// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { parseExternalUrl } from './externalUrl'

describe('parseExternalUrl', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['http://example.com/a?b=1#c', 'http://example.com/a?b=1#c'],
    ['mailto:someone@example.com', 'mailto:someone@example.com'],
    ['tel:+48123456789', 'tel:+48123456789'],
    ['ftp://files.example.com/x', 'ftp://files.example.com/x']
  ])('accepts %s', (input, normalised) => {
    expect(parseExternalUrl(input)).toBe(normalised)
  })

  it.each([
    ['file:///etc/hosts'],
    ['file://host/share/x'],
    ['file://host/x'],
    ['\\\\host\\share'],
    ['\\\\host\\share\\file.txt'],
    ['//host/share'],
    ['javascript:alert(1)'],
    ['java\nscript:alert(1)'],
    ['data:text/html,hi'],
    ['smb://host/share'],
    ['ms-msdt:/id'],
    ['x-custom-scheme://thing'],
    ['https://user:pass@example.com/'],
    ['https://user@example.com/'],
    ['http://exa mple.com'],
    ['not a url'],
    [''],
    [`https://example.com/${'a'.repeat(2100)}`],
    [42],
    [null],
    [undefined],
    [{}]
  ])('rejects %j', (input) => {
    expect(parseExternalUrl(input)).toBeNull()
  })
})

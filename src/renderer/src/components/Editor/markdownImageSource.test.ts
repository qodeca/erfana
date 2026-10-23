// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which image `src` values the preview reads from the project, passes through,
 * or never loads (#71).
 */
import { describe, it, expect } from 'vitest'
import { classifyImageSource } from './markdownImageSource'

describe('classifyImageSource', () => {
  it.each([
    ['./assets/icon.svg', './assets/icon.svg'],
    ['assets/icon.svg', 'assets/icon.svg'],
    ['../shared/diagram.png', '../shared/diagram.png'],
    ['./my%20pic.png', './my pic.png'],
    ['./a.png?raw=1#frag', './a.png'],
    ['.\\assets\\win.png', './assets/win.png']
  ])('reads %s from the project as %s', (src, path) => {
    expect(classifyImageSource(src)).toEqual({ kind: 'relative', path })
  })

  it.each(['https://example.test/a.png', 'http://example.test/a.png', 'HTTPS://EXAMPLE.TEST/A.PNG'])(
    'passes the remote address %s through unchanged',
    (src) => {
      expect(classifyImageSource(src)).toEqual({ kind: 'remote' })
    }
  )

  it.each([
    ['empty', ''],
    ['missing', undefined],
    ['a rooted path', '/etc/icon.png'],
    ['a protocol-relative address', '//server/share/icon.png'],
    ['a UNC path', '\\\\server\\share\\icon.png'],
    ['a drive path', 'C:\\Users\\me\\icon.png'],
    ['a drive path with slashes', 'C:/Users/me/icon.png'],
    ['a file: URL', 'file:///etc/icon.png'],
    ['a data: URL', 'data:image/png;base64,AAAA'],
    ['a blob: URL', 'blob:https://x/1'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['an escaped root', '%2Fetc%2Ficon.png'],
    ['an escaped scheme', 'file%3A%2F%2F%2Fetc%2Fx.png'],
    ['a NUL byte', './a%00.png'],
    ['a malformed escape', './a%E0%A4%A.png'],
    ['only a query', '?x=1']
  ])('never loads %s', (_label, src) => {
    expect(classifyImageSource(src)).toEqual({ kind: 'blocked' })
  })
})

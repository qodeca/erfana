// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The request path of a served local folder (spec 025, 025-FR-005 rule 1; ADR 0012 decision 8). */
import { describe, expect, it } from 'vitest'
import { isRefusedName, parseLocalRequestPath } from './localRequestPath'

describe('parseLocalRequestPath', () => {
  it.each([
    ['index.html', ['index.html']],
    ['assets/app.js', ['assets', 'app.js']],
    ['a%20b/c%C3%A9.css', ['a b', 'cé.css']],
    // Decoded once: a doubly encoded dot pair is a literal name, never a step up.
    ['%252e%252e/x', ['%2e%2e', 'x']],
    ['node_modules/x/lib.js', ['node_modules', 'x', 'lib.js']]
  ])('accepts %s', (raw, segments) => {
    expect(parseLocalRequestPath(raw, 'darwin')).toEqual({ ok: true, segments })
  })

  it.each([
    ['', 403, 'the folder itself (no listing)'],
    ['assets/', 403, 'a folder (trailing slash)'],
    ['a//b', 403, 'an empty segment'],
    ['../canary.txt', 400, 'a step up'],
    ['a/../../canary.txt', 400, 'a step up below the root'],
    ['%2e%2e/canary.txt', 400, 'an encoded step up'],
    ['%2E%2E/canary.txt', 400, 'an encoded step up in upper case'],
    ['./x', 400, 'a dot segment'],
    ['a%2fb', 400, 'an encoded slash'],
    ['a%5Cb', 400, 'an encoded backslash'],
    ['a%00b', 400, 'an encoded NUL'],
    ['a\\b', 400, 'a raw backslash'],
    ['%E0%A4%A', 400, 'a broken escape'],
    ['a%0Ab', 400, 'a control character'],
    ['file.txt:stream', 400, 'an alternate data stream'],
    ['C:', 400, 'a drive letter'],
    ['name.', 400, 'a trailing dot'],
    ['name ', 400, 'a trailing space'],
    ['CON', 400, 'a Windows device name'],
    ['nul.txt', 400, 'a Windows device name with an extension'],
    ['sub/COM1.js', 400, 'a numbered Windows device name'],
    ['.erfana/browser/profile/Cookies', 403, 'the .erfana folder'],
    ['.ERFANA/x', 403, 'the .erfana folder in another case'],
    ['.env', 403, 'a dot-file'],
    ['a/.git/config', 403, 'a nested dot-folder'],
    ['app.asar/main.js', 403, 'an asar archive'],
    ['APP.ASAR', 403, 'an asar archive in another case']
  ])('refuses %j with %i (%s)', (raw, status) => {
    expect(parseLocalRequestPath(raw, 'darwin')).toEqual({ ok: false, status })
  })

  it('refuses an 8.3 short-name alias on Windows only', () => {
    expect(parseLocalRequestPath('PROGRA~1/x', 'win32')).toEqual({ ok: false, status: 400 })
    expect(parseLocalRequestPath('PROGRA~1/x', 'linux')).toEqual({ ok: true, segments: ['PROGRA~1', 'x'] })
  })

  it('uses the host platform by default', () => {
    expect(parseLocalRequestPath('index.html')).toEqual({ ok: true, segments: ['index.html'] })
  })
})

describe('isRefusedName', () => {
  it('refuses dot-prefixed names and asar archives only', () => {
    expect(isRefusedName('.hidden')).toBe(true)
    expect(isRefusedName('x.Asar')).toBe(true)
    expect(isRefusedName('index.html')).toBe(false)
    expect(isRefusedName('asar.js')).toBe(false)
  })
})

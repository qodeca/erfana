// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { isSystemPath, normaliseWindowsSpelling, systemBlockedPrefixes } from './systemPathBlock'

const env = {
  SystemRoot: 'D:\\WINNT',
  ProgramFiles: 'D:\\Programs',
  'ProgramFiles(x86)': 'D:\\Programs (x86)',
  ProgramData: 'D:\\Data'
}

describe('normaliseWindowsSpelling', () => {
  it.each([
    ['\\\\localhost\\C$\\Windows\\x', 'C:\\Windows\\x'],
    ['\\\\LOCALHOST\\c$\\Windows', 'C:\\Windows'],
    ['\\\\127.0.0.1\\D$\\Data', 'D:\\Data'],
    ['\\\\?\\UNC\\localhost\\C$\\Windows\\x', 'C:\\Windows\\x'],
    ['\\\\localhost\\C$', 'C:\\'],
    ['\\\\?\\C:\\Windows', 'C:\\Windows'],
    ['C:\\Windows', 'C:\\Windows'],
    ['\\\\srv\\C$\\Windows', '\\\\srv\\C$\\Windows']
  ])('%s -> %s', (input, expected) => {
    expect(normaliseWindowsSpelling(input)).toBe(expected)
  })
})

describe('isSystemPath (win32 flavour)', () => {
  it('builds the list from the environment, keeping the usual C: folders as well', () => {
    const list = systemBlockedPrefixes('win32', env)
    expect(list).toEqual(expect.arrayContaining(['D:\\WINNT', 'D:\\Programs', 'D:\\Programs (x86)', 'D:\\Data', 'C:\\Windows']))
  })

  it.each([
    'D:\\WINNT\\System32\\cmd.exe',
    'd:\\winnt\\system32',
    'D:\\Programs (x86)\\app\\a.exe',
    'D:\\Data\\x',
    '\\\\localhost\\D$\\WINNT\\system32',
    '\\\\127.0.0.1\\C$\\Windows\\System32',
    '\\\\?\\UNC\\localhost\\C$\\Windows',
    'C:\\Windows\\x'
  ])('blocks %s', (value) => {
    expect(isSystemPath([value], 'win32', env)).toBe(true)
  })

  it.each(['D:\\work\\proj\\a.md', '\\\\localhost\\D$\\work\\a.md', '\\\\srv\\C$\\Windows\\x'])(
    'allows %s',
    (value) => {
      expect(isSystemPath([value], 'win32', env)).toBe(false)
    }
  )

  it('falls back to the C: folders without an environment', () => {
    expect(isSystemPath(['C:\\Windows\\x'], 'win32', {})).toBe(true)
    expect(isSystemPath(['C:\\Users\\a'], 'win32', {})).toBe(false)
  })

  it('checks every spelling it is given', () => {
    expect(isSystemPath(['C:\\work\\link\\x', 'C:\\Windows\\x'], 'win32', {})).toBe(true)
  })
})

describe('isSystemPath (POSIX)', () => {
  it('blocks the system folders on either spelling', () => {
    expect(isSystemPath(['/etc/hosts'], 'linux', {})).toBe(true)
    expect(isSystemPath(['/private/etc/hosts'], 'darwin', {})).toBe(true)
    expect(isSystemPath(['/home/a/x', '/etc/hosts'], 'linux', {})).toBe(true)
    expect(isSystemPath(['/home/a/x'], 'linux', {})).toBe(false)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { childPath } from './childPath'

const posix = { path: path.posix, platform: 'linux' as const }
const win = { path: path.win32, platform: 'win32' as const }

describe('childPath', () => {
  it('joins a plain name one level below the folder', () => {
    expect(childPath('/p/docs', 'a.md', posix)).toBe('/p/docs/a.md')
    expect(childPath('C:\\p\\docs', 'a.md', win)).toBe('C:\\p\\docs\\a.md')
    expect(childPath('/', 'a', posix)).toBe('/a')
  })

  it.each(['.', '..', '', '/', 'a/b', '../x', 'a\\b', 'a\0b'])(
    'rejects dot-segment or multi-level name %j',
    (name) => {
      expect(() => childPath('/p/docs', name, posix)).toThrow('Invalid name')
      expect(() => childPath('C:\\p\\docs', name, win)).toThrow('Invalid name')
    }
  )

  it.each(['...', '.. ', '. ', 'name.', 'name '])('rejects %j on Windows, where it is trimmed', (name) => {
    expect(() => childPath('C:\\p\\docs', name, win)).toThrow('Invalid name')
  })

  it.each(['...', '.. ', 'name.'])('keeps %j valid on POSIX, where it is an ordinary name', (name) => {
    expect(childPath('/p/docs', name, posix)).toBe(`/p/docs/${name}`)
  })
})

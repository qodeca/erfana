// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'

import type { FileStamp } from './freshnessTypes'
import { isSameContent, isSameStat } from './stamp'

const base: FileStamp = { size: 10, mtimeMs: 1000, ctimeMs: 1000, ino: '7', hash: 'aa' }

describe('isSameContent', () => {
  it('is true for the same stamp', () => {
    expect(isSameContent(base, { ...base })).toBe(true)
  })

  it('N3: a touch-only write (new times, same hash) is the same content', () => {
    expect(isSameContent(base, { ...base, mtimeMs: 2000, ctimeMs: 2000 })).toBe(true)
  })

  it('L4: same size and mtime but a different hash is different content', () => {
    expect(isSameContent(base, { ...base, ctimeMs: 2000, hash: 'bb' })).toBe(false)
  })

  it('a different size is different content, whatever the hashes', () => {
    expect(isSameContent(base, { ...base, size: 11 })).toBe(false)
  })

  it('without both hashes, every stat field decides', () => {
    const { hash, ...unhashed } = base
    expect(hash).toBe('aa')
    expect(isSameContent(unhashed, base)).toBe(true)
    expect(isSameContent(unhashed, { ...base, ctimeMs: 1001 })).toBe(false)
    expect(isSameContent(unhashed, { ...base, ino: '8' })).toBe(false)
    expect(isSameContent(unhashed, { ...base, mtimeMs: 999 })).toBe(false)
  })
})

describe('isSameStat', () => {
  it('ignores the hash and compares size, times and id', () => {
    expect(isSameStat(base, { ...base, hash: 'zz' })).toBe(true)
    expect(isSameStat(base, { ...base, ctimeMs: 1 })).toBe(false)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * files-exclude-schema tests – the lenient `files.exclude` parse (issue #211, D7).
 */
import { describe, it, expect } from 'vitest'
import { ExcludeListSchema, FilesSettingsSchema } from './files-exclude-schema'

describe('ExcludeListSchema', () => {
  it('keeps a list of strings as is', () => {
    expect(ExcludeListSchema.parse(['tmp', '**/test-tmp'])).toEqual(['tmp', '**/test-tmp'])
  })

  it('replaces a non-string entry with an empty string, keeping every index', () => {
    const parsed = ExcludeListSchema.parse(['a', 5, null, { x: 1 }, 'b'])

    expect(parsed).toEqual(['a', '', '', '', 'b'])
    expect(parsed.indexOf('b')).toBe(4)
  })

  it.each([
    ['a string', 'tmp'],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', { exclude: ['tmp'] }]
  ])('turns %s into an empty list', (_label, input) => {
    expect(ExcludeListSchema.parse(input)).toEqual([])
  })

  it('returns a fresh array for every fallback', () => {
    const first = ExcludeListSchema.parse(42)
    first.push('mutated')

    expect(ExcludeListSchema.parse(42)).toEqual([])
  })
})

describe('FilesSettingsSchema', () => {
  it('parses a well-formed section', () => {
    expect(FilesSettingsSchema.parse({ exclude: ['tmp'] })).toEqual({ exclude: ['tmp'] })
  })

  it('never fails: every parse succeeds', () => {
    for (const input of [42, 'files', null, undefined, [], true, {}]) {
      expect(FilesSettingsSchema.safeParse(input).success).toBe(true)
    }
  })

  it.each([
    ['a number', 42],
    ['a string', 'tmp'],
    ['null', null],
    ['undefined', undefined],
    ['an array', ['tmp']],
    ['an empty object', {}]
  ])('falls back to the default for %s', (_label, input) => {
    expect(FilesSettingsSchema.parse(input)).toEqual({ exclude: [] })
  })

  it('falls back to an empty list when exclude is not an array', () => {
    expect(FilesSettingsSchema.parse({ exclude: 'tmp' })).toEqual({ exclude: [] })
  })

  it('keeps indexes stable when some entries are not strings', () => {
    expect(FilesSettingsSchema.parse({ exclude: [1, 'tmp'] })).toEqual({ exclude: ['', 'tmp'] })
  })

  it('strips unknown keys', () => {
    expect(FilesSettingsSchema.parse({ exclude: ['tmp'], watch: true })).toEqual({ exclude: ['tmp'] })
  })

  it('returns a fresh default object for every fallback', () => {
    const first = FilesSettingsSchema.parse(42)
    first.exclude.push('mutated')

    expect(FilesSettingsSchema.parse(42)).toEqual({ exclude: [] })
  })
})

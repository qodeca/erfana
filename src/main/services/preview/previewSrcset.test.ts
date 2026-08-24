// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the pure `srcset` parser (Issue #74, work item 7).
 *
 * Table-driven, with explicit coverage of the two features a naive
 * comma-split gets wrong: commas INSIDE URLs (`data:` URIs) and the
 * width/density descriptor forms (`1x`, `2x`, `100w`).
 */
import { describe, it, expect } from 'vitest'
import { parseSrcset } from './previewSrcset'

describe('parseSrcset', () => {
  it.each([
    ['empty string', '', []],
    ['whitespace only', '   \t\n ', []],
    ['single url, no descriptor', 'a.png', ['a.png']],
    ['single url with density descriptor', 'a.png 2x', ['a.png']],
    ['single url with width descriptor', 'a.png 100w', ['a.png']],
    ['single url with fractional density', 'a.png 1.5x', ['a.png']],
    [
      'two candidates with density descriptors',
      'small.png 1x, large.png 2x',
      ['small.png', 'large.png']
    ],
    [
      'two candidates with width descriptors',
      'small.png 480w, large.png 1024w',
      ['small.png', 'large.png']
    ],
    [
      'comma-separated without descriptors (comma+space boundary)',
      'a.png, b.png',
      ['a.png', 'b.png']
    ],
    [
      'extra whitespace around candidates',
      '  a.png   1x ,   b.png   2x  ',
      ['a.png', 'b.png']
    ],
    [
      'data URI with commas inside the URL',
      'data:image/png;base64,iVBORw0KGgo= 1x, small.png 2x',
      ['data:image/png;base64,iVBORw0KGgo=', 'small.png']
    ],
    [
      'two data URIs each carrying commas',
      'data:image/gif;base64,AAAA,BBBB 1x, data:image/gif;base64,CCCC 2x',
      ['data:image/gif;base64,AAAA,BBBB', 'data:image/gif;base64,CCCC']
    ],
    ['trailing comma is stripped', 'a.png,', ['a.png']],
    ['multiple trailing commas stripped', 'a.png,,,', ['a.png']],
    [
      'three candidates',
      'x.png 1x, y.png 2x, z.png 3x',
      ['x.png', 'y.png', 'z.png']
    ]
  ])('parses %s', (_label, input, expected) => {
    expect(parseSrcset(input as string)).toEqual(expected)
  })

  it('preserves duplicate urls in order (dedup is the caller concern)', () => {
    expect(parseSrcset('a.png 1x, a.png 2x')).toEqual(['a.png', 'a.png'])
  })

  it('does not split a comma that is not at a whitespace boundary', () => {
    // No whitespace around the comma: it is part of a single URL token.
    expect(parseSrcset('a.png,b.png 2x')).toEqual(['a.png,b.png'])
  })
})

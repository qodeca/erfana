// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Main's own checks of a worker's write answer (security review S-L-C; the
 * writer path is covered in `CommentWriter.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import { GOLDEN_CASES } from '../../../../shared/comments/__fixtures__/v1/cases'
import { encodeText, isSafeCommentText, serializeBlock } from '../../../../shared/htmlComments'
import { isSafeInsert } from './commentWriteCore'

describe('isSafeInsert', () => {
  it('takes every block the serializer writes, mid-line and on its own lines, and a delete', () => {
    expect(isSafeInsert(new Uint8Array())).toBe(true)
    for (const { name, layout, data } of GOLDEN_CASES) {
      const result = serializeBlock(data, layout)
      if (!result.ok) throw new Error(`${name}: ${result.reason}`)
      expect(isSafeInsert(encodeText(result.block)), name).toBe(true)
      expect(isSafeInsert(encodeText(result.block + layout.eol + layout.indent)), name).toBe(true)
    }
  })

  it.each([
    ['text after the comment', '<!-- a --><script>x()</script>'],
    ['a second comment', '<!-- a --><!-- b -->'],
    ['"--" inside', '<!-- a -- b -->'],
    ['an early end', '<!-- a --!>b -->'],
    ['the short opener "<!-->"', '<!-->'],
    ['"<!--->"', '<!--->'],
    ['text ending in "-"', '<!-- a--->'],
    ['blanks without a line break after it', '<!-- a -->  '],
    ['text after the own-lines tail', '<!-- a -->\n  <p>'],
    ['a BOM in front', '﻿<!-- a -->'],
    ['no comment at all', '<p>hi</p>']
  ])('refuses %s', (_name, text) => {
    expect(isSafeInsert(encodeText(text))).toBe(false)
  })

  it('refuses bytes that are not UTF-8', () => {
    expect(isSafeInsert(new Uint8Array([0x3c, 0x21, 0x2d, 0x2d, 0xff, 0x2d, 0x2d, 0x3e]))).toBe(false)
  })
})

describe('isSafeCommentText', () => {
  it('is assertSafeCommentText as a yes or no, and "<!-->" is not a block', () => {
    expect(isSafeCommentText('<!-- fine -->')).toBe(true)
    expect(isSafeCommentText('<!-->')).toBe(false)
    expect(isSafeCommentText('<!-- a -- b -->')).toBe(false)
  })
})

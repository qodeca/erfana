// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment tokenizer and the words the placement rules read (spec 024
 * 024-FR-003, 024-FR-023; design `markdown-format.md` § 4.4, § 4.6).
 */
import { describe, expect, it } from 'vitest'
import {
  htmlBlockClosed,
  htmlBlockType,
  isCommentOnly,
  regionEndName,
  regionStartName,
  scanComments
} from './mdCommentScan'

describe('scanComments', () => {
  it('024-AC-003 finds each comment from <!-- to the first -->', () => {
    const text = 'x <!-- a --> y <!-- b\nc -->'
    expect(scanComments(text, 0, text.length)).toEqual([
      { start: 2, end: 12, data: ' a ', terminated: true },
      { start: 15, end: 27, data: ' b\nc ', terminated: true }
    ])
  })

  it('024-AC-003 --!> does not close a comment in Markdown: the comment runs to the range end, unterminated', () => {
    const text = '<!-- erfana:comment v1 --!>\nmore'
    expect(scanComments(text, 0, text.length)).toEqual([{ start: 0, end: text.length, data: text.slice(4), terminated: false }])
  })

  it('024-AC-003 reads <!--> and <!---> as complete empty comments', () => {
    expect(scanComments('<!-->', 0, 5)).toEqual([{ start: 0, end: 5, data: '', terminated: true }])
    expect(scanComments('<!--->', 0, 6)).toEqual([{ start: 0, end: 6, data: '', terminated: true }])
  })

  it('024-AC-003 a close past the range end leaves the comment unterminated at the range end', () => {
    expect(scanComments('<!-- a --> tail', 0, 8)).toEqual([{ start: 0, end: 8, data: ' a -', terminated: false }])
    expect(scanComments('none here', 0, 9)).toEqual([])
  })

  it('isCommentOnly: comments and whitespace only', () => {
    expect(isCommentOnly('<!-- a -->\n<!-- b -->')).toBe(true)
    expect(isCommentOnly('<!-- a --> <b>x</b>')).toBe(false)
    expect(isCommentOnly('<div>')).toBe(false)
  })
})

describe('HTML block types (CommonMark § 4.6)', () => {
  it.each([
    ['<script>x', 1],
    ['<PRE>', 1],
    ['<!-- x -->', 2],
    ['<?php', 3],
    ['<!DOCTYPE html>', 4],
    ['<![CDATA[x]]>', 5],
    ['<div class="x">', 6],
    ['</details>', 6],
    ['<custom-tag>', 7]
  ] as const)('%s is type %i', (value, type) => {
    expect(htmlBlockType(value)).toBe(type)
  })

  it('knows when a type 1–5 block met its end condition; 6 and 7 are open whenever a line follows', () => {
    expect(htmlBlockClosed('<script>\nx\n</script>', 1)).toBe(true)
    expect(htmlBlockClosed('<script>\nx', 1)).toBe(false)
    expect(htmlBlockClosed('<!-- x -->', 2)).toBe(true)
    expect(htmlBlockClosed('<!-- x', 2)).toBe(false)
    expect(htmlBlockClosed('<?x ?>', 3)).toBe(true)
    expect(htmlBlockClosed('<!X y>', 4)).toBe(true)
    expect(htmlBlockClosed('<![CDATA[ a ]]>', 5)).toBe(true)
    expect(htmlBlockClosed('<div>', 6)).toBe(false)
    expect(htmlBlockClosed('<custom>', 7)).toBe(false)
  })
})

describe('generated regions (024-FR-023)', () => {
  it.each([
    [' START doctoc generated TOC ', ''],
    ['BEGIN mdsh', ''],
    ['ALL-CONTRIBUTORS-LIST:START - Do not remove', 'ALL-CONTRIBUTORS-LIST'],
    ['readme-BEGIN', 'readme']
  ])('024-AC-031 "%s" opens a region named "%s"', (data, name) => {
    expect(regionStartName(data)).toBe(name)
  })

  it.each([' prettier-ignore ', 'RESTART', 'START-ish', ''])('024-AC-031 "%s" opens none', data => {
    expect(regionStartName(data)).toBeUndefined()
  })

  it('024-AC-031 END closes by the same leading name', () => {
    expect(regionEndName(' END doctoc generated TOC ')).toBe('')
    expect(regionEndName('ALL-CONTRIBUTORS-LIST:END')).toBe('ALL-CONTRIBUTORS-LIST')
    expect(regionEndName('ENDING')).toBeUndefined()
  })
})

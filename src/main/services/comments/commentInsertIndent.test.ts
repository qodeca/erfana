// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Main's check of the blanks around a new block against the bytes it read
 * (security review L-4).
 */
import { describe, expect, it } from 'vitest'
import { encodeText } from '../../../shared/comments/encoding'
import { insertBlanksFit } from './commentInsertIndent'

const BLOCK = '<!-- erfana:comment v1 id=c-1 -->'

/** The splice that inserts `insert` at the start of `text`'s line `line` (0-based), or at `offset`. */
function at(text: string, insert: string, where: { line?: number; offset?: number }) {
  const offset = where.offset ?? text.split('\n').slice(0, where.line).reduce((sum, l) => sum + l.length + 1, 0)
  const byteStart = encodeText(text.slice(0, offset)).length
  return [encodeText(text), { byteStart, byteEnd: byteStart, insert: encodeText(insert) }] as const
}

describe('L-4 a line-start indent (Markdown)', () => {
  it('L-4 list item 2: spaces up to item 1\'s content column on item 2\'s marker line', () => {
    expect(insertBlanksFit(...at('- alpha\n- beta release notes\n', `  ${BLOCK}\n`, { line: 1 }))).toBe(true)
    expect(insertBlanksFit(...at('1. a\n2. b\n', `   ${BLOCK}\n`, { line: 1 }))).toBe(true)
    // 9. → 10.: item 9's column (3) is narrower than item 10's marker (4).
    expect(insertBlanksFit(...at('9. a\n10. b\n', `   ${BLOCK}\n`, { line: 1 }))).toBe(true)
    expect(insertBlanksFit(...at('- a\n  - b\n  - c\n', `    ${BLOCK}\n`, { line: 2 }))).toBe(true)
  })

  it('L-4 a later block of a list item, and a quote: exactly the line\'s own blanks', () => {
    expect(insertBlanksFit(...at('- first\n\n  second para\n', `  ${BLOCK}\n`, { line: 2 }))).toBe(true)
    expect(insertBlanksFit(...at('Intro.\n\n> outer\n', `${BLOCK}\n`, { line: 2 }))).toBe(true)
    expect(insertBlanksFit(...at('﻿  - a\n', `  ${BLOCK}\n`, { offset: 1 }))).toBe(true)
  })

  it('L-4 anything longer is refused: past the marker column, past the line\'s blanks, or a megabyte of spaces', () => {
    expect(insertBlanksFit(...at('- alpha\n- beta\n', `   ${BLOCK}\n`, { line: 1 }))).toBe(false)
    expect(insertBlanksFit(...at('Para one.\n\nPara two.\n', `    ${BLOCK}\n`, { line: 2 }))).toBe(false)
    expect(insertBlanksFit(...at('  indented para\n', `   ${BLOCK}\n`, { line: 0 }))).toBe(false)
    expect(insertBlanksFit(...at('- a\n- b\n', `${' '.repeat(1_000_000)}${BLOCK}\n`, { line: 1 }))).toBe(false)
    // Tabs are never a list column; only the line's own blanks, as they are.
    expect(insertBlanksFit(...at('- a\n- b\n', `\t${BLOCK}\n`, { line: 1 }))).toBe(false)
  })

  it('L-4 an indent only at a line start, and then no tail', () => {
    expect(insertBlanksFit(...at('Para text here.\n', `  ${BLOCK}\n`, { offset: 5 }))).toBe(false)
    expect(insertBlanksFit(...at('- a\n- b\n', `  ${BLOCK}\n  `, { line: 1 }))).toBe(false)
  })
})

describe('L-4 an own-lines tail (HTML)', () => {
  it('L-4 the tail gives the target back its own indent, and nothing else', () => {
    const page = '<main>\n    <p id="x">Text</p>\n</main>\n'
    const offset = page.indexOf('<p')
    expect(insertBlanksFit(...at(page, `${BLOCK}\n    `, { offset }))).toBe(true)
    expect(insertBlanksFit(...at(page, `${BLOCK}\r\n    `, { offset }))).toBe(true)
    expect(insertBlanksFit(...at(page, `${BLOCK}\n        `, { offset }))).toBe(false)
    expect(insertBlanksFit(...at(page, `${BLOCK}\n  `, { offset }))).toBe(false)
  })

  it('L-4 a mid-line block, a delete and a block with no blanks need nothing', () => {
    const page = '<p>One <em>two</em></p>\n'
    expect(insertBlanksFit(...at(page, BLOCK, { offset: page.indexOf('<em') }))).toBe(true)
    expect(insertBlanksFit(encodeText(page), { byteStart: 0, byteEnd: 3, insert: new Uint8Array() })).toBe(true)
  })
})

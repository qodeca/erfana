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

  it('024-AC-003 M-A a later block indented further than its item\'s content column takes the block at that column', () => {
    // CommonMark: "1. " is column 3; the paragraph sits at 4 and is still the item's.
    expect(insertBlanksFit(...at('1. a\n\n    para\n', `   ${BLOCK}\n`, { line: 2 }))).toBe(true)
    expect(insertBlanksFit(...at('- a\n\n    ```js\n    x\n    ```\n', `  ${BLOCK}\n`, { line: 2 }))).toBe(true)
    // A tab reaches column 4.
    expect(insertBlanksFit(...at('- a\n\n\tpara\n', `  ${BLOCK}\n`, { line: 2 }))).toBe(true)
    expect(insertBlanksFit(...at('1. a\n\n\tpara\n', `   ${BLOCK}\n`, { line: 2 }))).toBe(true)
    expect(insertBlanksFit(...at('- a\n\n \tpara\n', `    ${BLOCK}\n`, { line: 2 }))).toBe(true)
  })

  it('024-AC-003 M-A still never past the column the line reaches, never a tab lead, and a marker line keeps its own rule', () => {
    expect(insertBlanksFit(...at('1. a\n\n    para\n', `     ${BLOCK}\n`, { line: 2 }))).toBe(false)
    expect(insertBlanksFit(...at('- a\n\n\tpara\n', `     ${BLOCK}\n`, { line: 2 }))).toBe(false)
    expect(insertBlanksFit(...at('1. a\n\n    para\n', `\t${BLOCK}\n`, { line: 2 }))).toBe(false)
    expect(insertBlanksFit(...at('1. a\n\n    para\n', ` \t${BLOCK}\n`, { line: 2 }))).toBe(false)
    // On a marker line the marker's column bounds it, however deep the line's blanks.
    expect(insertBlanksFit(...at('- a\n    - b\n', `       ${BLOCK}\n`, { line: 1 }))).toBe(false)
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
  it('024-AC-038 security re-check L-A a bare line break after a block only where the line so far is blank', () => {
    const md = '# Heading text\n'
    expect(insertBlanksFit(...at(md, `${BLOCK}\n`, { offset: md.indexOf('text') }))).toBe(false)
    expect(insertBlanksFit(...at(md, `${BLOCK}\n`, { offset: 0 }))).toBe(true)
  })

  it('L-4 the tail gives the target back its own indent, and nothing else', () => {
    const page = '<main>\n    <p id="x">Text</p>\n</main>\n'
    const offset = page.indexOf('<p')
    expect(insertBlanksFit(...at(page, `${BLOCK}\n    `, { offset }))).toBe(true)
    expect(insertBlanksFit(...at(page, `${BLOCK}\r\n    `, { offset }))).toBe(true)
    expect(insertBlanksFit(...at(page, `${BLOCK}\n        `, { offset }))).toBe(false)
    expect(insertBlanksFit(...at(page, `${BLOCK}\n  `, { offset }))).toBe(false)
  })

  it('L-4 a mid-line block and a block with no blanks need nothing', () => {
    const page = '<p>One <em>two</em></p>\n'
    expect(insertBlanksFit(...at(page, BLOCK, { offset: page.indexOf('<em') }))).toBe(true)
  })
})

describe('024-AC-038 review L-2 a delete removes one comment block and nothing else', () => {
  /** The splice that removes `text.slice(from, to)`. */
  const removing = (text: string, from: number, to: number) =>
    [encodeText(text), { byteStart: encodeText(text.slice(0, from)).length, byteEnd: encodeText(text.slice(0, to)).length, insert: new Uint8Array() }] as const

  it('024-AC-038 the block alone, with its line-start indent and line break, or with its own-lines tail', () => {
    const md = `- one\n  ${BLOCK}\n- two\n`
    expect(insertBlanksFit(...removing(md, 6, md.indexOf('- two')))).toBe(true)
    const tabbed = `- one\n\t${BLOCK}\r\n- two\n`
    expect(insertBlanksFit(...removing(tabbed, 6, tabbed.indexOf('- two')))).toBe(true)
    const page = `<main>\n    ${BLOCK}\n    <p>x</p>\n</main>\n`
    expect(insertBlanksFit(...removing(page, page.indexOf('<!--'), page.indexOf('<p')))).toBe(true)
    expect(insertBlanksFit(...removing(BLOCK, 0, BLOCK.length))).toBe(true)
  })

  it('024-AC-038 refused: page content, a block and one byte more, two blocks, another tool\'s comment, nothing at all', () => {
    const page = '<p>One <em>two</em></p>\n'
    expect(insertBlanksFit(encodeText(page), { byteStart: 0, byteEnd: 3, insert: new Uint8Array() })).toBe(false)
    const md = `${BLOCK}\nPara.\n`
    expect(insertBlanksFit(...removing(md, 0, BLOCK.length + 2))).toBe(false)
    const two = `${BLOCK}\n${BLOCK}\n`
    expect(insertBlanksFit(...removing(two, 0, two.length))).toBe(false)
    const other = '<!-- prettier-ignore -->\nPara.\n'
    expect(insertBlanksFit(...removing(other, 0, other.indexOf('Para')))).toBe(false)
    expect(insertBlanksFit(...removing(md, 3, 3))).toBe(false)
    // Bytes that are not UTF-8 are no block.
    expect(insertBlanksFit(Uint8Array.from([0xff, 0xfe]), { byteStart: 0, byteEnd: 2, insert: new Uint8Array() })).toBe(false)
  })

  it('024-AC-038 S-07/S-08 a damaged block holding "--" is still one comment node, so "Delete damaged comment" works', () => {
    const damaged = '<!-- erfana:comment v1 id=c-1 {"msgs": [-- broken json -->'
    const md = `Intro.\n\n${damaged}\nPara.\n`
    expect(insertBlanksFit(...removing(md, md.indexOf('<!--'), md.indexOf('Para')))).toBe(true)
    const bang = '<!-- erfana:comment v1 id=c-2 -- half --!>'
    expect(insertBlanksFit(...removing(bang, 0, bang.length))).toBe(true)
  })

  it('024-AC-038 code review M1 refused: blanks or a line break taken from mid-line, and an indent taken from the next line', () => {
    // (a) The range starts at the blanks after "text": the line break would join "text" and the heading.
    const mid = `text   ${BLOCK}\n# Heading\n`
    expect(insertBlanksFit(...removing(mid, 4, mid.indexOf('#')))).toBe(false)
    expect(insertBlanksFit(...removing(mid, mid.indexOf('<!--'), mid.indexOf('#')))).toBe(false)
    // (b) The next line's indent goes with the block: an indented code block or nested item would change meaning.
    const md = `${BLOCK}\n    code\n`
    expect(insertBlanksFit(...removing(md, 0, md.indexOf('code')))).toBe(false)
    // HTML gives back only the target's own indent, never more.
    const page = `<main>\n    ${BLOCK}\n        <p>x</p>\n</main>\n`
    expect(insertBlanksFit(...removing(page, page.indexOf('<!--'), page.indexOf('<p')))).toBe(false)
    // A block alone in the middle of a line is still removable, with no blanks around it.
    const inline = `<p>One ${BLOCK}<em>two</em></p>\n`
    expect(insertBlanksFit(...removing(inline, inline.indexOf('<!--'), inline.indexOf('<em')))).toBe(true)
  })

  it('024-AC-038 security review M-1 an edit, reply or resolve replaces exactly one block, never more', () => {
    const NEW = '<!-- erfana:comment v1 id=c-1 status=resolved -->'
    const replacing = (text: string, from: number, to: number) =>
      [encodeText(text), { byteStart: encodeText(text.slice(0, from)).length, byteEnd: encodeText(text.slice(0, to)).length, insert: encodeText(NEW) }] as const
    const md = `Intro.\n\n${BLOCK}\nPara.\n`
    const at = md.indexOf('<!--')
    expect(insertBlanksFit(...replacing(md, at, at + BLOCK.length))).toBe(true)
    // The whole file, the block and the next line, or page content: refused.
    expect(insertBlanksFit(...replacing(md, 0, md.length))).toBe(false)
    expect(insertBlanksFit(...replacing(md, at, md.length))).toBe(false)
    expect(insertBlanksFit(...replacing(md, 0, 6))).toBe(false)
    expect(insertBlanksFit(...replacing('<!-- prettier-ignore -->\n', 0, 24))).toBe(false)
    // An add (an empty range) is not a replace.
    expect(insertBlanksFit(...replacing(md, at, at))).toBe(true)
  })

  it('024-AC-038 security re-check L-B a delete takes the blanks before a block only when the block ends its line', () => {
    const md = `- a\n\n  ${BLOCK}para\n`
    expect(insertBlanksFit(...removing(md, md.indexOf('  <!--'), md.indexOf('para')))).toBe(false)
    const own = `- a\n\n  ${BLOCK}\npara\n`
    expect(insertBlanksFit(...removing(own, own.indexOf('  <!--'), own.indexOf('para')))).toBe(true)
    const last = `- a\n  ${BLOCK}`
    expect(insertBlanksFit(...removing(last, last.indexOf('  <!--'), last.length))).toBe(true)
  })

  it('024-AC-038 a delete after a BOM, and an HTML own-lines delete in a CRLF file', () => {
    const bom = `\uFEFF${BLOCK}\nPara.\n`
    expect(insertBlanksFit(...removing(bom, 1, bom.indexOf('Para')))).toBe(true)
    const indented = `\uFEFF  ${BLOCK}\nPara.\n`
    expect(insertBlanksFit(...removing(indented, 1, indented.indexOf('Para')))).toBe(true)
    const crlf = `<main>\r\n    ${BLOCK}\r\n    <p>x</p>\r\n</main>\r\n`
    expect(insertBlanksFit(...removing(crlf, crlf.indexOf('<!--'), crlf.indexOf('<p')))).toBe(true)
  })

  it('024-AC-038 security re-check L-C never a range that starts or ends inside a character', () => {
    const text = `é${BLOCK}\n`
    // Byte 1 is the second byte of "é".
    expect(insertBlanksFit(encodeText(text), { byteStart: 1, byteEnd: 1, insert: encodeText(BLOCK) })).toBe(false)
    expect(insertBlanksFit(encodeText(text), { byteStart: 2, byteEnd: 2, insert: encodeText(BLOCK) })).toBe(true)
  })

  it('024-AC-038 a replace rewrites only a v1 block; a newer one is refused', () => {
    const newer = '<!-- erfana:comment v2 id=c-9 -->'
    const md = `${newer}\nPara.\n`
    expect(insertBlanksFit(encodeText(md), { byteStart: 0, byteEnd: newer.length, insert: encodeText(BLOCK) })).toBe(false)
  })

  it('024-AC-038 refused: a range that a "-->" or "--!>" inside would split into two nodes', () => {
    const split = `<!-- erfana:comment v1 id=c-1 --> <p>page</p> <!-- x -->`
    expect(insertBlanksFit(...removing(split, 0, split.length))).toBe(false)
    const bangSplit = `<!-- erfana:comment v1 id=c-1 --!> <p>page</p> <!-- x -->`
    expect(insertBlanksFit(...removing(bangSplit, 0, bangSplit.length))).toBe(false)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The kind-agnostic block classifier (spec 024 architecture note 001 § 1
 * `parse`, § 8 C2; design markdown-format.md § 2 "Reading the delete range").
 * The HTML behaviour is pinned by parse.test.ts, the goldens and the
 * writer-bytes pins; this file covers what is new: the `line-start` range and
 * a classifier that reads a non-HTML index.
 */
import { describe, expect, it, vi } from 'vitest'
import { classifyIndexedBlocks, lineStartRange, removableRange, type BlockTargetResolver } from './blocks'
import { fixedId, makeComment } from './__fixtures__/commentTestData'
import { lineIndex } from './__fixtures__/lineIndex'
import { serializeBlock } from './format'

const NODE = '<!--x-->'

function block(indent: string, eol: '\n' | '\r\n' = '\n', n = 1): string {
  const result = serializeBlock(makeComment({ id: fixedId('c-', n) }), { indent, eol })
  if (!result.ok) throw new Error(result.reason)
  return result.block
}

/** The node range of the first `<!--` … `-->` in `text`. */
function nodeOf(text: string): [number, number] {
  const start = text.indexOf('<!--')
  return [start, text.indexOf('-->', start) + 3]
}

describe('lineStartRange', () => {
  it('takes the indent, the node and its line break when the node starts its line after spaces', () => {
    const text = `- one\n  ${NODE}\n- two\n`
    const [start, end] = nodeOf(text)
    expect(lineStartRange(text, 0, start, end)).toEqual([6, end + 1])
  })

  it('takes a CRLF and a lone CR whole', () => {
    const crlf = `a\r\n${NODE}\r\nb`
    expect(lineStartRange(crlf, 0, ...nodeOf(crlf))).toEqual([3, nodeOf(crlf)[1] + 2])
    const cr = `a\r${NODE}\rb`
    expect(lineStartRange(cr, 0, ...nodeOf(cr))).toEqual([2, nodeOf(cr)[1] + 1])
  })

  it('starts after a BOM on the first line, never before it', () => {
    const text = `\uFEFF${NODE}\nb`
    expect(lineStartRange(text, 1, ...nodeOf(text))).toEqual([1, nodeOf(text)[1] + 1])
  })

  it('is the node alone mid-line, after a tab, or with no line break after it', () => {
    for (const text of [`a ${NODE}\nb`, `\t${NODE}\nb`, `a\n${NODE}`, `a\n${NODE}b`]) {
      const node = nodeOf(text)
      expect(lineStartRange(text, 0, ...node)).toEqual(node)
    }
  })
})

describe('removableRange', () => {
  it('keeps the shipped before-target range and adds the line-start one (C2)', () => {
    const text = `<div>\n  ${NODE}\n  <p>x</p>`
    const node = nodeOf(text)
    // before-target: the node, its line break and the indent repeated after it
    expect(removableRange(text, 0, node, 'before-target')).toEqual([node[0], node[1] + 3])
    // line-start: from the line start to the end of the line break
    expect(removableRange(text, 0, node, 'line-start')).toEqual([6, node[1] + 1])
  })
})

describe('classifyIndexedBlocks', () => {
  it('reads blocks from a non-HTML index and gives each its shape\'s range', () => {
    const inserted = `  ${block('  ')}\n`
    const original = '- one\n- two\n'
    const text = original.slice(0, 6) + inserted + original.slice(6)
    const resolve = vi.fn<BlockTargetResolver>(() => ({ state: 'orphaned' }))
    const state = classifyIndexedBlocks(lineIndex(text), 'line-start', resolve)
    expect(state.writable).toBe(true)
    expect(state.blocks).toHaveLength(1)
    const [only] = state.blocks
    expect(only.kind).toBe('ok')
    expect(only.range).toEqual([6, 6 + inserted.length])
    expect(text.slice(0, only.range[0]) + text.slice(only.range[1])).toBe(original)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve.mock.calls[0][0]).toMatchObject({ start: 8 })
  })

  it('makes the file read-only for an unterminated block, and ignores comments that are not blocks', () => {
    const text = `<!-- prettier-ignore -->\n<!-- erfana:comment v1 id=${fixedId('c-', 2)}\nno end`
    const state = classifyIndexedBlocks(lineIndex(text), 'line-start', () => ({ state: 'orphaned' }))
    expect(state.blocks.map(b => b.kind)).toEqual(['damaged'])
    expect(state).toMatchObject({ writable: false, readOnlyReason: 'unterminated-block' })
  })
})

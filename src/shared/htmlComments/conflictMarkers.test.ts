// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git conflict markers (decision 32, docs/designs/comments/html-preview-comments.md §3;
 * U-070–U-076): a marker inside a block damages it, a complete hunk anywhere
 * locks the file, and a lone marker-like line locks nothing.
 */
import { describe, expect, it } from 'vitest'
import { fixedId, makeComment } from './__fixtures__/commentTestData'
import {
  findConflictHunks,
  forEachLine,
  hasConflictHunk,
  lineHasMarkerPrefix,
  markerAtLineStart
} from './conflictMarkers'
import { serializeBlock, type CommentData } from './format'
import { analyzeCommentDocument, parseCommentBlocks, type DamageReason } from './parse'
import { planDelete, planInsert } from './splice'

function block(data: CommentData = makeComment()): string {
  const result = serializeBlock(data, { indent: '  ', eol: '\n' })
  if (!result.ok) throw new Error(result.reason)
  return result.block
}

const page = (inner: string): string =>
  `<main>\n  ${inner}\n  <button class="cta">Buy now</button>\n</main>\n`

describe('markers inside blocks', () => {
  it.each(['<<<<<<< HEAD', '=======', '>>>>>>> feature', '||||||| base'])(
    'U-070 a %s line inside a block → damaged conflict-marker',
    marker => {
      const damaged = block().replace('\n  status: open', `\n  status: open\n${marker}`)
      expect(parseCommentBlocks(page(damaged)).blocks[0]).toMatchObject({
        kind: 'damaged',
        reason: 'conflict-marker'
      })
      const indented = block().replace('\n  status: open', `\n  status: open\n    ${marker}`)
      expect(parseCommentBlocks(page(indented)).blocks[0]).toMatchObject({
        reason: 'conflict-marker'
      })
    }
  )

  it('U-071 a hunk splitting a block → both halves damaged, and no write range touches the hunk', () => {
    const ours = block()
    const theirs = block(makeComment({ id: fixedId('c-', 2) }))
    const cut = ours.indexOf('\n  comment by')
    const cut2 = theirs.indexOf('\n  comment by')
    // The hunk opens inside the first block and closes inside the second one.
    const html =
      `<main>\n  ${ours.slice(0, cut)}\n<<<<<<< HEAD\n${ours.slice(cut + 1)}\n  <p>ours</p>\n=======\n` +
      `  ${theirs.slice(0, cut2)}\n>>>>>>> feature\n${theirs.slice(cut2 + 1)}\n  <button>Buy</button>\n</main>\n`
    const doc = analyzeCommentDocument(html)
    expect(doc.state).toMatchObject({ writable: false, readOnlyReason: 'conflict-markers' })
    const kinds = doc.state.blocks.map(b => (b.kind === 'damaged' ? b.reason : b.kind))
    expect(kinds).toEqual(['conflict-marker', 'conflict-marker'])
    const hunk = findConflictHunks(html)[0]
    for (const target of doc.index.elements) {
      expect(
        planInsert(doc, { targetStart: target.start, data: makeComment(), ws: 'collapse' })
      ).toEqual({
        ok: false,
        reason: 'read-only'
      })
    }
    for (const b of doc.state.blocks) {
      expect(planDelete(doc, { block: { start: b.nodeRange[0] }, rawHash: b.rawHash })).toEqual({
        ok: false,
        reason: 'read-only'
      })
    }
    expect(hunk.start).toBeLessThan(hunk.end)
  })

  it('U-072 an unterminated block → damaged unterminated, and the whole file is write-locked', () => {
    const html = `<main>\n  <p>before</p>\n  ${block().slice(0, -3)}\n  <button>Buy</button>\n</main>\n`
    const doc = analyzeCommentDocument(html)
    expect(doc.state.blocks[0]).toMatchObject({ kind: 'damaged', reason: 'unterminated' })
    expect(doc.state).toMatchObject({ writable: false, readOnlyReason: 'unterminated-block' })
    const p = doc.index.elements.find(el => el.tag === 'p')!
    expect(planInsert(doc, { targetStart: p.start, data: makeComment() })).toEqual({
      ok: false,
      reason: 'read-only'
    })
  })

  it('U-073 user text with marker-like lines is escaped on write and not mis-detected on read', () => {
    const text = ['<<<<<<< HEAD', '=======', '||||||| base', '>>>>>>> feature', '  ======='].join(
      '\n'
    )
    const data = makeComment({ msgs: [{ ...makeComment().msgs[0], text }] })
    const written = block(data)
    expect(written.split('\n').some(lineHasMarkerPrefix)).toBe(false)
    const state = parseCommentBlocks(page(written))
    expect(state).toMatchObject({ writable: true })
    expect(state.blocks[0]).toMatchObject({ kind: 'ok' })
    if (state.blocks[0].kind === 'ok') expect(state.blocks[0].data.msgs[0].text).toBe(text)
  })

  it('U-075 every damage reason the parser can report has a fixture path', () => {
    const reasons: DamageReason[] = [
      'no-data',
      'bad-json',
      'schema',
      'limits',
      'readable-mismatch',
      'conflict-marker',
      'duplicate-id',
      'in-template',
      'id-mismatch',
      'unterminated'
    ]
    const b = block()
    const variants: Record<DamageReason, string> = {
      'no-data': page(b.replace(/\n {2}@data [^\n]*/, '')),
      'bad-json': page(b.replace('"status":"open"', '"status":')),
      schema: page(b.replace('"v":1', '"v":"1"')),
      limits: page(b.replace('"view":{', '"view":{"d":[[[[[[0]]]]]],')),
      'readable-mismatch': page(b.replace('status: open', 'status: closed')),
      'conflict-marker': page(b.replace('\n  status', '\n=======\n  status')),
      'duplicate-id': page(`${b}\n  <p>a</p>\n  ${b}`),
      'in-template': `<template>${b}<p>x</p></template>`,
      'id-mismatch': page(b.replace(`id=${makeComment().id}`, `id=${fixedId('c-', 9)}`)),
      unterminated: `<p>x</p>${b.slice(0, -3)}`
    }
    for (const reason of reasons) {
      const found = parseCommentBlocks(variants[reason]).blocks.find(x => x.kind === 'damaged')
      expect(found, reason).toMatchObject({ kind: 'damaged', reason })
    }
  })
})

describe('markers in the file', () => {
  it('U-074 a complete hunk outside blocks → readOnlyReason conflict-markers', () => {
    const html = `${page(block())}<<<<<<< HEAD\n<p>a</p>\n=======\n<p>b</p>\n>>>>>>> other\n`
    const state = parseCommentBlocks(html)
    expect(state).toMatchObject({ writable: false, readOnlyReason: 'conflict-markers' })
    expect(state.blocks[0].kind).toBe('ok')
    expect(
      hasConflictHunk('<<<<<<< a\r\nx\r\n||||||| base\r\ny\r\n=======\r\nz\r\n>>>>>>> b')
    ).toBe(true)
    expect(hasConflictHunk('<<<<<<<\n=======\n>>>>>>>')).toBe(true)
  })

  it('U-076 a lone ======= or ||||||| line (ASCII art in <pre>) keeps the file writable', () => {
    const art = '<pre>\n=======\n|||||||\n  ascii art\n=======\n</pre>\n'
    expect(parseCommentBlocks(page(block()) + art)).toMatchObject({ writable: true })
    expect(hasConflictHunk('=======\n>>>>>>> x\n<<<<<<< y')).toBe(false)
    expect(hasConflictHunk('<<<<<<< HEAD\nours\n>>>>>>> theirs')).toBe(false)
    expect(hasConflictHunk('<<<<<<<< eight\n=======\n>>>>>>> b')).toBe(false)
  })

  it('a new <<<<<<< restarts an open hunk; several hunks are all found', () => {
    const text =
      '<<<<<<< a\n<<<<<<< b\nx\n=======\ny\n>>>>>>> c\nmid\n<<<<<<< d\n=======\n>>>>>>> e'
    const hunks = findConflictHunks(text)
    expect(hunks).toHaveLength(2)
    expect(text.slice(hunks[0].start, hunks[0].end)).toBe('<<<<<<< b\nx\n=======\ny\n>>>>>>> c')
  })

  it('reads a marker only as seven characters then the end of the line or a blank', () => {
    expect(markerAtLineStart('<<<<<<< HEAD')).toBe('ours')
    expect(markerAtLineStart('<<<<<<<\tHEAD')).toBe('ours')
    expect(markerAtLineStart('|||||||')).toBe('base')
    expect(markerAtLineStart('=======')).toBe('theirs-start')
    expect(markerAtLineStart('======= x')).toBeNull()
    expect(markerAtLineStart('>>>>>>>x')).toBeNull()
    expect(markerAtLineStart('<<<<<<')).toBeNull()
    expect(markerAtLineStart('')).toBeNull()
    expect(markerAtLineStart('text')).toBeNull()
    expect(lineHasMarkerPrefix('  >>>>>>>> extra')).toBe(true)
    expect(lineHasMarkerPrefix('  >>>>>> six')).toBe(false)
    expect(lineHasMarkerPrefix('plain')).toBe(false)
  })

  it('splits lines on LF, CRLF and CR', () => {
    const lines: Array<[string, number, number]> = []
    forEachLine('a\r\nb\rc\n', (line, start, end) => lines.push([line, start, end]))
    expect(lines).toEqual([
      ['a', 0, 1],
      ['b', 3, 4],
      ['c', 5, 6],
      ['', 7, 7]
    ])
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared splice with a slot the kind chose (spec 024 architecture note
 * 001 § 5, § 8 C2, C10; design markdown-format.md § 2). HTML plans are pinned
 * by splice.test.ts and the writer-bytes pins; this file covers the
 * `line-start` shape, the shape-aware read-back and the kind hooks, on an
 * index that is not HTML.
 */
import { describe, expect, it, vi } from 'vitest'
import { PREVIEW_LIMITS } from '../preview-limits'
import type { KindDocument, Slot } from './fileKind'
import { fixedId, makeComment } from './__fixtures__/commentTestData'
import { lineDocument } from './__fixtures__/lineIndex'
import {
  applySplice,
  insertRefusal,
  planDelete,
  planSlotInsert,
  sharedOriginOf,
  verifyKindSplice,
  writtenBlockStart,
  type SpliceOrigin,
  type SpliceVerifier
} from './splice'

const DATA = makeComment({ id: fixedId('c-', 7) })

const LINE_KIND: SpliceVerifier<KindDocument, SpliceOrigin> = {
  parse: lineDocument,
  verify: () => ({ ok: true })
}

function lineSlot(offset: number, indent: string): Slot {
  return { offset, shape: 'line-start', indent }
}

describe('a line-start slot', () => {
  const cases = [
    { name: 'LF', text: '- one\n- two\n', offset: 6, eol: '\n' },
    { name: 'CRLF', text: '- one\r\n- two\r\n', offset: 7, eol: '\r\n' },
    { name: 'last line, no line break', text: '- one\n- two', offset: 6, eol: '\n' },
    { name: 'BOM, first line', text: '\uFEFFpara\n', offset: 1, eol: '\n' }
  ]

  for (const { name, text, offset, eol } of cases) {
    it(`${name}: inserts indent + block + eol, reads back at its <!--, and delete(add(f)) = f`, () => {
      const indent = offset === 1 ? '' : '  '
      const doc = lineDocument(text)
      const planned = planSlotInsert(doc, lineSlot(offset, indent), DATA)
      if (!planned.ok) throw new Error(planned.reason)
      const { plan } = planned
      expect(plan).toMatchObject({ op: 'insert', start: offset, end: offset, shape: 'line-start' })
      expect(plan).not.toHaveProperty('placement')
      expect(plan.insert.startsWith(`${indent}<!-- erfana:comment v1`)).toBe(true)
      expect(plan.insert.endsWith(`-->${eol}`)).toBe(true)
      expect(writtenBlockStart(plan)).toBe(offset + indent.length)

      const added = applySplice(text, plan)
      const verified = verifyKindSplice(sharedOriginOf(doc), added, plan, LINE_KIND)
      if (!verified.ok) throw new Error(verified.reason)
      const block = verified.doc.state.blocks[0]
      expect(block.range).toEqual([offset, offset + plan.insert.length])

      const removal = planDelete(verified.doc, { block: { id: DATA.id }, rawHash: block.rawHash })
      if (!removal.ok) throw new Error(removal.reason)
      expect(applySplice(added, removal.plan)).toBe(text)
      expect(verifyKindSplice(sharedOriginOf(verified.doc), text, removal.plan, LINE_KIND).ok).toBe(true)
    })
  }

  it('fails the read-back when the plan does not say its shape (C2)', () => {
    const text = '- one\n- two\n'
    const planned = planSlotInsert(lineDocument(text), lineSlot(6, '  '), DATA)
    if (!planned.ok) throw new Error(planned.reason)
    const shapeless = { ...planned.plan, shape: undefined }
    const result = verifyKindSplice(sharedOriginOf(lineDocument(text)), applySplice(text, shapeless), shapeless, LINE_KIND)
    expect(result).toEqual({ ok: false, reason: 'block-data' })
  })
})

describe('kind hooks', () => {
  it('a growth check refuses the insert', () => {
    const result = planSlotInsert(lineDocument('a\n'), lineSlot(0, ''), DATA, () => 'meta-charset')
    expect(result).toEqual({ ok: false, reason: 'meta-charset' })
  })

  it('C1 a kind\'s hints get the document written into when it is a kind\'s parse, and nothing for a bare text and state', () => {
    const hints = vi.fn((_data: unknown, _doc?: KindDocument): readonly string[] => ['hint: about the target'])
    const note = { agentNote: ['note to agents: a test kind.'], hints }
    const doc = lineDocument('a\n')
    const planned = planSlotInsert(doc, lineSlot(0, ''), DATA, undefined, note)
    expect(planned.ok && planned.plan.insert).toContain('hint: about the target')
    planSlotInsert({ text: doc.text, state: doc.state }, lineSlot(0, ''), DATA, undefined, note)
    expect(hints.mock.calls.map(([, given]) => given)).toEqual([doc, undefined])
  })

  it('a serialize failure is the plan failure', () => {
    expect(planSlotInsert(lineDocument('a\n'), lineSlot(0, 'x'), DATA)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('the kind\'s own check runs after the counts and fails closed', () => {
    const text = 'a\n'
    const doc = lineDocument(text)
    const planned = planSlotInsert(doc, lineSlot(0, ''), DATA)
    if (!planned.ok) throw new Error(planned.reason)
    const refusing: SpliceVerifier<KindDocument, SpliceOrigin> = { parse: lineDocument, verify: () => ({ ok: false, reason: 'elements' }) }
    expect(verifyKindSplice(sharedOriginOf(doc), applySplice(text, planned.plan), planned.plan, refusing)).toEqual({
      ok: false,
      reason: 'elements'
    })
  })

  it('a before-target plan reads back at its start', () => {
    expect(writtenBlockStart({ op: 'insert', start: 4, end: 4, insert: '<!---->', shape: 'before-target' })).toBe(4)
    expect(writtenBlockStart({ op: 'replace', start: 9, end: 12, insert: '  <!---->' })).toBe(9)
  })
})

describe('insertRefusal', () => {
  it('refuses a read-only file and a full one, and allows the rest', () => {
    expect(insertRefusal(lineDocument('a\n'))).toBeUndefined()
    expect(insertRefusal({ text: '', state: { blocks: [], writable: false, readOnlyReason: 'encoding' } })).toBe('read-only')
    const full = Array.from({ length: PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE }, () => lineDocument('a').state.blocks[0])
    expect(insertRefusal({ text: '', state: { blocks: full, writable: true } })).toBe('limit')
  })
})

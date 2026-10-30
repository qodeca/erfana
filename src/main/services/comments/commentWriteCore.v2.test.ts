// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The v2 write-core edits the comment window sends (comments-v2 C-13
 * "Reply and resolve", OD-05 "Rebuild from data", spec 024 024-FR-004 words
 * dropped). Runs the real Markdown kind and write core in process: add a
 * comment, change or damage the file, then list and write again.
 */
import { describe, expect, it, vi } from 'vitest'
import { ADA, FIXED_NOW, seededRandom } from '../../../shared/comments/__fixtures__/commentTestData'
import { decodeLossless, encodeText } from '../../../shared/comments/encoding'
import type { CommentFileKind, PickedTarget } from '../../../shared/comments/fileKind'
import type { TextQuote } from '../../../shared/comments/format'
import { markdownKind } from '../../../shared/markdownComments/markdownKind'
import type { MdIndex } from '../../../shared/markdownComments/mdIndex'
import { markdownTextHash } from '../../../shared/markdownComments/mdLocate'
import { createInProcessMarkdownJobs } from './markdown/markdownCommentJobs'
import { rebuildDataOf, rebuildViewOf } from './commentRebuild'
import type { ListSummary } from './commentListCore'
import { assembleSplice, runWriteJob, type ByteSplice, type WritePlanRequest } from './commentWriteCore'

const VIEW = { w: 900, h: 700, dpr: 2, x: 0, y: 0 }
const DOC = '# Plan\n\nWe ship by Friday.\n'
const ACT = { author: ADA, nowMs: FIXED_NOW.getTime() }

function pickOn(text: string): PickedTarget {
  const index = markdownKind.parse(text, 0).index as MdIndex
  const target = index.elements.find(t => t.tag === 'p')
  if (target === undefined) throw new Error('no paragraph')
  return { lineStart: target.line, lineEnd: target.lineEnd, tag: 'p', ordinal: 1, baseHash: markdownTextHash(index.text) }
}

/** Runs one write on `text`; the new text and the job's answer. */
async function write(text: string, request: WritePlanRequest) {
  const bytes = encodeText(text)
  const result = await createInProcessMarkdownJobs({ random: seededRandom(7) }).runJob(bytes, { kind: 'write', request, act: ACT })
  if (result.kind !== 'write') throw new Error('not a write')
  if (!result.ok) return { result, text: null }
  const out = decodeLossless(assembleSplice(bytes, result))
  if (!out.ok) throw new Error('decode')
  return { result, text: out.text }
}

async function list(text: string): Promise<ListSummary> {
  const result = await createInProcessMarkdownJobs().runJob(encodeText(text), { kind: 'list' })
  if (result.kind !== 'list' || !result.ok) throw new Error('list failed')
  return result.summary
}

async function commented(sel?: TextQuote): Promise<string> {
  const { text } = await write(DOC, { op: 'pick', pick: pickOn(DOC), view: VIEW, text: 'Please look.', ...(sel === undefined ? {} : { sel }) })
  if (text === null) throw new Error('add failed')
  return text
}

describe('C-13 Reply and resolve is one write', () => {
  it('C-13 a reply with resolve adds the reply and resolves the thread in the same write', async () => {
    const before = await commented()
    const [thread] = (await list(before)).threads
    const { text } = await write(before, {
      op: 'thread',
      threadId: thread.threadId,
      rawHash: thread.rawHash,
      change: { op: 'reply', text: 'Done.', resolve: true }
    })
    const [after] = (await list(text ?? '')).threads
    expect(after.status).toBe('resolved')
    expect(after.messages.map(m => m.text)).toEqual(['Please look.', 'Done.'])
  })

  it('C-13 a plain reply leaves the thread open', async () => {
    const before = await commented()
    const [thread] = (await list(before)).threads
    const { text } = await write(before, { op: 'thread', threadId: thread.threadId, rawHash: thread.rawHash, change: { op: 'reply', text: 'Later.' } })
    expect((await list(text ?? '')).threads[0].status).toBe('open')
  })
})

describe('024-FR-004 words dropped', () => {
  it('024-FR-004 words the kind cannot keep are dropped, and the write result says so', async () => {
    const { result } = await write(DOC, {
      op: 'pick',
      pick: pickOn(DOC),
      view: VIEW,
      text: 'Please look.',
      sel: { exact: 'Thursday', prefix: 'by ', suffix: '.' }
    })
    expect(result).toMatchObject({ ok: true, wordsDropped: true })
  })

  it('024-FR-004 kept words, or none asked for, say nothing', async () => {
    const kept = await write(DOC, { op: 'pick', pick: pickOn(DOC), view: VIEW, text: 'x', sel: { exact: 'Friday', prefix: 'by ', suffix: '.' } })
    expect(kept.result).not.toHaveProperty('wordsDropped')
    const whole = await write(DOC, { op: 'pick', pick: pickOn(DOC), view: VIEW, text: 'x' })
    expect(whole.result).not.toHaveProperty('wordsDropped')
  })
})

describe('OD-05 Rebuild from data', () => {
  it('OD-05 a hand-edited readable line is offered for rebuild, file line against data line', async () => {
    const good = await commented()
    const damaged = good.replace('  Please look.\n@data', '  Please lok.\n@data')
    const [block] = (await list(damaged)).damaged
    expect(block.reason).toBe('readable-mismatch')
    expect(block.rebuild?.lines).toContainEqual({ file: 'Please lok.', data: 'Please look.' })
    expect(block.rebuild?.claims).toBeUndefined()
  })

  it('OD-05 rebuilding gives back the block Erfana wrote, byte for byte', async () => {
    const good = await commented()
    const damaged = good.replace('  Please look.\n@data', '  Please lok.\n@data')
    const [block] = (await list(damaged)).damaged
    const { text } = await write(damaged, { op: 'rebuild', rawHash: block.rawHash, start: block.start })
    expect(text).toBe(good)
    const summary = await list(text ?? '')
    expect(summary.damaged).toEqual([])
    expect(summary.threads[0].status).toBe('open')
  })

  it('OD-05 when only the status line differs the file claims resolved, and Mark resolved resolves', async () => {
    const good = await commented()
    const damaged = good.replace('status: open', 'status: resolved')
    const [block] = (await list(damaged)).damaged
    expect(block.rebuild?.claims).toBe('resolved')
    const { text } = await write(damaged, { op: 'rebuild', rawHash: block.rawHash, start: block.start, status: 'resolved' })
    const summary = await list(text ?? '')
    expect(summary.damaged).toEqual([])
    expect(summary.threads[0].status).toBe('resolved')
  })

  it('OD-05 Keep open rebuilds the block as the data says', async () => {
    const good = await commented()
    const damaged = good.replace('status: open', 'status: resolved')
    const [block] = (await list(damaged)).damaged
    const { text } = await write(damaged, { op: 'rebuild', rawHash: block.rawHash, start: block.start })
    expect(text).toBe(good)
  })

  it('OD-05 no rebuild without valid data: a broken data line is not offered and the write is refused', async () => {
    const good = await commented()
    const damaged = good.replace('  Please look.\n@data {', '  Please lok.\n@data {,')
    const [block] = (await list(damaged)).damaged
    expect(block.rebuild).toBeUndefined()
    const { result } = await write(damaged, { op: 'rebuild', rawHash: block.rawHash, start: block.start })
    expect(result.ok).toBe(false)
  })

  it('OD-05 a stale hash is refused, the file untouched', async () => {
    const good = await commented()
    const damaged = good.replace('  Please look.\n@data', '  Please lok.\n@data')
    const { result } = await write(damaged, { op: 'rebuild', rawHash: 'a'.repeat(64) })
    expect(result.ok).toBe(false)
  })

  it('OD-05 only readable and id mismatches are rebuildable', () => {
    expect(rebuildViewOf('<!-- erfana:comment v1 -->', 'bad-json')).toBeUndefined()
    expect(rebuildDataOf('<!-- erfana:comment v1 -->', 'bad-json')).toBeUndefined()
  })
})

describe('runWriteJob refusals (024-AC-038)', () => {
  /** The `write` job on `text`, with `kind`'s fresh parse – no cached reader. */
  const run = (text: string, request: WritePlanRequest, kind: CommentFileKind = markdownKind) =>
    runWriteJob(encodeText(text), { kind: 'write', request, act: ACT }, { kind, random: seededRandom(7) })
  const pick = (text: string): WritePlanRequest => ({ op: 'pick', pick: pickOn(text), view: VIEW, text: 'Please look.' })

  it('OD-05 of two identical damaged blocks, the one at the start the window read is rebuilt', async () => {
    const good = await commented()
    const damaged = good.replace('  Please look.\n@data', '  Please lok.\n@data')
    const [block] = (await list(damaged)).damaged
    const raw = damaged.slice(block.start, damaged.indexOf('-->', block.start) + 3)
    const twice = `${damaged}\n${raw}\n\nMore.\n`
    const both = (await list(twice)).damaged
    expect(both.map(b => b.rawHash)).toEqual([block.rawHash, block.rawHash])
    const result = run(twice, { op: 'rebuild', rawHash: block.rawHash, start: block.start })
    expect(result).toMatchObject({ ok: true, byteStart: block.start })
    const out = decodeLossless(assembleSplice(encodeText(twice), result as ByteSplice))
    if (!out.ok) throw new Error('decode')
    expect(out.text.startsWith(good)).toBe(true)
  })

  it('a page draft names HTML offsets and anchors: on a Markdown file it is invalid, and nothing is planned', () => {
    const draft = { offset: 0, fileHash: 'a'.repeat(64), anchor: { tag: 'p', path: '' } }
    expect(run(DOC, { op: 'add', draft, view: VIEW, text: 'x' })).toEqual({ kind: 'write', ok: false, refusal: 'invalid' })
  })

  it('a kind that offers no slot for the target it found refuses the save as target-moved', () => {
    expect(run(DOC, pick(DOC), { ...markdownKind, slots: () => [] })).toEqual({ kind: 'write', ok: false, refusal: 'target-moved' })
  })

  it('a kind\'s growth refusal at a slot refuses the save with its reason, before anything is verified', () => {
    const verify = vi.fn(markdownKind.verify)
    const refusing: CommentFileKind = { ...markdownKind, refuseGrowth: () => 'meta-charset', verify }
    expect(run(DOC, pick(DOC), refusing)).toEqual({ kind: 'write', ok: false, refusal: 'meta-charset' })
    expect(verify).not.toHaveBeenCalled()
  })

  it('C25 a slot failing a shared check refuses as verify-failed – never tried at the next slot as render-changed', () => {
    // A parse that loses the new block: the block count check fails before the kind's own check runs.
    const verify = vi.fn(markdownKind.verify)
    const losing: CommentFileKind = {
      ...markdownKind,
      verify,
      parse: (text, bom) => {
        const doc = markdownKind.parse(text, bom)
        return text.includes('erfana:comment') ? { ...doc, state: { ...doc.state, blocks: [] } } : doc
      }
    }
    expect(run(DOC, pick(DOC), losing)).toEqual({ kind: 'write', ok: false, refusal: 'verify-failed' })
    expect(verify).not.toHaveBeenCalled()
  })
})

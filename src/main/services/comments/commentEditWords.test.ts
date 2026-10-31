// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words of an existing Markdown comment and the place of its target
 * (comments-v2 C-07 "Narrow to words" on Edit of the first message, C-03 kind
 * nouns; spec 024 024-FR-004). Runs the real Markdown kind, list and write
 * core in process: add a comment, list it, edit it with and without words.
 */
import { describe, expect, it } from 'vitest'
import { ADA, FIXED_NOW, seededRandom } from '../../../shared/comments/__fixtures__/commentTestData'
import { decodeLossless, encodeText } from '../../../shared/comments/encoding'
import type { PickedTarget } from '../../../shared/comments/fileKind'
import type { TextQuote } from '../../../shared/comments/format'
import { markdownKind } from '../../../shared/markdownComments/markdownKind'
import type { MdIndex, MdTarget } from '../../../shared/markdownComments/mdIndex'
import { markdownTextHash } from '../../../shared/markdownComments/mdLocate'
import { COMMENT_WORDS_TEXT_MAX_CHARS } from '../../../shared/ipc/comment-common-schema'
import { createInProcessMarkdownJobs } from './markdown/markdownCommentJobs'
import type { ListSummary } from './commentListCore'
import { fittedWords } from './commentEditWords'
import { assembleSplice, type ThreadChange, type WritePlanRequest } from './commentWriteCore'

const VIEW = { w: 900, h: 700, dpr: 2, x: 0, y: 0 }
const DOC = '# Plan\n\nWe ship the beta to ten customers by Friday.\n'
const ACT = { author: ADA, nowMs: FIXED_NOW.getTime() }
const TABLE =
  '# Team\n\n| Name | Task | Due |\n| --- | --- | --- |\n| Ada | Plan | Mon |\n| Piotr | Load test | Fri |\n\n```mermaid\ngraph TD; A-->B\n```\n'

/** A pick on the first target `match` finds, with its ordinal among its tag on its line. */
function pickOn(text: string, match: (target: MdTarget) => boolean): PickedTarget {
  const index = markdownKind.parse(text, 0).index as MdIndex
  const target = index.elements.find(match)
  if (target === undefined) throw new Error('no such target')
  const sameLine = index.elements.filter(t => t.line === target.line && t.tag === target.tag)
  return {
    lineStart: target.line,
    lineEnd: target.lineEnd,
    tag: target.tag,
    ordinal: sameLine.indexOf(target) + 1,
    baseHash: markdownTextHash(index.text)
  }
}

/** Runs one write on `text`: the new text (`null` when refused) and the job's answer. */
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
  const result = await createInProcessMarkdownJobs().runJob(encodeText(text), { kind: 'list', placements: true })
  if (result.kind !== 'list' || !result.ok) throw new Error('list failed')
  return result.summary
}

async function added(text: string, match: (target: MdTarget) => boolean, sel?: TextQuote): Promise<string> {
  const pick = pickOn(text, match)
  const { text: out } = await write(text, { op: 'pick', pick, view: VIEW, text: 'Please look.', ...(sel === undefined ? {} : { sel }) })
  if (out === null) throw new Error('add failed')
  return out
}

/** An edit of the only thread's first message, with `change`'s extra fields. */
async function edit(text: string, extra: Partial<Extract<ThreadChange, { op: 'editMessage' }>> = {}) {
  const [thread] = (await list(text)).threads
  const change: ThreadChange = { op: 'editMessage', messageId: thread.messages[0].id, text: 'Edited.', ...extra }
  return write(text, { op: 'thread', threadId: thread.threadId, rawHash: thread.rawHash, change })
}

const paragraph = (target: MdTarget): boolean => target.tag === 'p'
const SHIP = 'We ship the beta to ten customers by Friday.'

describe('024-AC-005 C-07 a listed Markdown thread carries the Narrow to words text', () => {
  it('024-AC-005 C-07 the target\'s rendered text, with no range for a comment on the whole paragraph', async () => {
    const [thread] = (await list(await added(DOC, paragraph))).threads
    expect(thread.words).toEqual({ text: SHIP, start: 0, end: 0, cut: false })
  })

  it('024-AC-005 C-07 the range of the words a selection comment is about', async () => {
    const [thread] = (await list(await added(DOC, paragraph, { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' }))).threads
    expect(thread.words).toEqual({ text: SHIP, start: 20, end: 33, cut: false })
  })

  it('024-AC-005 C-07 a target with no text (a divider) offers no field', async () => {
    const [thread] = (await list(await added('Intro.\n\n---\n', target => target.tag === 'hr'))).threads
    expect(thread.words).toBeUndefined()
  })

  it('024-AC-036 C-07 the field\'s text is capped as a new comment\'s: past the cap only the part around the words, else none', () => {
    const long = `${'word '.repeat(COMMENT_WORDS_TEXT_MAX_CHARS / 2)}end`
    expect(fittedWords({ text: long, start: 0, end: 0, cut: false })).toBeUndefined()
    const around = fittedWords({ text: long, start: 6_000, end: 6_004, cut: false })
    expect(around?.text.length).toBeLessThanOrEqual(COMMENT_WORDS_TEXT_MAX_CHARS)
    expect(around?.text.slice(around.start, around.end)).toBe(long.slice(6_000, 6_004))
  })
})

describe('024-AC-005 C-07 Edit on the first message sets, changes and clears anchor.sel', () => {
  it('024-AC-005 C-07 sets the words on a comment about the whole paragraph', async () => {
    const { result, text } = await edit(await added(DOC, paragraph), { sel: { exact: 'ten customers', prefix: 'to ', suffix: ' by' } })
    expect(result.ok && result.wordsDropped).toBeFalsy()
    const summary = await list(text!)
    expect(summary.threads[0].words).toMatchObject({ start: 20, end: 33 })
    expect(summary.placements?.[0].sel).toEqual({ exact: 'ten customers', prefix: 'We ship the beta to ', suffix: ' by Friday.' })
    expect(summary.threads[0].messages[0].text).toBe('Edited.')
  })

  it('024-AC-005 C-07 changes the words, and clears them with null', async () => {
    const before = await added(DOC, paragraph, { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' })
    const changed = (await edit(before, { sel: { exact: 'by Friday', prefix: 'customers ', suffix: '.' } })).text!
    expect((await list(changed)).threads[0].words).toMatchObject({ start: 34, end: 43 })
    // The agent note's words hint follows the words (C-01).
    expect(changed).toContain('comment is about the words (when commented): "by Friday"')
    const cleared = (await edit(changed, { sel: null })).text!
    expect((await list(cleared)).threads[0].words).toMatchObject({ start: 0, end: 0 })
    expect((await list(cleared)).placements?.[0].sel).toBeUndefined()
    expect(cleared).not.toContain('comment is about the words')
  })

  it('024-AC-005 C-07 D-16 words that are not in the file as written are dropped, and the write says so', async () => {
    const before = await added(DOC, paragraph, { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' })
    const { result, text } = await edit(before, { sel: { exact: 'by Thursday', prefix: '', suffix: '' } })
    expect(result.ok && result.wordsDropped).toBe(true)
    const summary = await list(text!)
    expect(summary.placements?.[0].sel).toBeUndefined()
    expect(summary.threads[0].messages[0].text).toBe('Edited.')
  })

  it('024-AC-005 C-07 an edit without sel keeps the stored words and writes the same bytes as before C-07', async () => {
    const before = await added(DOC, paragraph, { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' })
    const plain = await edit(before)
    const explicit = await edit(before, { sel: undefined })
    expect(explicit.text).toBe(plain.text)
    expect(plain.result.ok && plain.result.wordsDropped).toBeFalsy()
    expect((await list(plain.text!)).placements?.[0].sel?.exact).toBe('ten customers')
  })

  it('024-AC-028 C-07 words on a reply are refused and nothing is written: only the first message names them', async () => {
    const before = await added(DOC, paragraph)
    const [thread] = (await list(before)).threads
    const replied = (await write(before, { op: 'thread', threadId: thread.threadId, rawHash: thread.rawHash, change: { op: 'reply', text: 'Later.' } })).text!
    const [again] = (await list(replied)).threads
    const reply = again.messages[1].id
    const change: ThreadChange = { op: 'editMessage', messageId: reply, text: 'x', sel: { exact: 'ten', prefix: '', suffix: '' } }
    const { result, text } = await write(replied, { op: 'thread', threadId: again.threadId, rawHash: again.rawHash, change })
    expect(text).toBeNull()
    expect(result.ok ? null : result.refusal).toBe('invalid')
  })

  it('024-AC-005 C-07 a list item\'s words are checked in the list item a comment is about, below its carrier', async () => {
    const before = await added('- First item here\n- Second\n', target => target.tag === 'li')
    const [thread] = (await list(before)).threads
    expect(thread.words?.text).toBe('First item here')
    const { result } = await edit(before, { sel: { exact: 'item', prefix: 'First ', suffix: ' here' } })
    expect(result.ok && result.wordsDropped).toBeFalsy()
    const { result: elsewhere } = await edit(before, { sel: { exact: 'Second', prefix: '', suffix: '' } })
    expect(elsewhere.ok && elsewhere.wordsDropped).toBe(true)
  })
})

describe('024-AC-008 C-03 main names a table row, a cell and a diagram by place', () => {
  const second = (target: MdTarget): boolean => target.kind === 'row' && target.block.index === 2

  it('024-AC-008 C-03 body row 2 is "row 2" on the thread and on its placement', async () => {
    const summary = await list(await added(TABLE, second))
    expect(summary.threads[0].place).toEqual({ kind: 'row', row: 2 })
    expect(summary.placements?.[0]).toMatchObject({ tag: 'tr', place: { kind: 'row', row: 2 } })
  })

  it('024-AC-008 C-03 the header row is the header row', async () => {
    const summary = await list(await added(TABLE, target => target.kind === 'row' && target.block.index === 0))
    expect(summary.threads[0].place).toEqual({ kind: 'header-row' })
  })

  it('024-AC-008 C-03 a body cell is "row 2, column 3"; a header cell names its column', async () => {
    const cell = await list(await added(TABLE, target => target.kind === 'cell' && target.block.parent?.index === 2 && target.block.index === 2))
    expect(cell.threads[0].place).toEqual({ kind: 'cell', row: 2, column: 3 })
    const header = await list(await added(TABLE, target => target.kind === 'cell' && target.block.parent?.index === 0 && target.block.index === 1))
    expect(header.threads[0].place).toEqual({ kind: 'header-cell', column: 2 })
  })

  it('024-AC-008 C-03 a Mermaid block is a diagram; a paragraph has no place', async () => {
    const diagram = await list(await added(TABLE, target => target.kind === 'diagram'))
    expect(diagram.threads[0].place).toEqual({ kind: 'diagram' })
    expect(diagram.placements?.[0]).toMatchObject({ tag: 'pre', place: { kind: 'diagram' } })
    expect((await list(await added(DOC, paragraph))).threads[0].place).toBeUndefined()
  })
})

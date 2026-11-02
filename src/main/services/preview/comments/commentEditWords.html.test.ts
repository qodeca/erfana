// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words of an existing HTML Preview comment (comments-v2 C-07 "Narrow to
 * words" on Edit of the first message; spec 024 024-FR-004, D-16). Runs the
 * HTML writer's real jobs in process: add a comment from a page draft, list
 * it, edit its first message with and without words.
 */
import { describe, expect, it } from 'vitest'
import { ADA, FIXED_NOW, seededRandom } from '../../../../shared/comments/__fixtures__/commentTestData'
import { decodeLossless, encodeText } from '../../../../shared/comments/encoding'
import type { TextQuote } from '../../../../shared/comments/format'
import { buildDraftAnchor, type HtmlIndex } from '../../../../shared/htmlComments'
import { htmlKind } from '../../../../shared/comments/htmlKind'
import { sha256HexOf } from '../../comments/commentJobDocs'
import type { ListSummary } from '../../comments/commentListCore'
import { assembleSplice, type ThreadChange, type WritePlanRequest } from '../../comments/commentWriteCore'
import { createInProcessCommentFileJobs } from './htmlCommentJobs'

const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }
const ACT = { author: ADA, nowMs: FIXED_NOW.getTime() }
const PAGE = '<!doctype html><html><body><main>\n<p id="ship">We ship the beta to ten customers by Friday.</p>\n</main></body></html>\n'
const SHIP = 'We ship the beta to ten customers by Friday.'

async function write(text: string, request: WritePlanRequest) {
  const bytes = encodeText(text)
  const result = await createInProcessCommentFileJobs({ random: seededRandom(3) }).runJob(bytes, { kind: 'write', request, act: ACT })
  if (result.kind !== 'write') throw new Error('not a write')
  if (!result.ok) return { result, text: null }
  const out = decodeLossless(assembleSplice(bytes, result))
  if (!out.ok) throw new Error('decode')
  return { result, text: out.text }
}

async function list(text: string): Promise<ListSummary> {
  const result = await createInProcessCommentFileJobs().runJob(encodeText(text), { kind: 'list' })
  if (result.kind !== 'list' || !result.ok) throw new Error('list failed')
  return result.summary
}

/** A comment on the `<p>`, from a page draft as the HTML Preview makes one; `runtime`: on a script-built child. */
async function added(sel?: TextQuote, runtime = false): Promise<string> {
  const index = htmlKind.parse(PAGE, 0).index as HtmlIndex
  const el = index.elements.find(e => e.tag === 'p')!
  const built = buildDraftAnchor(index, el, runtime ? { path: 'span', tag: 'span', snapshotSource: 'page' } : undefined)
  const anchor = sel === undefined ? built : { ...built, sel }
  const draft = { offset: el.start, fileHash: sha256HexOf(encodeText(PAGE)), anchor }
  const { text } = await write(PAGE, { op: 'add', draft, view: VIEW, text: 'Please look.' })
  if (text === null) throw new Error('add failed')
  return text
}

async function edit(text: string, extra: Partial<Extract<ThreadChange, { op: 'editMessage' }>> = {}) {
  const [thread] = (await list(text)).threads
  const change: ThreadChange = { op: 'editMessage', messageId: thread.messages[0].id, text: 'Edited.', ...extra }
  return write(text, { op: 'thread', threadId: thread.threadId, rawHash: thread.rawHash, change })
}

describe('024-AC-004 C-07 Edit on an HTML comment\'s first message narrows it to words', () => {
  it('024-AC-004 C-07 a listed thread carries the element\'s text from main\'s parse, and its stored words\' range', async () => {
    expect((await list(await added())).threads[0].words).toEqual({ text: SHIP, start: 0, end: 0, cut: false })
    const narrowed = await added({ exact: 'ten customers', prefix: 'beta to ', suffix: ' by' })
    expect((await list(narrowed)).threads[0].words).toEqual({ text: SHIP, start: 20, end: 33, cut: false })
  })

  it('024-AC-004 C-07 a script-built element has no words in the file: no field', async () => {
    expect((await list(await added(undefined, true))).threads[0].words).toBeUndefined()
  })

  it('024-AC-004 C-07 sets, changes and clears anchor.sel', async () => {
    const set = (await edit(await added(), { sel: { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' } })).text!
    expect((await list(set)).threads[0].words).toMatchObject({ start: 20, end: 33 })
    expect(set).toContain('comment is about the words (when commented): "ten customers"')
    const changed = (await edit(set, { sel: { exact: 'Friday', prefix: 'by ', suffix: '.' } })).text!
    expect((await list(changed)).threads[0].words).toMatchObject({ start: 37, end: 43 })
    const cleared = (await edit(changed, { sel: null })).text!
    expect((await list(cleared)).threads[0].words).toMatchObject({ start: 0, end: 0 })
    expect(cleared).not.toContain('comment is about the words')
  })

  it('024-AC-004 C-07 D-16 words not found exactly once in their context are dropped, and the write says so', async () => {
    const { result, text } = await edit(await added(), { sel: { exact: 'Thursday', prefix: '', suffix: '' } })
    expect(result.ok && result.wordsDropped).toBe(true)
    expect((await list(text!)).threads[0]).toMatchObject({ words: { start: 0, end: 0 }, messages: [{ text: 'Edited.' }] })
  })

  it('024-AC-004 C-07 an edit without sel writes what it always did and keeps the words', async () => {
    const before = await added({ exact: 'ten customers', prefix: 'beta to ', suffix: ' by' })
    const plain = await edit(before)
    expect((await edit(before, { sel: undefined })).text).toBe(plain.text)
    expect((await list(plain.text!)).threads[0].words).toMatchObject({ start: 20, end: 33 })
  })
})

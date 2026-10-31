// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment file jobs and the document cache they share
 * (docs/designs/comments/html-preview-comments.md §19 R3-12; spec 024
 * architecture note 001 § 8 C19, C22). The jobs themselves are exercised end
 * to end by the draft, opener, list and writer suites through the in-process
 * runner; this suite pins the job registry, the HTML table's use of the
 * cache, the cache rules – by file kind and content hash – and the splice
 * helpers main relies on.
 */
import { describe, expect, it, vi } from 'vitest'
import { analyzeCommentDocument, encodeText, type CommentDocument, type FileCommentState } from '../../../shared/htmlComments'
import type { CommentFileKind, KindDocument } from '../../../shared/comments/fileKind'
import { htmlKind } from '../../../shared/comments/htmlKind'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { FIXED_NOW, VIEW } from '../../../shared/comments/__fixtures__/commentTestData'
import { buttonBlock } from '../preview/comments/__test-helpers__/commentParseBench'
import { byId, draftFor, PAGE } from '../preview/comments/__test-helpers__/commentWriterHarness'
import { createInProcessCommentFileJobs, htmlCommentJobTable, type HtmlCommentJob } from '../preview/comments/htmlCommentJobs'
import { CommentJobRegistry, type CommentFileJob, type CommentJobEnv, type JobResultOf } from './commentFileJobs'
import {
  CommentDocCache,
  addRefusal,
  documentOf,
  freshDocumentOf,
  freshKindDocumentOf,
  kindDocumentOf,
  readOnlyRefusal,
  sha256HexOf,
  writableRefusal
} from './commentJobDocs'
import { storedQuoteOf } from './commentListCore'
import { assembleSplice, isSpliceWithin } from './commentWriteCore'

const BYTES = encodeText(PAGE)
const COMMENTED = encodeText(PAGE.replace('    <button', `    ${buttonBlock(1)}<button`))
const ACT = { author: { name: 'Ada', role: 'human' as const }, nowMs: FIXED_NOW.getTime() }

/** A fresh document cache's HTML slice. */
const htmlDocs = (docs = new CommentDocCache()) => docs.forKind<CommentDocument>(htmlKind.id)

/** Run `job` with the HTML kind's table, as the worker does. */
function runCommentFileJob<J extends HtmlCommentJob>(bytes: Uint8Array, job: J, env: CommentJobEnv<CommentDocument>): JobResultOf<J> {
  const handler = htmlCommentJobTable[job.kind] as unknown as { run(bytes: Uint8Array, job: J, env: CommentJobEnv<CommentDocument>): JobResultOf<J> }
  return handler.run(bytes, job, env)
}

function addJob(bytes: Uint8Array): CommentFileJob {
  return { kind: 'write', request: { op: 'add', draft: draftFor(bytes, byId('buy')), view: VIEW, text: 'Hello' }, act: ACT }
}

describe('storedQuoteOf', () => {
  const anchor = (exact: string) => ({ tag: 'p', path: '', quote: { exact, prefix: '', suffix: '' } })

  it('is cut to the quote cap on whole characters and whole escapes', () => {
    const plain = storedQuoteOf(anchor('x'.repeat(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)))
    expect(plain).toHaveLength(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)
    // 198 characters, then an escape that would not fit whole: it is left out, not cut.
    expect(storedQuoteOf(anchor(`${'x'.repeat(198)}${String.fromCodePoint(0x200b)}`))).toBe('x'.repeat(198))
    // A character past U+FFFF is two units: one unit short of room, it is left out whole.
    expect(storedQuoteOf(anchor(`${'x'.repeat(199)}${String.fromCodePoint(0x1f600)}`))).toBe('x'.repeat(199))
  })

  it('shows line breaks and controls as escapes, and has nothing to show for an anchor without a quote', () => {
    expect(storedQuoteOf(anchor('a\nb\u0007'))).toBe('a\\u000ab\\u0007')
    expect(storedQuoteOf({ tag: 'p', path: '' })).toBeUndefined()
    expect(storedQuoteOf(anchor(String.fromCodePoint(0x1f600)))).toBe(String.fromCodePoint(0x1f600))
  })
})

describe('CommentDocCache', () => {
  it('keeps the most recently used documents within its entry and byte budgets', () => {
    const doc = analyzeCommentDocument('<p>x</p>')
    const docs = new CommentDocCache(10, 2)
    const cache = htmlDocs(docs)
    cache.set('a', doc, 4)
    cache.set('b', doc, 4)
    expect(cache.get('a')).toBe(doc) // a is now the most recent
    cache.set('c', doc, 4) // over both budgets: b, the least recent, goes
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(doc)
    expect(cache.get('c')).toBe(doc)
    cache.set('big', doc, 11) // over the byte budget on its own: not kept, nothing evicted
    expect(cache.get('big')).toBeUndefined()
    expect(docs.size).toBe(2)
    cache.set('a', doc, 9) // re-set: counted once, and the other entry makes room
    expect(docs.size).toBe(1)
    expect(cache.get('a')).toBe(doc)
  })

  it('C19 keys by file kind and content hash: one kind never reads another kind’s document, and they share one budget', () => {
    const html = analyzeCommentDocument('<p>x</p>')
    const other = { notHtml: true }
    const docs = new CommentDocCache(10, 3)
    docs.forKind<CommentDocument>('html').set('h', html, 4)
    expect(docs.forKind('markdown').get('h')).toBeUndefined()
    docs.forKind<object>('markdown').set('h', other, 4)
    expect(docs.forKind<CommentDocument>('html').get('h')).toBe(html)
    expect(docs.forKind<object>('markdown').get('h')).toBe(other)
    expect(docs.size).toBe(2)
    // Over the shared byte budget: the least recently used entry goes, whatever its kind.
    docs.forKind<object>('txt').set('h', other, 4)
    expect(docs.forKind<CommentDocument>('html').get('h')).toBeUndefined()
    expect(docs.size).toBe(2)
  })

  it('documentOf parses once per content hash; a failed parse is not kept', () => {
    const docs = new CommentDocCache()
    const cache = htmlDocs(docs)
    const first = documentOf(BYTES, cache)
    const second = documentOf(new Uint8Array(BYTES), cache)
    expect(first.ok && second.ok && second.doc).toBe(first.ok && first.doc)
    expect(first.hash).toBe(sha256HexOf(BYTES))
    expect(documentOf(Uint8Array.from([0xff, 0xfe]), cache)).toMatchObject({ ok: false, refusal: 'encoding' })
    expect(docs.size).toBe(1)
  })

  it('freshDocumentOf never reads or fills the cache', () => {
    const cache = htmlDocs()
    const cached = documentOf(BYTES, cache)
    const fresh = freshDocumentOf(BYTES)
    expect(fresh.ok && cached.ok && fresh.doc).not.toBe(cached.ok && cached.doc)
  })

  it('names why a parsed state may not be written', () => {
    expect(writableRefusal({ blocks: [], writable: true })).toBeNull()
    expect(writableRefusal({ blocks: [], writable: false, readOnlyReason: 'conflict-markers' })).toBe('conflict-markers')
    expect(readOnlyRefusal({ blocks: [], writable: false })).toBe('read-only')
  })

  it('F-04 names why no new comment may be added: read-only first, then a file already at the block cap', () => {
    const block = analyzeCommentDocument(PAGE.replace('    <button', `    ${buttonBlock(1)}<button`)).state.blocks[0]
    const full = Array(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE).fill(block)
    expect(addRefusal({ blocks: [], writable: true })).toBeNull()
    expect(addRefusal({ blocks: full.slice(1), writable: true })).toBeNull()
    expect(addRefusal({ blocks: full, writable: true })).toBe('too-many-blocks')
    expect(addRefusal({ blocks: full, writable: false, readOnlyReason: 'unterminated-block' })).toBe('unterminated-block')
  })
})

describe('a kind\'s document (spec 024 architecture note 001 § 5 steps 4–5)', () => {
  /** A kind that records what it was asked to parse and answers `state`. */
  function fakeKind(state: FileCommentState = { blocks: [], writable: true }) {
    const parse = vi.fn((text: string, bom: number): KindDocument => ({ text, index: { bom } as unknown as KindDocument['index'], state }))
    return { kind: { id: 'fake', parse } as unknown as CommentFileKind, parse }
  }

  it('024-AC-038 a file over the comment size limit is too-large before it is decoded or parsed', () => {
    const { kind, parse } = fakeKind()
    const bytes = new Uint8Array(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES + 1).fill(0x20)
    expect(freshKindDocumentOf(bytes, kind)).toEqual({ ok: false, hash: sha256HexOf(bytes), refusal: 'too-large' })
    expect(parse).not.toHaveBeenCalled()
  })

  it('024-AC-038 bytes that are not lossless UTF-8 are refused as encoding, unparsed', () => {
    const { kind, parse } = fakeKind()
    expect(freshKindDocumentOf(Uint8Array.from([0x61, 0xff]), kind)).toMatchObject({ ok: false, refusal: 'encoding' })
    expect(parse).not.toHaveBeenCalled()
  })

  it('024-NFR-008 a kind that marks the file too-large itself is refused the same way', () => {
    const { kind } = fakeKind({ blocks: [], writable: false, readOnlyReason: 'too-large' })
    expect(freshKindDocumentOf(encodeText('# big'), kind)).toMatchObject({ ok: false, refusal: 'too-large' })
  })

  it('a kind\'s other read-only reasons stay a document, for the planner to word', () => {
    const { kind } = fakeKind({ blocks: [], writable: false, readOnlyReason: 'conflict-markers' })
    expect(freshKindDocumentOf(encodeText('<<<<<<< ours'), kind)).toMatchObject({ ok: true, doc: { state: { readOnlyReason: 'conflict-markers' } } })
  })

  it('the kind parses the decoded text, told whether a BOM leads it', () => {
    const { kind, parse } = fakeKind()
    freshKindDocumentOf(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]), kind)
    freshKindDocumentOf(encodeText('a'), kind)
    expect(parse.mock.calls.map(([, bom]) => bom)).toEqual([1, 0])
  })

  it('C19 kindDocumentOf parses once per content hash, and never keeps a refusal', () => {
    const docs = new CommentDocCache()
    const cache = docs.forKind<KindDocument>('fake')
    const { kind, parse } = fakeKind()
    const first = kindDocumentOf(encodeText('a'), kind, cache)
    const second = kindDocumentOf(encodeText('a'), kind, cache)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
    expect(kindDocumentOf(Uint8Array.from([0xff]), kind, cache)).toMatchObject({ ok: false, refusal: 'encoding' })
    expect(docs.size).toBe(1)
  })
})

describe('the HTML job table', () => {
  it('read-only jobs take the cached document; the write parses afresh and caches what it verified', () => {
    const cache = htmlDocs()
    // A different document planted under this file's hash: a job that takes the cache sees it.
    cache.set(sha256HexOf(BYTES), analyzeCommentDocument(new TextDecoder().decode(COMMENTED)), BYTES.length)

    const listed = runCommentFileJob(BYTES, { kind: 'list' }, { cache })
    expect(listed).toMatchObject({ kind: 'list', ok: true, summary: { threads: [{}] } })

    const written = runCommentFileJob(BYTES, addJob(BYTES), { cache })
    if (written.kind !== 'write' || !written.ok) throw new Error('expected a write')
    // Planned on the real bytes: the block goes on the button's own line of PAGE, not of the planted page.
    const button = PAGE.indexOf('<button')
    expect(written.byteStart).toBeGreaterThan(PAGE.lastIndexOf('\n', button))
    expect(written.byteStart).toBeLessThanOrEqual(button)
    const out = assembleSplice(BYTES, written)
    expect(written.inputHash).toBe(sha256HexOf(BYTES))
    expect(written.outputHash).toBe(sha256HexOf(out))
    const after = runCommentFileJob(out, { kind: 'list' }, { cache })
    expect(after).toMatchObject({ kind: 'list', ok: true, summary: { threads: [{ threadId: written.threadId }] } })
  })

  it('a pin on a file that changed since it was served, or cannot be read, has no blocks', () => {
    const cache = htmlDocs()
    const entry = { startOffset: PAGE.indexOf('<button'), tagName: 'button', fileHash: 'not-this-file' }
    expect(runCommentFileJob(BYTES, { kind: 'pin', entry, blocks: true }, { cache })).toEqual({ kind: 'pin', blocks: [] })
    const unreadable = Uint8Array.from([0xff, 0xfe])
    expect(runCommentFileJob(unreadable, { kind: 'pin', entry: { ...entry, fileHash: sha256HexOf(unreadable) }, blocks: true }, { cache })).toEqual({ kind: 'pin', blocks: [] })
  })

  it('M4 a pin job answers the blocks on the element and its draft from one parse', () => {
    const damaged = PAGE.replace('    <button', '    <!-- erfana:comment v1 c-damaged {not json -->\n    <button')
    const bytes = encodeText(damaged)
    const entry = { startOffset: damaged.indexOf('<button'), tagName: 'button', fileHash: sha256HexOf(bytes) }
    const cache = htmlDocs()
    const both = runCommentFileJob(bytes, { kind: 'pin', entry, blocks: true, pick: {} }, { cache })
    if (both.kind !== 'pin') throw new Error('expected a pin answer')
    expect(both.draft).toMatchObject({ kind: 'draft', ok: true, offset: entry.startOffset, fileHash: entry.fileHash })
    expect(both.blocks).toHaveLength(1)
    expect(both.blocks[0].start).toBe(damaged.indexOf('<!-- erfana:comment'))
    // Without a pick there is no draft; without blocks asked, none are looked for.
    expect(runCommentFileJob(bytes, { kind: 'pin', entry, blocks: true }, { cache })).toEqual({ kind: 'pin', blocks: both.blocks })
    expect(runCommentFileJob(bytes, { kind: 'pin', entry, blocks: false, pick: {} }, { cache })).toMatchObject({ kind: 'pin', blocks: [], draft: { ok: true } })
  })

  it('a write on a file that cannot be read for comments is refused with the parse reason', () => {
    expect(runCommentFileJob(Uint8Array.from([0xff, 0xfe]), addJob(BYTES), { cache: htmlDocs() })).toEqual({ kind: 'write', ok: false, refusal: 'encoding' })
  })
})

describe('CommentJobRegistry', () => {
  const table = htmlCommentJobTable

  it('finds a registered kind’s jobs by name, and nothing else – inherited names included', () => {
    const jobs = new CommentJobRegistry()
    jobs.register('html', table)
    expect(jobs.handlerOf('html', 'list')).toBe(table.list)
    expect(jobs.handlerOf('html', 'instrument')).toBe(table.instrument)
    for (const name of ['other', '__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
      expect(jobs.handlerOf('html', name)).toBeUndefined()
    }
    expect(jobs.handlerOf('markdown', 'list')).toBeUndefined()
    expect(jobs.handlerOf('__proto__', 'list')).toBeUndefined()
  })

  it('takes one table per kind, never an empty one, and none once frozen', () => {
    const jobs = new CommentJobRegistry()
    jobs.register('html', table)
    expect(() => jobs.register('html', table)).toThrow('already has jobs')
    expect(() => jobs.register('txt', {})).toThrow('names no job')
    expect(jobs.frozen).toBe(false)
    jobs.freeze()
    expect(jobs.frozen).toBe(true)
    expect(() => jobs.register('markdown', table)).toThrow('frozen')
    expect(jobs.handlerOf('markdown', 'list')).toBeUndefined()
  })
})

describe('createInProcessCommentFileJobs', () => {
  it('answers with a structured clone, as a worker would, and keeps its own cache', async () => {
    const jobs = createInProcessCommentFileJobs()
    const first = await jobs.runJob(COMMENTED, { kind: 'list' })
    const second = await jobs.runJob(COMMENTED, { kind: 'list' })
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })

  it('a job that throws is an error outcome, never a rejection', async () => {
    const jobs = createInProcessCommentFileJobs()
    // Not structured-cloneable: a function inside the job.
    const job = { kind: 'list', poison: () => undefined } as unknown as CommentFileJob
    expect(await jobs.runJob(BYTES, job)).toEqual({ kind: 'failed', failure: 'error' })
    // A job its kind's table does not name.
    expect(await jobs.runJob(BYTES, { kind: 'toString' } as unknown as CommentFileJob)).toEqual({ kind: 'failed', failure: 'error' })
  })
})

describe('splice helpers', () => {
  it('assembleSplice keeps every byte outside the range', () => {
    const bytes = encodeText('abcdef')
    expect(new TextDecoder().decode(assembleSplice(bytes, { byteStart: 2, byteEnd: 4, insert: encodeText('XYZ') }))).toBe('abXYZef')
    expect(new TextDecoder().decode(assembleSplice(bytes, { byteStart: 6, byteEnd: 6, insert: encodeText('!') }))).toBe('abcdef!')
  })

  it('isSpliceWithin refuses a range outside the bytes or out of order', () => {
    const insert = new Uint8Array(0)
    expect(isSpliceWithin({ byteStart: 0, byteEnd: 6, insert }, 6)).toBe(true)
    expect(isSpliceWithin({ byteStart: 0, byteEnd: 7, insert }, 6)).toBe(false)
    expect(isSpliceWithin({ byteStart: 4, byteEnd: 3, insert }, 6)).toBe(false)
    expect(isSpliceWithin({ byteStart: -1, byteEnd: 3, insert }, 6)).toBe(false)
    expect(isSpliceWithin({ byteStart: 0.5, byteEnd: 3, insert }, 6)).toBe(false)
    expect(isSpliceWithin({ byteStart: 0, byteEnd: 3, insert: [1] as unknown as Uint8Array }, 6)).toBe(false)
  })
})

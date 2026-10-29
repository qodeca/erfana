// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment file jobs and the document cache they share
 * (docs/designs/comments/html-preview-comments.md §19 R3-12). The jobs themselves are
 * exercised end to end by the draft, opener, list and writer suites through
 * the in-process runner; this suite pins the dispatcher, the cache rules and
 * the splice helpers main relies on.
 */
import { describe, expect, it } from 'vitest'
import { analyzeCommentDocument, encodeText } from '../../../../shared/htmlComments'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { FIXED_NOW, VIEW } from '../../../../shared/htmlComments/__fixtures__/commentTestData'
import { buttonBlock } from './__test-helpers__/commentParseBench'
import { byId, draftFor, PAGE } from './__test-helpers__/commentWriterHarness'
import { createInProcessCommentFileJobs, runCommentFileJob, type CommentFileJob } from './commentFileJobs'
import { CommentDocCache, documentOf, freshDocumentOf, readOnlyRefusal, sha256HexOf, writableRefusal } from './commentJobDocs'
import { storedQuoteOf } from './commentListCore'
import { assembleSplice, isSpliceWithin } from './commentWriteCore'

const BYTES = encodeText(PAGE)
const COMMENTED = encodeText(PAGE.replace('    <button', `    ${buttonBlock(1)}<button`))
const ACT = { author: { name: 'Ada', role: 'human' as const }, nowMs: FIXED_NOW.getTime() }

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
    const cache = new CommentDocCache(10, 2)
    cache.set('a', doc, 4)
    cache.set('b', doc, 4)
    expect(cache.get('a')).toBe(doc) // a is now the most recent
    cache.set('c', doc, 4) // over both budgets: b, the least recent, goes
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(doc)
    expect(cache.get('c')).toBe(doc)
    cache.set('big', doc, 11) // over the byte budget on its own: not kept, nothing evicted
    expect(cache.get('big')).toBeUndefined()
    expect(cache.size).toBe(2)
    cache.set('a', doc, 9) // re-set: counted once, and the other entry makes room
    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe(doc)
  })

  it('documentOf parses once per content hash; a failed parse is not kept', () => {
    const cache = new CommentDocCache()
    const first = documentOf(BYTES, cache)
    const second = documentOf(new Uint8Array(BYTES), cache)
    expect(first.ok && second.ok && second.doc).toBe(first.ok && first.doc)
    expect(first.hash).toBe(sha256HexOf(BYTES))
    expect(documentOf(Uint8Array.from([0xff, 0xfe]), cache)).toMatchObject({ ok: false, refusal: 'encoding' })
    expect(cache.size).toBe(1)
  })

  it('freshDocumentOf never reads or fills the cache', () => {
    const cache = new CommentDocCache()
    const cached = documentOf(BYTES, cache)
    const fresh = freshDocumentOf(BYTES)
    expect(fresh.ok && cached.ok && fresh.doc).not.toBe(cached.ok && cached.doc)
  })

  it('names why a parsed state may not be written', () => {
    expect(writableRefusal({ blocks: [], writable: true })).toBeNull()
    expect(writableRefusal({ blocks: [], writable: false, readOnlyReason: 'conflict-markers' })).toBe('conflict-markers')
    expect(readOnlyRefusal({ blocks: [], writable: false })).toBe('read-only')
  })
})

describe('runCommentFileJob', () => {
  it('read-only jobs take the cached document; the write parses afresh and caches what it verified', () => {
    const cache = new CommentDocCache()
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
    const cache = new CommentDocCache()
    const entry = { startOffset: PAGE.indexOf('<button'), tagName: 'button', fileHash: 'not-this-file' }
    expect(runCommentFileJob(BYTES, { kind: 'pin', entry, blocks: true }, { cache })).toEqual({ kind: 'pin', blocks: [] })
    const unreadable = Uint8Array.from([0xff, 0xfe])
    expect(runCommentFileJob(unreadable, { kind: 'pin', entry: { ...entry, fileHash: sha256HexOf(unreadable) }, blocks: true }, { cache })).toEqual({ kind: 'pin', blocks: [] })
  })

  it('M4 a pin job answers the blocks on the element and its draft from one parse', () => {
    const damaged = PAGE.replace('    <button', '    <!-- erfana:comment v1 c-damaged {not json -->\n    <button')
    const bytes = encodeText(damaged)
    const entry = { startOffset: damaged.indexOf('<button'), tagName: 'button', fileHash: sha256HexOf(bytes) }
    const cache = new CommentDocCache()
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
    expect(runCommentFileJob(Uint8Array.from([0xff, 0xfe]), addJob(BYTES), { cache: new CommentDocCache() })).toEqual({ kind: 'write', ok: false, refusal: 'encoding' })
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

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * C-06: the list job derives "Changed" and "Words changed" from the target as
 * it is now – never written to the file (spec 024 state table S-03, S-04).
 * Runs the real Markdown kind and write core in process: add a comment, edit
 * the file as an agent would, list again.
 */
import { describe, expect, it } from 'vitest'
import { ADA, FIXED_NOW, seededRandom } from '../../../shared/comments/__fixtures__/commentTestData'
import { decodeLossless, encodeText } from '../../../shared/comments/encoding'
import type { PickedTarget } from '../../../shared/comments/fileKind'
import { markdownKind } from '../../../shared/markdownComments/markdownKind'
import type { MdIndex } from '../../../shared/markdownComments/mdIndex'
import { markdownTextHash } from '../../../shared/markdownComments/mdLocate'
import { createInProcessMarkdownJobs } from './markdown/markdownCommentJobs'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { changeOf, nowWordsIn, wordsBetween } from './commentListChange'
import type { ListSummary } from './commentListCore'
import { assembleSplice } from './commentWriteCore'

const VIEW = { w: 900, h: 700, dpr: 2, x: 0, y: 0 }
const DOC = ['# Plan', '', 'We ship by Friday and test on staging.', '', '- Freeze the API on Monday.', ''].join('\n')

function pickOn(text: string, tag: string): PickedTarget {
  const index = markdownKind.parse(text, 0).index as MdIndex
  const target = index.elements.find(t => t.tag === tag)!
  return { lineStart: target.line, lineEnd: target.lineEnd, tag, ordinal: 1, baseHash: markdownTextHash(index.text) }
}

async function addComment(text: string, tag: string, sel?: { exact: string; prefix: string; suffix: string }): Promise<string> {
  const bytes = encodeText(text)
  const request = { op: 'pick' as const, pick: pickOn(text, tag), view: VIEW, text: 'Please look.', ...(sel === undefined ? {} : { sel }) }
  const result = await createInProcessMarkdownJobs({ random: seededRandom(7) }).runJob(bytes, {
    kind: 'write',
    request,
    act: { author: ADA, nowMs: FIXED_NOW.getTime() }
  })
  if (result.kind !== 'write' || !result.ok) throw new Error(`add failed: ${JSON.stringify(result)}`)
  const out = decodeLossless(assembleSplice(bytes, result))
  if (!out.ok) throw new Error('decode')
  return out.text
}

/** The file text with the target's own text (its last occurrence – the note above quotes it) replaced, as an agent would. */
function edit(text: string, from: string, to: string): string {
  const at = text.lastIndexOf(from)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

async function list(text: string): Promise<ListSummary> {
  const result = await createInProcessMarkdownJobs().runJob(encodeText(text), { kind: 'list', placements: true })
  if (result.kind !== 'list' || !result.ok) throw new Error('list failed')
  return result.summary
}

describe('C-06 derived Changed and Words changed in the list job', () => {
  it('C-06 an untouched target has no change', async () => {
    const summary = await list(await addComment(DOC, 'p'))
    expect(summary.threads[0].attached).toBe(true)
    expect(summary.threads[0].change).toBeUndefined()
  })

  it('C-06 (Markdown) a paragraph an agent rewrote reads as Changed with Was and Now – never Not found – and keeps its icon', async () => {
    const commented = await addComment(DOC, 'p')
    const edited = edit(commented, 'We ship by Friday and test on staging.', 'We ship by Thursday.')
    const summary = await list(edited)
    expect(summary.threads[0]).toMatchObject({
      attached: true,
      change: { state: 'changed', was: 'We ship by Friday and test on staging.', now: 'We ship by Thursday.' }
    })
    expect(summary.placements?.map(p => p.tag)).toEqual(['p'])
    // Derived only: the file still says what it said.
    expect(edited).toContain('Please look.')
  })

  it('C-06 (Markdown) words that are gone, with a unique prefix…suffix pair, read as Words changed with Now', async () => {
    const commented = await addComment(DOC, 'p', { exact: 'Friday', prefix: 'We ship by ', suffix: ' and test on staging.' })
    const summary = await list(edit(commented, 'by Friday and', 'by Thursday and'))
    expect(summary.threads[0].change).toEqual({ state: 'words', was: 'Friday', now: 'Thursday' })
  })

  it('C-06 (Markdown) words gone with no pair read as Words changed with Was only', async () => {
    const commented = await addComment(DOC, 'p', { exact: 'Friday', prefix: 'We ship by ', suffix: ' and test on staging.' })
    const summary = await list(edit(commented, 'We ship by Friday and test on staging.', 'Release whenever ready.'))
    expect(summary.threads[0].change).toEqual({ state: 'words', was: 'Friday' })
  })

  it('C-06 a resolved comment is history: no change derived', async () => {
    const commented = await addComment(DOC, 'p')
    const summary = await list(commented)
    const jobs = createInProcessMarkdownJobs({ random: seededRandom(3) })
    const bytes = encodeText(commented)
    const done = await jobs.runJob(bytes, {
      kind: 'write',
      request: { op: 'thread', threadId: summary.threads[0].threadId, rawHash: summary.threads[0].rawHash, change: { op: 'setStatus', status: 'resolved' } },
      act: { author: ADA, nowMs: FIXED_NOW.getTime() }
    })
    if (done.kind !== 'write' || !done.ok) throw new Error('resolve failed')
    const after = decodeLossless(assembleSplice(bytes, done))
    if (!after.ok) throw new Error('decode')
    const later = await list(edit(after.text, 'We ship by Friday and test on staging.', 'Gone.'))
    expect(later.threads[0].change).toBeUndefined()
  })

  it('C-06 a removed target is still Not found (S-05 wins over Changed)', async () => {
    const commented = await addComment(DOC, 'p')
    const summary = await list(edit(commented, 'We ship by Friday and test on staging.\n', ''))
    expect(summary.threads[0].attached).toBe(false)
    expect(summary.threads[0].change).toBeUndefined()
  })
})

describe('I-14 the new words a preview marks', () => {
  const sel = { exact: 'Friday', prefix: 'ship by ', suffix: ' and' }
  it('I-14 the text between the pair, with what stands around it now', () => {
    expect(nowWordsIn('We ship by Thursday and test.', sel)).toEqual({ exact: 'Thursday', prefix: 'We ship by ', suffix: ' and test.' })
  })
  it('I-14 no pair, no words to mark (S-04)', () => {
    expect(nowWordsIn('Release whenever ready.', sel)).toBeUndefined()
  })
  it('I-14 words longer than a selection can be stay unmarked: the list keeps Now for the window', () => {
    expect(nowWordsIn(`We ship by ${'x'.repeat(201)} and test.`, sel)).toBeUndefined()
  })
})

describe('C-06 wordsBetween: the unique prefix…suffix pair', () => {
  const sel = { exact: 'Friday', prefix: 'ship by ', suffix: ' and' }
  it('C-06 finds the text between one pair', () => {
    expect(wordsBetween('We ship by Thursday and test.', sel)).toBe('Thursday')
  })
  it('C-06 two pairs are no pair', () => {
    expect(wordsBetween('ship by A and ship by B and', sel)).toBeUndefined()
  })
  it('C-06 a pair more than 400 characters apart is no pair', () => {
    expect(wordsBetween(`ship by ${'x'.repeat(401)} and`, sel)).toBeUndefined()
  })
  it('C-06 no context at all is no pair', () => {
    expect(wordsBetween('anything', { exact: 'a', prefix: '', suffix: '' })).toBeUndefined()
  })
  it('L-3 the bounded search finds the same pair: a suffix just inside the gap counts, one just past it does not', () => {
    const at = { exact: 'x', prefix: '[', suffix: ']' }
    expect(wordsBetween(`[${'y'.repeat(400)}]`, at)).toBe('y'.repeat(400))
    expect(wordsBetween(`[${'y'.repeat(401)}]`, at)).toBeUndefined()
    expect(wordsBetween('] then [middle] then', at)).toBe('middle')
  })
})

describe('P-F09 a comment on a part with no text survives an agent editing above it (D-65, 024-FR-003)', () => {
  const ABOVE = 'An agent added this paragraph.\n\nAnd this one, with more to say.\n\n'
  const IMAGE = '![Architecture](docs/arch.png)\n\nThe text after it.\n'
  const DIVIDER = 'Before the rule.\n\n---\n\nAfter the rule.\n'

  it.each([
    ['an image alone in its paragraph', IMAGE, 'p'],
    ['a divider', DIVIDER, 'hr']
  ])('P-F09 %s: still found, in its place, with no false Changed', async (_name, text, tag) => {
    const commented = await addComment(text, tag)
    // A divider above too: the path of a divider below it no longer agrees.
    const summary = await list(`${ABOVE}---\n\n${commented}`)
    expect(summary.threads[0]).toMatchObject({ attached: true })
    expect(summary.threads[0].change).toBeUndefined()
    expect(summary.placements?.map(p => p.tag)).toEqual([tag])
  })

  it('P-F09 words put between the comment and its image are not "right after": it reads as Changed, never as untouched', async () => {
    const commented = await addComment(IMAGE, 'p')
    const summary = await list(edit(commented, '![Architecture]', 'Words between.\n\n![Architecture]'))
    expect(summary.threads[0].change).toEqual({ state: 'changed', was: '', now: 'Words between.' })
  })

  it('P-F09 a paragraph with text right after the block never takes the comment by position alone', async () => {
    const commented = await addComment(IMAGE, 'p')
    const summary = await list(edit(commented, '![Architecture](docs/arch.png)\n\n', ''))
    expect(summary.placements ?? []).toHaveLength(1)
    expect(summary.threads[0].change?.state).toBe('changed')
  })
})

describe('P-F10 Changed says only what was seen (S-03, D-22)', () => {
  const anchorOn = (text: string): { index: MdIndex; target: MdIndex['elements'][number] } => {
    const index = markdownKind.parse(text, 0).index as MdIndex
    return { index, target: index.elements.find(t => t.tag === 'p')! }
  }

  it('P-F10 (HTML) new classes with the same text: changed, with no Now – its text is the same', () => {
    const { index, target } = anchorOn('Same words.\n')
    const quote = { exact: 'Same words.', prefix: '', suffix: '' }
    const anchor = { tag: 'p', path: 'p', quote, cls: ['old'] }
    expect(changeOf({ index, target: { ...target, classes: ['new'] }, anchor, via: 'position', html: true })).toEqual({ state: 'changed', was: 'Same words.' })
  })

  it('P-F10 (HTML) found another way than by position, same text: changed, with no Now', () => {
    const { index, target } = anchorOn('Same words.\n')
    const anchor = { tag: 'p', path: 'p', quote: { exact: 'Same words.', prefix: '', suffix: '' } }
    expect(changeOf({ index, target, anchor, via: 'quote', html: true })).toEqual({ state: 'changed', was: 'Same words.' })
  })

  it('P-F10 a long text that differs only past the quote cap still counts as changed text: Now stays', () => {
    const long = 'x'.repeat(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)
    const { index, target } = anchorOn(`${long} now.\n`)
    const anchor = { tag: 'p', path: 'p', quote: { exact: `${long} was.`, prefix: '', suffix: '' } }
    expect(changeOf({ index, target, anchor, via: 'position', html: true })).toMatchObject({ state: 'changed', now: long })
  })

  it('P-F10 text that really changed keeps Was and Now', () => {
    const { index, target } = anchorOn('New words.\n')
    const anchor = { tag: 'p', path: 'p', quote: { exact: 'Old words.', prefix: '', suffix: '' } }
    expect(changeOf({ index, target, anchor, via: 'position', html: true })).toEqual({ state: 'changed', was: 'Old words.', now: 'New words.' })
  })
})

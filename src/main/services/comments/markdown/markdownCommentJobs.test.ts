// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * 024-AC-003 at integration level: the Markdown kind, the shared write core
 * and a real file on disk, no UI (024-FR-003). Every action – add, reply,
 * edit, resolve, reopen, delete – runs on every block kind through the
 * Markdown job table, each write read from and written back to the file;
 * the frozen v0.23.1 parser reads every result `ok`, the frontmatter offers
 * no comment, and comment-shaped text in code, code spans, frontmatter and
 * the format document itself is never a block. Also 024-AC-036: the work
 * runs in the worker's job table.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ADA, FIXED_NOW, seededRandom } from '../../../../shared/comments/__fixtures__/commentTestData'
import { analyzeCommentDocument as frozenAnalyze } from '../../../../shared/comments/__fixtures__/frozen-v0.23.1/parse'
import { decodeLossless } from '../../../../shared/comments/encoding'
import type { PickedTarget } from '../../../../shared/comments/fileKind'
import { createThread } from '../../../../shared/comments/thread'
import { markdownKind } from '../../../../shared/markdownComments/markdownKind'
import { markdownHints } from '../../../../shared/markdownComments/mdHints'
import type { MdIndex, MdTarget } from '../../../../shared/markdownComments/mdIndex'
import type { MdSlot } from '../../../../shared/markdownComments/mdSlots'
import { markdownTextHash } from '../../../../shared/markdownComments/mdLocate'
import { MARKDOWN_COMMENT_MAX_BYTES } from '../../../../shared/markdownComments/markdownLimits'
import { commentWorkerJobs } from '../../workers/comment-parse.worker'
import type { ListSummary } from '../commentListCore'
import { assembleSplice, type ThreadChange, type WriteJobResult } from '../commentWriteCore'
import { createInProcessMarkdownJobs, markdownCommentJobTable, type MarkdownWriteJob } from './markdownCommentJobs'

const DIR = mkdtempSync(join(tmpdir(), 'erfana-md-comments-'))
const VIEW = { w: 900, h: 700, dpr: 2, x: 0, y: 0 }
const ACT = { author: ADA, nowMs: FIXED_NOW.getTime() }

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true })
})

/** One of each block kind of 024-FR-003, after a frontmatter section. */
const EVERY_KIND = [
  '---',
  'title: Launch plan',
  '---',
  '# Launch plan',
  '',
  'The release ships when every check is green.',
  '',
  '- Freeze the API on Monday.',
  '- Run the load test against staging.',
  '  - Nested: check the dashboards.',
  '',
  '| Who | What |',
  '|---|---|',
  '| Ada | Load test |',
  '',
  '> Ship small, ship often.',
  '>',
  '> - quoted item',
  '',
  '```sh',
  'npm ci',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B',
  '```',
  '',
  '![Architecture](docs/arch.png)',
  '',
  '---',
  '',
  '<details><summary>More</summary>',
  '',
  'Hidden detail.',
  '',
  '</details>',
  ''
].join('\n')

let fileNo = 0
function tempFile(text: string): string {
  fileNo += 1
  const path = join(DIR, `file-${fileNo}.md`)
  writeFileSync(path, text)
  return path
}

const textOf = (path: string): string => {
  const decoded = decodeLossless(new Uint8Array(readFileSync(path)))
  if (!decoded.ok) throw new Error(decoded.reason)
  return decoded.text
}

/** Run one write job on the file's bytes and write the splice back, as `CommentWriter` does. */
async function write(path: string, job: MarkdownWriteJob, seed: number): Promise<WriteJobResult> {
  const bytes = new Uint8Array(readFileSync(path))
  const result = await createInProcessMarkdownJobs({ random: seededRandom(seed) }).runJob(bytes, job)
  if (result.kind !== 'write') throw new Error(`job failed: ${JSON.stringify(result)}`)
  if (result.ok) writeFileSync(path, assembleSplice(bytes, result))
  return result
}

async function list(path: string): Promise<ListSummary> {
  const result = await createInProcessMarkdownJobs().runJob(new Uint8Array(readFileSync(path)), { kind: 'list' })
  if (result.kind !== 'list' || !result.ok) throw new Error(`list failed: ${JSON.stringify(result)}`)
  return result.summary
}

function pickOf(index: MdIndex, target: MdTarget): PickedTarget {
  const sameLine = index.elements.filter(t => t.line === target.line && t.tag === target.tag)
  return { lineStart: target.line, lineEnd: target.lineEnd, tag: target.tag, ordinal: sameLine.indexOf(target) + 1, baseHash: markdownTextHash(index.text) }
}

const addJob = (pick: PickedTarget, breaks?: boolean): MarkdownWriteJob => ({
  kind: 'write',
  request: { op: 'pick', pick, view: VIEW, text: 'Please look at this.' },
  act: ACT,
  ...(breaks === undefined ? {} : { breaks })
})

const threadJob = (threadId: string, rawHash: string, change: ThreadChange): MarkdownWriteJob => ({
  kind: 'write',
  request: { op: 'thread', threadId, rawHash, change },
  act: ACT
})

function frozenKinds(text: string): string[] {
  return frozenAnalyze(text).state.blocks.map(b => (b.kind === 'damaged' ? `damaged: ${b.reason}` : b.kind))
}

/** The rest of the lifecycle on the file's one thread; delete must give `original` back. */
async function replyEditResolveReopenDelete(path: string, threadId: string, original: string): Promise<void> {
  const changes: ReadonlyArray<(summary: ListSummary) => ThreadChange> = [
    () => ({ op: 'reply', text: 'Done in the next commit.' }),
    summary => ({ op: 'editMessage', messageId: summary.threads[0].messages[0].id, text: 'Please look again.' }),
    () => ({ op: 'setStatus', status: 'resolved' }),
    () => ({ op: 'setStatus', status: 'open' })
  ]
  for (const change of changes) {
    const summary = await list(path)
    expect(summary.threads).toHaveLength(1)
    expect(summary.threads[0].attached).toBe(true)
    const result = await write(path, threadJob(threadId, summary.threads[0].rawHash, change(summary)), 3)
    expect(result.ok).toBe(true)
    expect(frozenKinds(textOf(path))).toEqual(['ok'])
  }
  const last = await list(path)
  expect(last.threads[0].messages.map(m => m.text)).toEqual(['Please look again.', 'Done in the next commit.'])
  const removed = await write(path, threadJob(threadId, last.threads[0].rawHash, { op: 'deleteThread' }), 4)
  expect(removed.ok).toBe(true)
  expect(textOf(path)).toBe(original)
}

describe('024-AC-003 Markdown lifecycle on every block kind (kind + write core + a real file)', () => {
  const index = markdownKind.parse(EVERY_KIND, 0).index as MdIndex
  const kinds = new Set(index.elements.map(t => t.kind))

  it('024-AC-003 the fixture holds every commentable kind', () => {
    expect([...kinds].sort()).toEqual(['code', 'diagram', 'divider', 'heading', 'html', 'image', 'item', 'list', 'paragraph', 'quote', 'row', 'cell', 'table'].sort())
  })

  it.each(index.elements.map(t => [`${t.kind} ${t.path}`, t] as const))('024-AC-003 %s: add, reply, edit, resolve, reopen, delete', async (_name, target) => {
    const path = tempFile(EVERY_KIND)
    const added = await write(path, addJob(pickOf(index, target)), target.start + 1)
    if (!added.ok) throw new Error(`add refused: ${added.refusal}`)
    expect(frozenKinds(textOf(path))).toEqual(['ok'])
    await replyEditResolveReopenDelete(path, added.threadId!, EVERY_KIND)
  })

  it('024-AC-003 a comment on a block quote, or on a block inside one, is written just before the whole quote', async () => {
    for (const target of index.elements.filter(t => t.path.startsWith('blockquote'))) {
      const path = tempFile(EVERY_KIND)
      expect((await write(path, addJob(pickOf(index, target)), 9)).ok).toBe(true)
      const text = textOf(path)
      expect(text.indexOf('-->\n> Ship small')).toBeGreaterThan(0)
      expect(text).not.toMatch(/^>.*erfana:comment/m)
    }
  })

  it('024-AC-003 the frontmatter offers no comment, and nothing is written', async () => {
    const path = tempFile(EVERY_KIND)
    const result = await write(path, addJob({ lineStart: 2, lineEnd: 2, tag: 'p', ordinal: 1, baseHash: markdownTextHash(EVERY_KIND) }), 1)
    expect(result).toEqual({ kind: 'write', ok: false, refusal: 'frontmatter' })
    expect(textOf(path)).toBe(EVERY_KIND)
  })

  it('024-AC-003 a save with "preserve line breaks" on renders with it and still writes', async () => {
    const path = tempFile('Line one\nline two\n\nNext.\n')
    const doc = markdownKind.parse(textOf(path), 0)
    const target = (doc.index as MdIndex).elements[0]
    expect((await write(path, addJob(pickOf(doc.index as MdIndex, target), true), 2)).ok).toBe(true)
  })
})

/** Lists three deep: items 1 and 2 at depth 2 and at depth 3 (design § 4.2 "Nested list item"). */
const NESTED = [
  '# Release steps',
  '',
  '- Prepare the release',
  '  - Update the changelog today.',
  '    - Check the links.',
  '    - Check the dates.',
  '  - Tag the build today.',
  '- Announce the release',
  ''
].join('\n')

const L1 = 'ul:nth-of-type(1) > li:nth-of-type(1)'
const L2 = `${L1} > ul:nth-of-type(1)`
const L3 = `${L2} > li:nth-of-type(1) > ul:nth-of-type(1)`

/** One nested target: where its block goes, and what its `@data` and hint say. */
interface NestedCase {
  readonly name: string
  readonly path: string
  /** 1-based line the block's `<!--` is on, and its indent. */
  readonly line: number
  readonly indent: string
  readonly anchor: { readonly tag: string; readonly path: string; readonly runtime?: { readonly path: string; readonly quote: string } }
  readonly quote: string
  readonly targetLine: string
  readonly hint: string
}

const NESTED_CASES: readonly NestedCase[] = [
  {
    name: 'depth 2, item 1',
    path: `${L2} > li:nth-of-type(1)`,
    line: 4,
    indent: '  ',
    anchor: { tag: 'ul', path: L2, runtime: { path: 'li:nth-of-type(1)', quote: 'Update the changelog today. Check the links. Check the dates.' } },
    quote: 'Update the changelog today. Check the links. Check the dates. Tag the build today.',
    targetLine: 'target: <ul> (comment is about <li> at li:nth-of-type(1) inside this element)',
    hint: 'item 1 of the list starting "- Update the changelog today."'
  },
  {
    name: 'depth 2, item 2',
    path: `${L2} > li:nth-of-type(2)`,
    line: 7,
    indent: '    ',
    anchor: { tag: 'li', path: `${L2} > li:nth-of-type(2)` },
    quote: 'Tag the build today.',
    targetLine: 'target: <li>',
    hint: 'item 2 of the list starting "- Tag the build today."'
  },
  {
    name: 'depth 3, item 1',
    path: `${L3} > li:nth-of-type(1)`,
    line: 5,
    indent: '    ',
    anchor: { tag: 'ul', path: L3, runtime: { path: 'li:nth-of-type(1)', quote: 'Check the links.' } },
    quote: 'Check the links. Check the dates.',
    targetLine: 'target: <ul> (comment is about <li> at li:nth-of-type(1) inside this element)',
    hint: 'item 1 of the list starting "- Check the links."'
  },
  {
    name: 'depth 3, item 2',
    path: `${L3} > li:nth-of-type(2)`,
    line: 6,
    indent: '      ',
    anchor: { tag: 'li', path: `${L3} > li:nth-of-type(2)` },
    quote: 'Check the dates.',
    targetLine: 'target: <li>',
    hint: 'item 2 of the list starting "- Check the dates."'
  }
]

/** The one `ok` block of `text`'s anchor, with the runtime quote reduced to its exact text. */
function anchorSummary(text: string): NestedCase['anchor'] & { readonly quote?: string } {
  const [block] = markdownKind.parse(text, 0).state.blocks
  if (block?.kind !== 'ok') throw new Error('no ok block')
  const { tag, path, quote, runtime } = block.data.anchor
  return { tag, path, quote: quote?.exact, ...(runtime === undefined ? {} : { runtime: { path: runtime.path, quote: runtime.quote?.exact ?? '' } }) }
}

describe('024-AC-003 Markdown lifecycle on nested list items (design § 4.1, § 4.2, § 5, § 6)', () => {
  const index = markdownKind.parse(NESTED, 0).index as MdIndex

  it.each(NESTED_CASES.map(c => [c.name, c] as const))('024-AC-003 %s: the block goes at its own level and names it; then reply, edit, resolve, reopen, delete', async (_name, c) => {
    const target = index.elementAtPath(c.path)!
    expect(target.kind).toBe('item')
    const path = tempFile(NESTED)
    const added = await write(path, addJob(pickOf(index, target)), 21)
    if (!added.ok) throw new Error(`add refused: ${added.refusal}`)
    const text = textOf(path)
    const lines = text.split('\n')
    expect(lines.slice(0, c.line - 1)).toEqual(NESTED.split('\n').slice(0, c.line - 1))
    expect(lines[c.line - 1]).toMatch(new RegExp(`^${c.indent}<!-- erfana:comment v1 `))
    expect(lines[lines.indexOf(`${c.indent}-->`) + 1]).toBe(NESTED.split('\n')[c.line - 1])
    expect(anchorSummary(text)).toEqual({ ...c.anchor, quote: c.quote })
    expect(lines).toContain(`${c.indent}${c.targetLine}`)
    expect(lines).toContain(`${c.indent}  target in Markdown (when commented): ${c.hint}`)
    expect(frozenKinds(text)).toEqual(['ok'])
    await replyEditResolveReopenDelete(path, added.threadId!, NESTED)
  })

  it('024-AC-003 every later slot of a depth-3 item still names that item: runtime path below the carrier and its own text', () => {
    const doc = markdownKind.parse(NESTED, 0)
    const target = index.elementAtPath(`${L3} > li:nth-of-type(2)`)!
    const slots = markdownKind.slots(doc, target, pickOf(index, target)) as MdSlot[]
    const seen = slots.map(slot => {
      const anchor = markdownKind.anchorOf(doc, target, undefined, slot)
      const data = createThread({ anchor, view: VIEW, text: 'm', context: { author: ADA, now: FIXED_NOW, random: seededRandom(5) } })
      return [index.lines.lineOf(slot.offset) + 1, slot.indent.length, anchor.tag, anchor.runtime?.path, anchor.runtime?.quote?.exact, markdownHints(data, doc)[0]]
    })
    const hint = 'target in Markdown (when commented): item 2 of the list starting "- Check the dates."'
    expect(seen).toEqual([
      [6, 6, 'li', undefined, undefined, hint],
      [5, 4, 'ul', 'li:nth-of-type(2)', 'Check the dates.', hint],
      [4, 2, 'ul', 'li:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(2)', 'Check the dates.', hint],
      [3, 0, 'ul', 'li:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(2)', 'Check the dates.', hint]
    ])
  })

  it('024-AC-003 when the nested slots are skipped (§ 4.3, after a table row), the block before the whole list still names the nested item', async () => {
    const before = [
      '- Prepare the release',
      '',
      '  | Step | Owner |',
      '  |---|---|',
      '  | Notes | Ada |',
      '  - Update the changelog today.',
      '',
      '    | Check | When |',
      '    |---|---|',
      '    | Links | Monday |',
      '  - Tag the build today.',
      '- Announce the release',
      ''
    ].join('\n')
    const doc = markdownKind.parse(before, 0)
    const own = doc.index as MdIndex
    const target = own.elementAtPath(`${L2} > li:nth-of-type(2)`)!
    const path = tempFile(before)
    const added = await write(path, addJob(pickOf(own, target)), 22)
    if (!added.ok) throw new Error(`add refused: ${added.refusal}`)
    const text = textOf(path)
    expect(text.startsWith('<!-- erfana:comment v1 ')).toBe(true)
    expect(anchorSummary(text)).toMatchObject({
      tag: 'ul',
      path: 'ul:nth-of-type(1)',
      runtime: { path: 'li:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(2)', quote: 'Tag the build today.' }
    })
    expect(text).toContain('\ntarget: <ul> (comment is about <li> at li:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(2) inside this element)\n')
    expect(text).toContain('\n  target in Markdown (when commented): item 2 of the list starting "- Tag the build today."\n')
    expect(frozenKinds(text)).toEqual(['ok'])
    await replyEditResolveReopenDelete(path, added.threadId!, before)
  })
})

/** Files whose only comment-shaped text is never a block (024-FR-003). */
const NEVER_BLOCKS: Record<string, string> = {
  fence: '```\n<!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaaa\nstatus: open\n-->\n```\n',
  'indented code': 'Text.\n\n    <!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaaa\n    status: open\n    -->\n',
  'code span': 'Use `<!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaaa -->` as the marker.\n',
  frontmatter: '---\nnote: <!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaaa -->\n---\nBody.\n'
}

describe('024-AC-003 comment-shaped text is never a block', () => {
  it.each(Object.entries(NEVER_BLOCKS))('024-AC-003 %s lists zero blocks', async (_name, text) => {
    const summary = await list(tempFile(text))
    expect(summary).toMatchObject({ threads: [], damaged: [], newer: [], writable: true })
  })

  it('024-AC-003 docs/html-comments/format-v1.md itself lists zero blocks', async () => {
    const spec = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'html-comments', 'format-v1.md')
    const summary = await list(spec)
    expect(summary.threads).toEqual([])
    expect(summary.damaged).toEqual([])
    expect(summary.newer).toEqual([])
  })
})

describe('024-AC-036 the Markdown work runs in the parse worker', () => {
  it('024-AC-036 the worker registers the Markdown table beside HTML\'s', () => {
    const jobs = commentWorkerJobs()
    expect(jobs.handlerOf('markdown', 'list')).toBe(markdownCommentJobTable.list)
    expect(jobs.handlerOf('markdown', 'write')).toBe(markdownCommentJobTable.write)
    expect(jobs.handlerOf('markdown', 'pin')).toBeUndefined()
    expect(jobs.handlerOf('html', 'write')).toBeDefined()
  })

  it('024-AC-036 a file past the limits is refused as too large by the jobs, before any parse', async () => {
    const path = tempFile(`${'>'.repeat(40)} bomb\n`)
    const result = await createInProcessMarkdownJobs().runJob(new Uint8Array(readFileSync(path)), { kind: 'list' })
    expect(result).toEqual({ kind: 'list', ok: false, refusal: 'too-large' })
    const big = new Uint8Array(MARKDOWN_COMMENT_MAX_BYTES + 1).fill(0x61)
    const pick: PickedTarget = { lineStart: 1, lineEnd: 1, tag: 'p', ordinal: 1 }
    const write = await createInProcessMarkdownJobs().runJob(big, addJob(pick))
    expect(write).toEqual({ kind: 'write', ok: false, refusal: 'too-large' })
  })

  it('a refused write hands no buffers over; a written one hands over the block bytes it owns', () => {
    const refused: WriteJobResult = { kind: 'write', ok: false, refusal: 'limit' }
    expect(markdownCommentJobTable.write.transferables?.(refused)).toEqual([])
    const insert = new Uint8Array([60, 33, 45, 45])
    const ok: WriteJobResult = { kind: 'write', ok: true, byteStart: 0, byteEnd: 0, insert, inputHash: '0'.repeat(64), outputHash: '1'.repeat(64), threadId: null }
    expect(markdownCommentJobTable.write.transferables?.(ok)).toEqual([insert.buffer])
  })
})

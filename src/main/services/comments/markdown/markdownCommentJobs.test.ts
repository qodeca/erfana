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
import { markdownKind } from '../../../../shared/markdownComments/markdownKind'
import type { MdIndex, MdTarget } from '../../../../shared/markdownComments/mdIndex'
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
    const threadId = added.threadId!
    expect(frozenKinds(textOf(path))).toEqual(['ok'])
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
    expect(textOf(path)).toBe(EVERY_KIND)
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

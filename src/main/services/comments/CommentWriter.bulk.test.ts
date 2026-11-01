// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Plan step 13 – the bulk writes (024-FR-028, P-F23): several threads of one
 * file change in ONE write, through every check a single write passes, and
 * nothing at all is written when any of them fails. Runs against both kinds.
 */
import { lstat, symlink } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { htmlKind } from '../../../shared/comments/htmlKind'
import type { CommentFileKind } from '../../../shared/comments/fileKind'
import { markdownKind } from '../../../shared/markdownComments/markdownKind'
import { createInProcessCommentFileJobs } from '../preview/comments/htmlCommentJobs'
import { atomicWriteBytesStrict } from '../../utils/atomicWriteBytesStrict'
import { frozenCommentFileKinds } from './commentFileKinds'
import type { CommentFileJobRunner } from './commentFileJobs'
import { CommentWriter, type CommentWriteResult, type CommentWriterDeps } from './CommentWriter'
import { createInProcessMarkdownJobs } from './markdown/markdownCommentJobs'
import { makeProject, seededRandom, type TempProject } from './__test-helpers__/fileCommentHarness'

vi.mock('../../utils/atomicWriteBytesStrict', async importOriginal => {
  const real = await importOriginal<typeof import('../../utils/atomicWriteBytesStrict')>()
  return { ...real, atomicWriteBytesStrict: vi.fn(real.atomicWriteBytesStrict) }
})

interface Family {
  readonly name: string
  readonly kind: CommentFileKind
  readonly file: string
  readonly page: string
  readonly jobs: () => CommentFileJobRunner
  readonly pick: (line: number) => Parameters<CommentWriter['addPicked']>[0]['pick']
}

const FAMILIES: readonly Family[] = [
  {
    name: 'HTML',
    kind: htmlKind,
    file: 'page.html',
    page: '<!doctype html>\n<html>\n<body>\n<p id="l4">One</p>\n<p id="l5">Two</p>\n<p id="l6">Three</p>\n</body>\n</html>\n',
    jobs: () => createInProcessCommentFileJobs({ random: seededRandom() }) as unknown as CommentFileJobRunner,
    pick: line => ({ lineStart: line, lineEnd: line, tag: 'p', ordinal: 1, id: `l${line}` })
  },
  {
    name: 'Markdown',
    kind: markdownKind,
    file: 'notes.md',
    page: '# Title\n\nOne\n\nTwo\n\nThree\n',
    // The production table: its write and bulk write pick the kind by the line-break setting.
    jobs: () => createInProcessMarkdownJobs({ random: seededRandom() }) as unknown as CommentFileJobRunner,
    pick: line => ({ lineStart: line, lineEnd: line, tag: 'p', ordinal: 1, quote: { exact: { 3: 'One', 5: 'Two', 7: 'Three' }[line] ?? '', prefix: '', suffix: '' } })
  }
]

const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }

describe.each(FAMILIES)('bulk writes – $name', family => {
  let project: TempProject
  let dirty: boolean
  let identity: CommentWriterDeps['identity']
  let writer: CommentWriter
  const target = () => ({ realRoot: project.root, filePath: project.path(family.file) })
  const lines = family.name === 'HTML' ? [4, 5, 6] : [3, 5, 7]

  beforeEach(async () => {
    project = await makeProject()
    dirty = false
    identity = () => ({ name: 'Test Reviewer' })
    writer = new CommentWriter({
      identity: () => identity(),
      hasUnsavedSource: () => dirty,
      kinds: frozenCommentFileKinds([family.kind]),
      jobs: family.jobs(),
      now: () => new Date('2026-11-01T10:00:00Z')
    })
    await project.write(family.file, family.page)
    vi.mocked(atomicWriteBytesStrict).mockClear()
  })
  afterEach(() => project.dispose())

  /** Three comments, the last line first so the picks stay valid; returns ids in file order with their hashes. */
  async function threeThreads(): Promise<{ threadId: string; rawHash: string }[]> {
    for (const line of [...lines].reverse()) {
      const added = await writer.addPicked({ file: target(), pick: family.pick(line), view: VIEW, text: `On line ${line}` })
      expect(added.ok ? 'ok' : added.reason).toBe('ok')
    }
    vi.mocked(atomicWriteBytesStrict).mockClear()
    return threadsOnDisk()
  }

  async function threadsOnDisk(): Promise<{ threadId: string; rawHash: string; status: string }[]> {
    const answer = await family.jobs().runJob(await project.read(family.file), { kind: 'list', placements: true })
    if (answer.kind !== 'list' || !answer.ok) throw new Error('no list')
    return answer.summary.threads.map(t => ({ threadId: t.threadId, rawHash: t.rawHash, status: t.status }))
  }

  const bytesOf = (result: Promise<Buffer>): Promise<string> => result.then(b => b.toString('utf8'))

  it('resolves several threads in one write, and leaves the third as it was', async () => {
    const [first, second, third] = await threeThreads()
    const result = await writer.changeThreads({ file: target(), threads: [second, first], change: 'resolve' })
    expect(result).toMatchObject({ ok: true })
    expect(atomicWriteBytesStrict).toHaveBeenCalledTimes(1)
    const after = await threadsOnDisk()
    expect(after.map(t => t.status)).toEqual(['resolved', 'resolved', 'open'])
    expect(after[2]).toMatchObject({ threadId: third.threadId, rawHash: third.rawHash })
    expect(await bytesOf(project.read(family.file))).toContain('resolved by Test Reviewer')
  })

  it('deletes every resolved thread in one write, and the file is the file before them', async () => {
    const [first, second, third] = await threeThreads()
    await writer.changeThreads({ file: target(), threads: [first, second, third], change: 'resolve' })
    const resolved = await threadsOnDisk()
    vi.mocked(atomicWriteBytesStrict).mockClear()
    const result = await writer.changeThreads({ file: target(), threads: resolved, change: 'deleteResolved' })
    expect(result).toMatchObject({ ok: true, threadId: null })
    expect(atomicWriteBytesStrict).toHaveBeenCalledTimes(1)
    expect(await bytesOf(project.read(family.file))).toBe(family.page)
  })

  async function refusedWithoutWrite(run: () => Promise<CommentWriteResult>, reason: string): Promise<void> {
    const before = await project.read(family.file)
    expect(await run()).toMatchObject({ ok: false, reason })
    expect((await project.read(family.file)).equals(before)).toBe(true)
  }

  it('one stale thread stops them all: no comment changes', async () => {
    const [first, second] = await threeThreads()
    const stale = { threadId: second.threadId, rawHash: '0'.repeat(64) }
    await refusedWithoutWrite(() => writer.changeThreads({ file: target(), threads: [first, stale], change: 'resolve' }), 'block-changed')
  })

  it('a thread gone from the file stops them all', async () => {
    const [first] = await threeThreads()
    const gone = { threadId: 'c_missing', rawHash: first.rawHash }
    await refusedWithoutWrite(() => writer.changeThreads({ file: target(), threads: [first, gone], change: 'resolve' }), 'block-changed')
  })

  it('delete refuses a thread reopened since the review: an open comment is never deleted in bulk', async () => {
    const [first, second] = await threeThreads()
    await writer.changeThreads({ file: target(), threads: [first], change: 'resolve' })
    const [resolved, open] = await threadsOnDisk()
    expect(open.threadId).toBe(second.threadId)
    await refusedWithoutWrite(() => writer.changeThreads({ file: target(), threads: [resolved, open], change: 'deleteResolved' }), 'block-changed')
  })

  it('resolve refuses a thread already resolved', async () => {
    const [first] = await threeThreads()
    await writer.changeThreads({ file: target(), threads: [first], change: 'resolve' })
    const [resolved] = await threadsOnDisk()
    await refusedWithoutWrite(() => writer.changeThreads({ file: target(), threads: [resolved], change: 'resolve' }), 'block-changed')
  })

  it('refuses unsaved edits', async () => {
    const threads = await threeThreads()
    dirty = true
    await refusedWithoutWrite(() => writer.changeThreads({ file: target(), threads, change: 'resolve' }), 'unsaved-source')
  })

  it('resolve needs a name; delete writes none, so it does not', async () => {
    const threads = await threeThreads()
    identity = () => undefined
    await refusedWithoutWrite(() => writer.changeThreads({ file: target(), threads, change: 'resolve' }), 'identity')
    identity = () => ({ name: 'Test Reviewer' })
    await writer.changeThreads({ file: target(), threads, change: 'resolve' })
    identity = () => undefined
    const resolved = await threadsOnDisk()
    expect(await writer.changeThreads({ file: target(), threads: resolved, change: 'deleteResolved' })).toMatchObject({ ok: true })
  })

  it('refuses a file with a git conflict', async () => {
    const threads = await threeThreads()
    const text = (await project.read(family.file)).toString('utf8')
    await project.write(family.file, `${text}<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n`)
    await refusedWithoutWrite(() => writer.changeThreads({ file: target(), threads, change: 'resolve' }), 'conflict-markers')
  })

  it('refuses a link out of the project', async () => {
    const threads = await threeThreads()
    const outside = await makeProject()
    await outside.write(family.file, await project.read(family.file))
    const linked = project.path(`linked-${family.file}`)
    await symlink(outside.path(family.file), linked)
    expect((await lstat(linked)).isSymbolicLink()).toBe(true)
    const result = await writer.changeThreads({ file: { realRoot: project.root, filePath: linked }, threads, change: 'resolve' })
    expect(result.ok).toBe(false)
    expect(atomicWriteBytesStrict).not.toHaveBeenCalled()
    await outside.dispose()
  })

  it('a worker answer that cuts into the file is refused by main', async () => {
    const threads = await threeThreads()
    const real = family.jobs()
    const lying: CommentFileJobRunner = {
      runJob: (async (bytes: Uint8Array, job: Parameters<CommentFileJobRunner['runJob']>[1]) => {
        const answer = await real.runJob(bytes, job)
        if (answer.kind === 'bulkWrite' && answer.ok) return { ...answer, splices: [...answer.splices, { byteStart: 0, byteEnd: 4, insert: new Uint8Array() }] }
        return answer
      }) as CommentFileJobRunner['runJob']
    }
    const liar = new CommentWriter({ identity: () => ({ name: 'Test Reviewer' }), kinds: frozenCommentFileKinds([family.kind]), jobs: lying })
    await refusedWithoutWrite(() => liar.changeThreads({ file: target(), threads, change: 'resolve' }), 'verify-failed')
  })
})

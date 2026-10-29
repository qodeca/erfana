// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:commentList` read from disk (docs/designs/comments/html-preview-comments.md
 * §7.7, §8, §10.4, §10.6; M-053, SEC-20).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMENT_RAW_PREVIEW_MAX_CHARS } from '../../../../shared/ipc/preview-comment-schema'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { logger } from '../../LoggingService'
import { addTo, fixedId, makeComment } from '../../../../shared/comments/__fixtures__/commentTestData'
import { BASE_PAGE, commentedPage, damagedBlock, insertBefore, newerBlock } from './__test-helpers__/commentedPages'
import { makeProject, type TempProject } from './__test-helpers__/commentWriterHarness'
import { frameFile } from './__test-helpers__/commentServiceHarness'
import { CommentKeyStore, type CommentBinding } from './commentKeyStore'
import { createInProcessCommentFileJobs, type CommentFileJob } from './commentFileJobs'
import { buildCommentList, COMMENT_LIST_MAX_BYTES, COMMENT_LIST_MAX_FILES } from './commentListBuilder'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const BINDING: CommentBinding = { windowId: 1, panelId: 'panel', session: 1 }

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
  vi.mocked(logger.warn).mockClear()
})

afterEach(async () => {
  await project.dispose()
})

function listOf(
  paths: Array<{ path: string; frame?: boolean }>,
  keys: Pick<CommentKeyStore<unknown>, 'keyFor'> = new CommentKeyStore<unknown>(),
  maxBytes?: number
) {
  return buildCommentList({
    binding: BINDING,
    keys,
    realRoot: project.root,
    files: paths.map(({ path, frame }) => ({ file: frameFile(path, { projectPath: path, displayPath: path.slice(project.root.length + 1).replace(/\\/g, '/') }), frame: frame ?? false })),
    notVisible: (_realPath, threadId) => threadId === fixedId('c-', 2),
    jobs: createInProcessCommentFileJobs(),
    ...(maxBytes === undefined ? {} : { maxBytes })
  })
}

/** The files of a list that left nothing out. */
async function list(paths: Array<{ path: string; frame?: boolean }>, keys?: Pick<CommentKeyStore<unknown>, 'keyFor'>) {
  const { files, unread } = await listOf(paths, keys)
  expect(unread).toBe(0)
  return files
}

describe('buildCommentList', () => {
  it('M-053 lists threads, damaged and newer blocks with their lines, each under a key', async () => {
    let text = commentedPage().text
    text = insertBefore(text, '<p id="para"', damagedBlock('c-9'))
    text = insertBefore(text, '</main>', newerBlock('c-8'))
    const path = await project.write('index.html', text)
    const [file] = await list([{ path }])
    expect(file).toMatchObject({ displayPath: 'index.html', filePath: path, frame: false, writable: true })
    expect(file.fileKey).toMatch(/^f/)
    expect(file.threads).toHaveLength(3)
    for (const thread of file.threads) {
      expect(thread.threadKey).toMatch(/^t/)
      expect(thread.line).toBeGreaterThan(0)
      expect(thread.messages.length).toBeGreaterThan(0)
    }
    expect(file.threads.find(thread => thread.status === 'resolved')?.resolved?.by.name).toBe('Grace Hopper')
    expect(file.threads.filter(thread => thread.notVisible)).toHaveLength(1)
    expect(file.damaged).toEqual([expect.objectContaining({ reason: 'bad-json', raw: expect.stringContaining('erfana:comment'), blockKey: expect.stringMatching(/^b/) })])
    expect(file.newer).toEqual([expect.objectContaining({ version: 2, blockKey: expect.stringMatching(/^b/) })])
  })

  it('E-005 reads every "not visible now" flag after the last file, so no flag is older than the answer', async () => {
    const first = await project.write('index.html', commentedPage().text)
    const second = await project.write('other.html', commentedPage().text)
    const jobs = createInProcessCommentFileJobs()
    let hidden = true
    const reads: Array<{ realPath: string; hidden: boolean }> = []
    let jobsRun = 0
    const { files: views } = await buildCommentList({
      binding: BINDING,
      keys: new CommentKeyStore<unknown>(),
      realRoot: project.root,
      files: [first, second].map(path => ({ file: frameFile(path, { projectPath: path, displayPath: path }), frame: false })),
      notVisible: realPath => {
        reads.push({ realPath, hidden })
        return hidden
      },
      jobs: {
        runJob<J extends CommentFileJob>(bytes: Uint8Array, job: J) {
          jobsRun += 1
          // An anchor report lands while the second file is read: the element is rendered again.
          if (jobsRun === 2) hidden = false
          return jobs.runJob(bytes, job)
        }
      }
    })
    expect(views.flatMap(view => view.threads.map(thread => thread.notVisible))).not.toContain(true)
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every(read => !read.hidden)).toBe(true)
  })

  it('leaves out a file the worker refuses for a reason the list does not show', async () => {
    const shown = await project.write('index.html', commentedPage().text)
    const refused = await project.write('other.html', commentedPage().text)
    const jobs = createInProcessCommentFileJobs()
    let jobsRun = 0
    const { files: views } = await buildCommentList({
      binding: BINDING,
      keys: new CommentKeyStore<unknown>(),
      realRoot: project.root,
      files: [shown, refused].map(path => ({ file: frameFile(path, { projectPath: path, displayPath: path }), frame: false })),
      notVisible: () => false,
      jobs: {
        async runJob<J extends CommentFileJob>(bytes: Uint8Array, job: J) {
          jobsRun += 1
          if (jobsRun === 2) return { kind: 'list', ok: false, refusal: 'too-many-blocks' } as Awaited<ReturnType<typeof jobs.runJob<J>>>
          return jobs.runJob(bytes, job)
        }
      }
    })
    expect(views.map(view => view.displayPath)).toEqual([shown])
  })

  it("lists a JS-built target with its snapshot size, an edited message, and a read-only file's threads", async () => {
    const first = makeComment().msgs[0]
    const data = makeComment({
      id: fixedId('c-', 7),
      anchor: {
        tag: 'button',
        path: '',
        runtime: { path: 'div > span', tag: 'span', snapshot: '<span>café</span>', truncated: true, snapshotSource: 'page' }
      },
      msgs: [{ ...first, by: { name: 'Ada', role: 'human' }, edited: '2026-10-26T09:12:00Z' }]
    })
    const conflict = ['', '<<<<<<< HEAD', '<p>ours</p>', '=======', '<p>theirs</p>', '>>>>>>> branch', ''].join('\n')
    const path = await project.write('index.html', `${addTo(BASE_PAGE, 'button', data).text}${conflict}`)
    const [file] = await list([{ path }])
    expect(file).toMatchObject({ writable: false, readOnlyReason: 'conflict-markers' })
    expect(file.threads).toHaveLength(1)
    const [thread] = file.threads
    expect(thread).not.toHaveProperty('elementId')
    expect(thread.runtime).toEqual({ tag: 'span', path: 'div > span', snapshotBytes: 18, truncated: true })
    expect(thread.messages[0]).toMatchObject({ by: { name: 'Ada' }, edited: '2026-10-26T09:12:00Z' })
    expect(thread.messages[0].by).not.toHaveProperty('email')
  })

  it('§10.10 lists the stored quote for "It was attached to:" – the JS-built element\'s first, bidi characters shown, never raw', async () => {
    const rlo = String.fromCodePoint(0x202e)
    const inFile = makeComment({ id: fixedId('c-', 5), anchor: { tag: 'button', path: '', quote: { exact: `Buy ${rlo}now`, prefix: '', suffix: '' } } })
    const runtime = makeComment({
      id: fixedId('c-', 6),
      anchor: {
        tag: 'button',
        path: '',
        quote: { exact: 'Buy now', prefix: '', suffix: '' },
        runtime: { path: 'span:nth-of-type(1)', tag: 'span', quote: { exact: 'Inner text', prefix: '', suffix: '' }, snapshotSource: 'page' }
      }
    })
    const bare = makeComment({ id: fixedId('c-', 7), anchor: { tag: 'button', path: '' } })
    let text = BASE_PAGE
    for (const data of [inFile, runtime, bare]) text = addTo(text, 'button', data).text
    const path = await project.write('index.html', text)
    const [file] = await list([{ path }])
    expect(file.threads.map(thread => thread.quote).sort()).toEqual(['Buy \\u202enow', 'Inner text', undefined])
    expect(file.threads.every(thread => !thread.quote?.includes(rlo))).toBe(true)
  })

  it('cuts a long damaged block\'s raw text and flags it', async () => {
    const huge = `<!-- erfana:comment v1 id=c-0000000000000009\n@data {"v":1, ${'x'.repeat(COMMENT_RAW_PREVIEW_MAX_CHARS)}\n-->`
    const path = await project.write('index.html', insertBefore(commentedPage().text, '<p id="para"', huge))
    const [file] = await list([{ path }])
    expect(file.damaged[0].raw).toHaveLength(COMMENT_RAW_PREVIEW_MAX_CHARS)
    expect(file.damaged[0].rawTruncated).toBe(true)
  })

  it('lists a missing or non-UTF-8 file read-only with its reason, and leaves a never-served path out', async () => {
    const gone = project.path('gone.html')
    const latin = await project.write('latin.html', Buffer.from([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]))
    await mkdir(project.path('.hidden'))
    const hidden = join(project.root, '.hidden', 'page.html')
    await writeFile(hidden, '<p>x</p>')
    const files = await list([{ path: gone }, { path: latin, frame: true }, { path: hidden }])
    expect(files.map(file => [file.displayPath, file.writable, file.readOnlyReason, file.frame])).toEqual([
      ['gone.html', false, 'missing', false],
      ['latin.html', false, 'encoding', true]
    ])
    expect(files[0].threads).toEqual([])
  })

  it(`R3-12 lists at most ${COMMENT_LIST_MAX_FILES} files, cut before any file is read, one file at a time`, async () => {
    const path = await project.write('index.html', commentedPage().text)
    const jobs = createInProcessCommentFileJobs()
    let inFlight = 0
    let most = 0
    const counted = {
      runJob: async (bytes: Uint8Array, job: Parameters<typeof jobs.runJob>[1]) => {
        most = Math.max(most, ++inFlight)
        try {
          return await jobs.runJob(bytes, job)
        } finally {
          inFlight -= 1
        }
      }
    } as typeof jobs
    const file = frameFile(path, { projectPath: path, displayPath: 'index.html' })
    let pastCapTouched = false
    const files = Array.from({ length: COMMENT_LIST_MAX_FILES + 5 }, (_, i) =>
      i < COMMENT_LIST_MAX_FILES
        ? { file, frame: i > 0 }
        : {
            get file() {
              pastCapTouched = true
              return file
            },
            frame: true
          }
    )
    const { files: views, unread } = await buildCommentList({ binding: BINDING, keys: new CommentKeyStore<unknown>(), realRoot: project.root, files, notVisible: () => false, jobs: counted })
    expect(views).toHaveLength(COMMENT_LIST_MAX_FILES)
    // The files past the cut are counted, so the drawer can say the list is partial.
    expect(unread).toBe(5)
    // The drawer's note names both limits in words (`unreadFilesText`, commentCopy.ts).
    expect([COMMENT_LIST_MAX_FILES, COMMENT_LIST_MAX_BYTES]).toEqual([64, 64 * 1024 * 1024])
    expect(pastCapTouched).toBe(false)
    expect(most).toBe(1)
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toContain('cut short')
  })

  it('§19 Rev 4 reads at most its byte budget: a file past what is left is not read but counted, and a smaller one after it still is', async () => {
    const page = commentedPage().text
    const size = Buffer.byteLength(page)
    const [a, b, c] = await Promise.all(['a.html', 'b.html', 'c.html'].map(name => project.write(name, page)))
    const small = await project.write('small.html', '<!doctype html><p>small</p>')
    const { files, unread } = await listOf([{ path: a }, { path: b, frame: true }, { path: c, frame: true }, { path: small, frame: true }], undefined, 2 * size + 100)
    expect(files.map(file => file.displayPath)).toEqual(['a.html', 'b.html', 'small.html'])
    expect(unread).toBe(1)
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('byte budget')
    expect(logged).not.toContain('c.html')
  })

  it(`§19 Rev 4 within the budget, a file over ${PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES} bytes is listed read-only as too-large, not counted as unread`, async () => {
    const page = await project.write('index.html', commentedPage().text)
    const big = await project.write('big.html', Buffer.alloc(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES + 1, 0x20))
    const { files, unread } = await listOf([{ path: page }, { path: big, frame: true }])
    expect(files.map(file => [file.displayPath, file.writable, file.readOnlyReason ?? null])).toEqual([
      ['index.html', true, null],
      ['big.html', false, 'too-large']
    ])
    expect(unread).toBe(0)
  })

  it('R3-12 a file the worker could not parse drops out alone, logged by digest', async () => {
    const path = await project.write('index.html', commentedPage().text)
    const other = await project.write('other.html', commentedPage().text)
    const jobs = createInProcessCommentFileJobs()
    let calls = 0
    const flaky = { runJob: async (bytes: Uint8Array, job: Parameters<typeof jobs.runJob>[1]) => (calls++ === 0 ? { kind: 'failed' as const, failure: 'busy' as const } : jobs.runJob(bytes, job)) } as typeof jobs
    const { files: views } = await buildCommentList({
      binding: BINDING,
      keys: new CommentKeyStore<unknown>(),
      realRoot: project.root,
      files: [path, other].map(file => ({ file: frameFile(file, { projectPath: file, displayPath: file.slice(project.root.length + 1) }), frame: false })),
      notVisible: () => false,
      jobs: flaky
    })
    expect(views.map(view => view.displayPath)).toEqual(['other.html'])
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('could not be parsed for the comment list')
    expect(logged).not.toContain('index.html')
  })

  it('SEC-20 a file that fails the list schema, or whose view throws, drops out alone – logged by digest only', async () => {
    const path = await project.write('index.html', commentedPage().text)
    const other = await project.write('other.html', commentedPage().text)
    const bad = { keyFor: () => 'not a key!' }
    expect(await listOf([{ path }], bad)).toEqual({ files: [], unread: 0 })
    let calls = 0
    const throwing = {
      keyFor: (_binding: CommentBinding, target: { realPath: string }) => {
        if (target.realPath === path && calls++ > 0) throw new Error(`boom ${path}`)
        return `k${calls}x${Math.random().toString(16).slice(2, 10)}`
      }
    }
    const files = await list([{ path }, { path: other }], throwing)
    expect(files.map(file => file.displayPath)).toEqual(['other.html'])
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('left out of the comment list')
    expect(logged).toContain('could not be listed')
    expect(logged).not.toContain(project.root.replace(/\\/g, '\\\\'))
    expect(logged).not.toContain('index.html')
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `file-comment:*` family with the REAL Markdown kind (spec 024
 * architecture note 001 § 4, § 8 C18): the production registry
 * (`fileCommentKinds`), the production settings row (`KIND_SETTINGS`) and the
 * Markdown job table run in-process, through `FileCommentService` on a temp
 * `.md` file. A full lifecycle leaves the file's bytes as they were; the
 * "preserve line breaks" setting reaches every Markdown write; comments off in
 * Settings refuse a draft and a save; `.html` and `.txt` are refused by name.
 * `electron` is mocked because the composition module imports the handlers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { GlobalSettingsSchema, type GlobalSettings } from '../../../shared/ipc/global-settings-schema'
import { markdownKind } from '../../../shared/markdownComments/markdownKind'
import type { MdIndex, MdTarget } from '../../../shared/markdownComments/mdIndex'
import { markdownTextHash } from '../../../shared/markdownComments/mdLocate'
import type { PickedTargetRequest } from '../../../shared/ipc/file-comment-schema'
import type { CommentFileJob, CommentFileJobRunner } from '../../services/comments/commentFileJobs'
import { fileCommentKinds } from '../../services/comments/commentFileKinds'
import { FileCommentService } from '../../services/comments/FileCommentService'
import { createInProcessMarkdownJobs } from '../../services/comments/markdown/markdownCommentJobs'
import {
  FIXED_NOW,
  fakeWatches,
  makeProject,
  PANEL,
  seededRandom,
  TEST_REVIEWER,
  VIEW,
  type TempProject
} from '../../services/comments/__test-helpers__/fileCommentHarness'
import { KIND_SETTINGS } from './file-comments'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null), fromId: vi.fn(() => null) }
}))

const PLAN = '---\ntitle: Plan\n---\n# Plan\n\nShip the first slice.\n\nThen the second.\n'
const SOFT_BREAKS = 'Line one\nline two\n\nNext.\n'

let project: TempProject
let settings: GlobalSettings
let writeJobs: CommentFileJob[]
let service: FileCommentService

/** The production settings row for a kind, as `file-comments.ts` wires it. */
const rowOf = (id: string) => KIND_SETTINGS.get(id)

/** The Markdown jobs in-process, recording every write job they were given. */
function recordingJobs(): CommentFileJobRunner {
  const inner = createInProcessMarkdownJobs({ random: seededRandom() })
  return {
    runJob: (bytes, job) => {
      if (job.kind === 'write') writeJobs.push(job)
      return inner.runJob(bytes, job)
    }
  } as CommentFileJobRunner
}

/** The picked target of the first paragraph whose text starts on `line`, as the Markdown adapter would send it. */
function paragraphOn(text: string, line: number): PickedTargetRequest {
  const index = markdownKind.parse(text, 0).index as MdIndex
  const target = index.elements.find((t: MdTarget) => t.kind === 'paragraph' && t.line === line)
  if (target === undefined) throw new Error(`no paragraph on line ${line}`)
  const sameLine = index.elements.filter(t => t.line === target.line && t.tag === target.tag)
  return { lineStart: target.line, lineEnd: target.lineEnd, tag: target.tag, ordinal: sameLine.indexOf(target) + 1, baseHash: markdownTextHash(index.text) }
}

const caller = () => ({ windowId: 1, root: project.root, realRoot: project.root })

async function listOk(rel: string) {
  const answer = await service.list(caller(), { panelId: PANEL, filePath: project.path(rel) })
  if (!answer.ok) throw new Error(`list refused: ${answer.code} ${answer.reason ?? ''}`)
  return answer
}

async function addOn(rel: string, line: number, text: string) {
  const content = (await project.read(rel)).toString('utf8')
  const draft = await service.openDraft(caller(), { panelId: PANEL, filePath: project.path(rel) })
  if (!draft.ok) return draft
  return service.save(caller(), {
    panelId: PANEL,
    filePath: project.path(rel),
    op: 'add',
    draftToken: draft.draftToken,
    target: paragraphOn(content, line),
    text,
    view: VIEW
  })
}

beforeEach(async () => {
  project = await makeProject()
  settings = GlobalSettingsSchema.parse({})
  writeJobs = []
  service = new FileCommentService({
    kinds: fileCommentKinds,
    unsaved: { hasAny: async () => false },
    identity: () => TEST_REVIEWER,
    send: () => {},
    jobs: recordingJobs(),
    watch: fakeWatches().factory,
    now: () => FIXED_NOW,
    isKindEnabled: kind => rowOf(kind.id)?.enabled(settings) ?? false,
    writeOptions: kind => rowOf(kind.id)?.writeOptions(settings) ?? {}
  })
})

afterEach(async () => {
  await service.clear()
  await project.dispose()
})

describe('024-AC-003 Markdown through the file-comment service', () => {
  it('024-AC-003 list, draft, add on a paragraph, reply, resolve and delete leave the bytes as they were', async () => {
    const before = await project.write('plan.md', PLAN)
    const original = await project.read('plan.md')
    expect((await listOk('plan.md')).file).toMatchObject({ writable: true, threads: [] })

    const added = await addOn('plan.md', 6, 'Split this into two PRs.')
    expect(added).toMatchObject({ ok: true })
    const afterAdd = (await project.read('plan.md')).toString('utf8')
    expect(afterAdd.indexOf('<!-- erfana:comment')).toBeLessThan(afterAdd.indexOf('Ship the first slice.'))
    expect(afterAdd.startsWith('---\ntitle: Plan\n---\n')).toBe(true)

    const ops = [
      { op: 'reply', text: 'Agreed.' },
      { op: 'setStatus', status: 'resolved' },
      { op: 'deleteThread' }
    ] as const
    let last: Awaited<ReturnType<FileCommentService['save']>> = added
    for (const change of ops) {
      const listed = await listOk('plan.md')
      expect(listed.file.threads).toHaveLength(1)
      const [thread] = listed.file.threads
      expect(listed.placements).toEqual([{ threadKey: thread.threadKey, line: expect.any(Number), tag: 'p' }])
      last = await service.save(caller(), { panelId: PANEL, fileKey: listed.file.fileKey, threadKey: thread.threadKey, rawHash: thread.rawHash, ...change })
      expect(last, change.op).toMatchObject({ ok: true })
    }
    expect(last).toEqual({ ok: true, threadKey: null })
    expect((await project.read('plan.md')).equals(original)).toBe(true)
    expect(before).toBe(project.path('plan.md'))
  })

  it.each([
    ['off', false],
    ['on', true]
  ])('024-AC-003 "preserve line breaks" %s reaches the Markdown write job, read at save time', async (_name, preserve) => {
    await project.write('notes.md', SOFT_BREAKS)
    await listOk('notes.md')
    settings = GlobalSettingsSchema.parse({ editor: { preserveLineBreaks: preserve } })
    expect(await addOn('notes.md', 1, 'Is this one line?')).toMatchObject({ ok: true })
    expect(writeJobs.length).toBeGreaterThan(0)
    for (const job of writeJobs) expect(job).toMatchObject({ kind: 'write', breaks: preserve })
  })
})

describe('Markdown comments off in Settings (024-FR-022)', () => {
  it('refuses a draft and every save with comments-off; the list still answers', async () => {
    await project.write('plan.md', PLAN)
    await listOk('plan.md')
    expect(await addOn('plan.md', 6, 'Before.')).toMatchObject({ ok: true })
    const listed = await listOk('plan.md')
    const [thread] = listed.file.threads
    const original = await project.read('plan.md')

    settings = GlobalSettingsSchema.parse({ markdownPreview: { comments: { enabled: false } } })
    const off = { ok: false, code: ErrorCode.COMMENT_PATH_REFUSED, reason: 'comments-off' }
    expect(await service.openDraft(caller(), { panelId: PANEL, filePath: project.path('plan.md') })).toEqual(off)
    expect(
      await service.save(caller(), { panelId: PANEL, fileKey: listed.file.fileKey, threadKey: thread.threadKey, rawHash: thread.rawHash, op: 'reply', text: 'x' })
    ).toEqual(off)
    expect((await listOk('plan.md')).file.threads).toHaveLength(1)
    expect((await project.read('plan.md')).equals(original)).toBe(true)
    expect(writeJobs.length).toBe(1)
  })
})

describe('024-AC-028 item 5: the file-comment family is bound to Markdown', () => {
  it('024-AC-028 every kind of the family has a Settings row; the txt test kind has neither', () => {
    for (const extension of fileCommentKinds.extensions()) {
      const kind = fileCommentKinds.kindOfName(`a${extension}`)
      expect(kind?.id, extension).toBe(markdownKind.id)
      expect(rowOf(markdownKind.id), extension).toBeDefined()
    }
    expect(fileCommentKinds.kindOfName('a.txt')).toBeUndefined()
    expect(rowOf('txt')).toBeUndefined()
  })

  it.each(['index.html', 'page.htm', 'notes.txt'])('024-AC-028 %s is refused by name on file-comment:*, and nothing is watched', async name => {
    await project.write(name, '<p>Hello</p>\n')
    expect(await service.list(caller(), { panelId: PANEL, filePath: project.path(name) })).toMatchObject({
      ok: false,
      code: ErrorCode.COMMENT_PATH_REFUSED
    })
    expect(await service.openDraft(caller(), { panelId: PANEL, filePath: project.path(name) })).toMatchObject({ ok: false })
    expect(service.watchCount).toBe(0)
  })
})

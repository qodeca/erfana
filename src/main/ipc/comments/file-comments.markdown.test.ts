// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `file-comment:*` family with the REAL Markdown kind (spec 024
 * architecture note 001 § 4, § 8 C18): the production registry
 * (`fileCommentKinds`), the production settings row (`KIND_SETTINGS`) and the
 * Markdown job table run in-process, through `FileCommentService` on a temp
 * `.md` file. A full lifecycle leaves the file's bytes as they were; the
 * "preserve line breaks" setting reaches every Markdown write; comments off in
 * Settings refuse the list, a draft and a save; `.html` and `.txt` are refused by name.
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
let listJobs: number
let service: FileCommentService

/** The production settings row for a kind, as `file-comments.ts` wires it. */
const rowOf = (id: string) => KIND_SETTINGS.get(id)

/** The Markdown jobs in-process, recording every write job they were given. */
function recordingJobs(): CommentFileJobRunner {
  const inner = createInProcessMarkdownJobs({ random: seededRandom() })
  return {
    runJob: (bytes, job) => {
      if (job.kind === 'write') writeJobs.push(job)
      if (job.kind === 'list') listJobs += 1
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
  listJobs = 0
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

describe('024-AC-031 a pick inside a generated region is refused when the draft opens (W-08, § 8 C19)', () => {
  const GENERATED = ['# Top', '', '<!-- START toc -->', '', 'Generated line.', '', '<!-- END toc -->', '', 'Own words.', ''].join('\n')

  it('024-AC-031 openDraft with a pick in a START/END region mints the draft and says generated-region, from main\'s one list parse', async () => {
    await project.write('toc.md', GENERATED)
    await listOk('toc.md')
    listJobs = 0
    const draft = await service.openDraft(caller(), { panelId: PANEL, filePath: project.path('toc.md'), target: paragraphOn(GENERATED, 5) })
    expect(draft).toEqual({ ok: true, draftToken: expect.any(String), refused: 'generated-region' })
    expect(listJobs).toBe(1)
  })

  it('024-AC-031 a pick outside the region, or no pick (a keep-alive renewal), carries no refusal', async () => {
    await project.write('toc.md', GENERATED)
    await listOk('toc.md')
    const own = await service.openDraft(caller(), { panelId: PANEL, filePath: project.path('toc.md'), target: paragraphOn(GENERATED, 9) })
    expect(own).toEqual({ ok: true, draftToken: expect.any(String) })
    expect(await service.openDraft(caller(), { panelId: PANEL, filePath: project.path('toc.md') })).toEqual({ ok: true, draftToken: expect.any(String) })
  })

  it('024-AC-031 the save on that pick is still refused as generated-region and writes nothing', async () => {
    const original = Buffer.from(GENERATED)
    await project.write('toc.md', GENERATED)
    await listOk('toc.md')
    const target = paragraphOn(GENERATED, 5)
    const draft = await service.openDraft(caller(), { panelId: PANEL, filePath: project.path('toc.md'), target })
    if (!draft.ok) throw new Error('no draft')
    const saved = await service.save(caller(), { panelId: PANEL, filePath: project.path('toc.md'), op: 'add', draftToken: draft.draftToken, target, text: 'x', view: VIEW })
    expect(saved).toMatchObject({ ok: false, reason: 'generated-region' })
    expect((await project.read('toc.md')).equals(original)).toBe(true)
  })
})

describe('024-AC-003 M-A a list item\'s later block indented past the item\'s content column takes a comment', () => {
  it.each([
    ['four spaces under "1. "', '1. Ship it.\n\n    Then tell the team.\n'],
    ['a tab under "- "', '- Ship it.\n\n\tThen tell the team.\n'],
    ['four spaces under "- "', '- Ship it.\n\n    Then tell the team.\n']
  ])('024-AC-003 %s: the save writes the block at the item\'s column and keeps every other byte', async (_name, text) => {
    await project.write('later.md', text)
    await listOk('later.md')
    expect(await addOn('later.md', 3, 'Who tells them?')).toMatchObject({ ok: true })
    const after = (await project.read('later.md')).toString('utf8')
    const at = after.indexOf('<!-- erfana:comment')
    const end = after.indexOf('-->', after.lastIndexOf('erfana:comment')) + 3
    const lineStart = after.lastIndexOf('\n', at) + 1
    // Outside the block and its own indent and line break, the file is as it was.
    expect(after.slice(0, lineStart) + after.slice(end + 1)).toBe(text)
    expect(after.slice(lineStart, at)).toMatch(/^ +$/)
    const listed = await listOk('later.md')
    expect(listed.file.threads).toHaveLength(1)
  })
})

describe('Markdown comments off in Settings (024-FR-022)', () => {
  const off ={ ok: false, code: ErrorCode.COMMENT_PATH_REFUSED, reason: 'comments-off' }

  it('refuses a draft and every save with comments-off', async () => {
    await project.write('plan.md', PLAN)
    await listOk('plan.md')
    expect(await addOn('plan.md', 6, 'Before.')).toMatchObject({ ok: true })
    const listed = await listOk('plan.md')
    const [thread] = listed.file.threads
    const original = await project.read('plan.md')

    settings = GlobalSettingsSchema.parse({ markdownPreview: { comments: { enabled: false } } })
    expect(await service.openDraft(caller(), { panelId: PANEL, filePath: project.path('plan.md') })).toEqual(off)
    expect(
      await service.save(caller(), { panelId: PANEL, fileKey: listed.file.fileKey, threadKey: thread.threadKey, rawHash: thread.rawHash, op: 'reply', text: 'x' })
    ).toEqual(off)
    expect((await project.read('plan.md')).equals(original)).toBe(true)
    expect(writeJobs.length).toBe(1)
  })

  it('owner decision 2026-10-30: the list refuses too – no parse, no watch, and the panel\'s earlier watch is released', async () => {
    await project.write('plan.md', PLAN)
    await project.write('other.md', PLAN)
    await listOk('plan.md')
    expect(service.watchCount).toBe(1)
    settings = GlobalSettingsSchema.parse({ markdownPreview: { comments: { enabled: false } } })
    const jobsBefore = listJobs
    expect(await service.list(caller(), { panelId: PANEL, filePath: project.path('plan.md') })).toEqual(off)
    expect(await service.list(caller(), { panelId: 'editor-panel-2', filePath: project.path('other.md') })).toEqual(off)
    expect(listJobs).toBe(jobsBefore)
    expect(service.watchCount).toBe(0)
    // The panel is no longer recorded: a thread key or a draft names nothing
    expect(await service.openDraft(caller(), { panelId: PANEL, filePath: project.path('plan.md') })).toMatchObject({ ok: false, reason: 'not-open' })
    // Back on, the list answers again
    settings = GlobalSettingsSchema.parse({})
    expect((await listOk('plan.md')).file.writable).toBe(true)
    expect(listJobs).toBe(jobsBefore + 1)
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

describe('024-AC-005 a selection comment on a second list item (a line-start slot)', () => {
  it('024-AC-005 is written inside the first item with its indent, keeps anchor.sel, and leaves every other byte as it was', async () => {
    const text = ['# Review', '', '- alpha', '- beta release notes', '', 'Closing paragraph.', ''].join('\n')
    await project.write('review.md', text)
    await listOk('review.md')
    const draft = await service.openDraft(caller(), { panelId: PANEL, filePath: project.path('review.md') })
    if (!draft.ok) throw new Error(`draft refused: ${draft.code}`)
    const saved = await service.save(caller(), {
      panelId: PANEL,
      filePath: project.path('review.md'),
      op: 'add',
      draftToken: draft.draftToken,
      target: { lineStart: 4, lineEnd: 4, tag: 'li', ordinal: 1, quote: { exact: 'beta release notes', prefix: '', suffix: '' }, baseHash: markdownTextHash(text) },
      sel: { exact: 'beta', prefix: '', suffix: ' release notes' },
      text: 'Which release?',
      view: VIEW
    })
    expect(saved).toMatchObject({ ok: true })
    const after = (await project.read('review.md')).toString('utf8')
    const start = after.indexOf('  <!-- erfana:comment v1')
    expect(start).toBeGreaterThan(after.indexOf('- alpha'))
    expect(after.slice(0, start)).toBe(text.slice(0, start))
    expect(after.endsWith(text.slice(start))).toBe(true)
    expect(after).toContain('"sel":{"exact":"beta","prefix":"","suffix":" release notes"}')
  })
})

describe('024-AC-003 (Markdown) the icon names the inner target (markdown-format.md § 5)', () => {
  /** Save one comment on the target the Markdown adapter would pick, and list the file again. */
  async function commentOn(rel: string, text: string, target: Omit<PickedTargetRequest, 'baseHash'>) {
    await project.write(rel, text)
    await listOk(rel)
    const draft = await service.openDraft(caller(), { panelId: PANEL, filePath: project.path(rel) })
    if (!draft.ok) throw new Error(`draft refused: ${draft.code}`)
    const saved = await service.save(caller(), {
      panelId: PANEL,
      filePath: project.path(rel),
      op: 'add',
      draftToken: draft.draftToken,
      target: { ...target, baseHash: markdownTextHash(text) },
      text: 'Check this.',
      view: VIEW
    })
    expect(saved).toMatchObject({ ok: true })
    return listOk(rel)
  }

  it('024-AC-003 (Markdown) a comment on list item 1 is labelled as the list item, not the list it is written before', async () => {
    const text = ['# Plan', '', '- Freeze the API on Monday.', '- Run the load test.', ''].join('\n')
    const listed = await commentOn('item1.md', text, {
      lineStart: 3,
      lineEnd: 3,
      tag: 'li',
      ordinal: 1,
      quote: { exact: 'Freeze the API on Monday.', prefix: '', suffix: '' }
    })
    // The block sits before the whole list and its anchor names the list, with the item as the inner target …
    const after = (await project.read('item1.md')).toString('utf8')
    expect(after).toContain('target: <ul> (comment is about <li> at li:nth-of-type(1) inside this element)')
    const [thread] = listed.file.threads
    expect(thread).toMatchObject({ tag: 'ul', runtime: { tag: 'li', path: 'li:nth-of-type(1)' } })
    // … and the icon is drawn on, and named after, the item the window said ("New comment on list item").
    const itemLine = after.split('\n').indexOf('- Freeze the API on Monday.') + 1
    expect(listed.placements).toEqual([{ threadKey: thread.threadKey, line: itemLine, tag: 'li' }])
  })

  it('024-AC-003 (Markdown) a comment on a table cell past the first stays on the table: a placement cannot name that cell', async () => {
    const text = ['| a | b |', '| - | - |', '| one | two |', ''].join('\n')
    const listed = await commentOn('cells.md', text, {
      lineStart: 3,
      lineEnd: 3,
      tag: 'td',
      ordinal: 2,
      quote: { exact: 'two', prefix: '', suffix: '' }
    })
    const [thread] = listed.file.threads
    expect(thread).toMatchObject({ tag: 'table', runtime: { tag: 'td' } })
    const headerLine = (await project.read('cells.md')).toString('utf8').split('\n').indexOf('| a | b |') + 1
    expect(listed.placements).toEqual([{ threadKey: thread.threadKey, line: headerLine, tag: 'table' }])
  })
})

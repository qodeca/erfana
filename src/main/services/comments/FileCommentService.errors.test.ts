// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `file-comment:save` error paths at main-service level (024-AC-038,
 * 024-AC-034 (b), 024-AC-014 (a)–(c); 024-FR-013): every refused save leaves
 * the file byte-identical and answers a code AND a reason. Faults are
 * injected through the test-registered paragraph kind, a failing job runner,
 * and a hook around the strict write (split into its own file because the
 * hook mocks a module for the whole file – docs/windows/contributing.md).
 */
import { createHash } from 'node:crypto'
import { link, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  /** Replaces the strict write's answer when set. */
  refuse: null as null | { ok: false; reason: string },
  /** Runs after a strict write landed (an outside writer in the C12 gap). */
  afterWrite: null as null | ((path: string) => Promise<void>)
}))

vi.mock('../../utils/atomicWriteBytesStrict', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/atomicWriteBytesStrict')>()
  return {
    ...actual,
    atomicWriteBytesStrict: async (...args: Parameters<typeof actual.atomicWriteBytesStrict>) => {
      if (hooks.refuse !== null) return hooks.refuse
      const written = await actual.atomicWriteBytesStrict(...args)
      if (written.ok) await hooks.afterWrite?.(written.path)
      return written
    }
  }
})

import { ErrorCode } from '../../../shared/errors'
import type { CommentFileJobRunner } from './commentFileJobs'
import { fileCommentHarness, PANEL, pickOn, VIEW, type FileCommentHarness, type HarnessOptions } from './__test-helpers__/fileCommentHarness'

const DOC = 'Intro paragraph one.\n\nSecond paragraph here.\n'

let h: FileCommentHarness
let before: Buffer

async function setUp(options: HarnessOptions = {}, content: string | Uint8Array = DOC): Promise<void> {
  h = await fileCommentHarness(options)
  await h.project.write('notes.txt', content)
  before = await h.project.read('notes.txt')
}

beforeEach(() => {
  hooks.refuse = null
  hooks.afterWrite = null
})

afterEach(async () => {
  await h.service.clear()
  await h.project.dispose()
})

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** The file is exactly as it was before the save (compared by digest: one case is a 25 MB file). */
async function unchanged(rel = 'notes.txt'): Promise<void> {
  expect(digest(await h.project.read(rel))).toBe(digest(before))
}

/** List, then add on `line`: the refusal a save of a new comment meets. */
async function addAfterList(line = 3): Promise<unknown> {
  await h.service.list(h.caller(), { panelId: PANEL, filePath: h.project.path('notes.txt') })
  return h.add('notes.txt', line, 'Typed text that must be kept.')
}

/** Add a comment, then answer the first thread's keys from a fresh list. */
async function threadKeys() {
  await h.listOk('notes.txt')
  await h.add('notes.txt', 3, 'First.')
  const { file } = await h.listOk('notes.txt')
  before = await h.project.read('notes.txt')
  return { fileKey: file.fileKey, threadKey: file.threads[0].threadKey, rawHash: file.threads[0].rawHash }
}

const refused = (code: ErrorCode, reason: string) => ({ ok: false, code, reason })

describe('024-AC-038 one row per writer error code: nothing written, a code and a reason', () => {
  it('COMMENT_TARGET_MOVED – no paragraph on the picked line', async () => {
    await setUp()
    expect(await addAfterList(2)).toEqual(refused(ErrorCode.COMMENT_TARGET_MOVED, 'target-moved'))
    await unchanged()
  })

  it('COMMENT_BLOCK_CHANGED – the block changed since it was listed', async () => {
    await setUp()
    const keys = await threadKeys()
    const stale = { ...keys, rawHash: 'f'.repeat(64) }
    expect(await h.service.save(h.caller(), { panelId: PANEL, ...stale, op: 'reply', text: 'x' })).toEqual(
      refused(ErrorCode.COMMENT_BLOCK_CHANGED, 'block-changed')
    )
    await unchanged()
  })

  it('COMMENT_ENCODING_UNSUPPORTED – not UTF-8', async () => {
    await setUp({}, Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
    expect(await addAfterList(1)).toEqual(refused(ErrorCode.COMMENT_ENCODING_UNSUPPORTED, 'encoding'))
    await unchanged()
  })

  it('COMMENT_FILE_CONFLICTED – a git conflict hunk', async () => {
    await setUp({}, `${DOC}<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs\n`)
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_FILE_CONFLICTED, 'conflict-markers'))
    await unchanged()
  })

  it('COMMENT_DRAFT_EXPIRED – a draft older than its time to live', async () => {
    let now = 0
    await setUp({ service: { keys: { now: () => now } } })
    await h.listOk('notes.txt')
    const draft = await h.service.openDraft(h.caller(), { panelId: PANEL, filePath: h.project.path('notes.txt') })
    if (!draft.ok) throw new Error('no draft')
    now = 11 * 60 * 1000
    const save = { panelId: PANEL, filePath: h.project.path('notes.txt'), op: 'add' as const, draftToken: draft.draftToken, target: pickOn(3), text: 'x', view: VIEW }
    expect(await h.service.save(h.caller(), save)).toEqual(refused(ErrorCode.COMMENT_DRAFT_EXPIRED, 'draft-expired'))
    await unchanged()
  })

  it('COMMENT_KEY_INVALID – an unknown key', async () => {
    await setUp()
    const keys = await threadKeys()
    expect(await h.service.save(h.caller(), { panelId: PANEL, ...keys, threadKey: 'tunknown', op: 'deleteThread' })).toEqual(
      refused(ErrorCode.COMMENT_KEY_INVALID, 'key-invalid')
    )
    await unchanged()
  })

  it('COMMENT_IDENTITY_REQUIRED – no reviewer name in the settings', async () => {
    await setUp({ identity: undefined })
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_IDENTITY_REQUIRED, 'identity'))
    await unchanged()
  })

  it('COMMENT_LIMIT – the file already holds the most blocks', async () => {
    const blocks = Array.from({ length: 500 }, (_, i) => `<!-- erfana:comment v1 id=c-${String(i).padStart(16, 'a')} -->`).join('\n')
    await setUp({}, `${blocks}\n\n${DOC}`)
    expect(await addAfterList(502)).toEqual(refused(ErrorCode.COMMENT_LIMIT, 'limit'))
    await unchanged()
  })

  it('COMMENT_FILE_TOO_LARGE – over the comment file limit', async () => {
    await setUp({}, Buffer.alloc(25 * 1024 * 1024 + 1, 0x61))
    expect(await addAfterList(1)).toEqual(refused(ErrorCode.COMMENT_FILE_TOO_LARGE, 'too-large'))
    await unchanged()
  })

  it('COMMENT_WRITE_REFUSED_LINK – a file with another hard link', async () => {
    await setUp()
    await link(h.project.path('notes.txt'), h.project.path('alias.txt'))
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_WRITE_REFUSED_LINK, 'link'))
    await unchanged()
  })

  it('COMMENT_WRITE_UNSUPPORTED_FS – a drive that cannot rename or fsync', async () => {
    await setUp()
    hooks.refuse = { ok: false, reason: 'unsupported-fs' }
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_WRITE_UNSUPPORTED_FS, 'unsupported-fs'))
    await unchanged()
  })

  it('COMMENT_UNSAVED_SOURCE – an editor holds unsaved edits', async () => {
    await setUp()
    h.dirty.add(h.project.path('notes.txt'))
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_UNSAVED_SOURCE, 'unsaved-source'))
    await unchanged()
  })

  it('COMMENT_FILE_GONE – the file was deleted while the window was open', async () => {
    await setUp()
    await h.listOk('notes.txt')
    await rm(h.project.path('notes.txt'))
    expect(await h.add('notes.txt', 3, 'x')).toMatchObject({ ok: false, reason: 'missing', code: ErrorCode.COMMENT_FILE_GONE })
  })

  it('COMMENT_PATH_REFUSED – a file of no kind this family serves', async () => {
    await setUp()
    await h.project.write('page.html', '<p>x</p>')
    expect(await h.service.list(h.caller(), { panelId: PANEL, filePath: h.project.path('page.html') })).toEqual(
      refused(ErrorCode.COMMENT_PATH_REFUSED, 'not-html')
    )
  })

  it('COMMENT_FILE_READ_ONLY – an unterminated block', async () => {
    await setUp({}, `${DOC}\n<!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaaa\n`)
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_FILE_READ_ONLY, 'unterminated-block'))
    await unchanged()
  })

  it('COMMENT_WRITE_FAILED – a rewrite that fails the kind check is never written (fail closed)', async () => {
    // The add's check passes; the reply's fails
    await setUp({ kind: { verifyFails: call => call >= 2 } })
    const keys = await threadKeys()
    expect(await h.service.save(h.caller(), { panelId: PANEL, ...keys, op: 'reply', text: 'x' })).toEqual(
      refused(ErrorCode.COMMENT_WRITE_FAILED, 'verify-failed')
    )
    await unchanged()
  })

  it('COMMENT_RENDER_CHANGED – no slot passes the kind\'s own check (C25)', async () => {
    await setUp({ kind: { failVerify: Infinity, slotCount: 3 } })
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_RENDER_CHANGED, 'render-changed'))
    expect(h.kind.verifyCalls()).toBe(3)
    await unchanged()
  })

  it('a later slot is taken when an earlier one fails only the kind\'s check', async () => {
    await setUp({ kind: { failVerify: 1, slotCount: 2 } })
    expect(await addAfterList()).toMatchObject({ ok: true })
    expect(h.kind.verifyCalls()).toBe(2)
  })
})

describe('024-AC-038 the other error paths', () => {
  it('the file renamed while the window is open: missing, nothing written', async () => {
    await setUp()
    await h.listOk('notes.txt')
    await rename(h.project.path('notes.txt'), h.project.path('moved.txt'))
    expect(await h.add('notes.txt', 3, 'x')).toMatchObject({ ok: false, code: ErrorCode.COMMENT_FILE_GONE, reason: 'missing' })
    expect(await h.project.read('moved.txt')).toEqual(before)
  })

  it('two windows saving the same thread at once: one writes, the other is refused as changed', async () => {
    await setUp()
    const keys = await threadKeys()
    await h.listOk('notes.txt', { windowId: 2 })
    const { file } = await h.listOk('notes.txt', { windowId: 2 })
    const other = { fileKey: file.fileKey, threadKey: file.threads[0].threadKey, rawHash: file.threads[0].rawHash }
    const [a, b] = await Promise.all([
      h.service.save(h.caller(1), { panelId: PANEL, ...keys, op: 'reply', text: 'From one.' }),
      h.service.save(h.caller(2), { panelId: PANEL, ...other, op: 'reply', text: 'From two.' })
    ])
    expect([a, b].filter(answer => answer.ok)).toHaveLength(1)
    expect([a, b].find(answer => !answer.ok)).toEqual(refused(ErrorCode.COMMENT_BLOCK_CHANGED, 'block-changed'))
    expect((await h.listOk('notes.txt')).file.threads[0].messages).toHaveLength(2)
  })

  it.each(['crashed', 'timeout'] as const)('a parse worker that %s: nothing written', async failure => {
    const jobs: CommentFileJobRunner = { runJob: async () => ({ kind: 'failed', failure }) as never }
    await setUp({ jobs })
    expect(await h.service.list(h.caller(), { panelId: PANEL, filePath: h.project.path('notes.txt') })).toEqual(
      refused(ErrorCode.COMMENT_WRITE_FAILED, 'parse-failed')
    )
    expect(await h.add('notes.txt', 3, 'x')).toEqual(refused(ErrorCode.COMMENT_WRITE_FAILED, 'parse-failed'))
    await unchanged()
  })

  it('a symlink out of the project is refused, and the target is untouched', async ctx => {
    await setUp()
    const outside = join(tmpdir(), `erfana-outside-${process.pid}-${Date.now()}`)
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.txt'), DOC)
    try {
      await symlink(join(outside, 'secret.txt'), h.project.path('link.txt'))
    } catch {
      await rm(outside, { recursive: true, force: true })
      ctx.skip() // creating a symlink needs a privilege this host does not grant (Windows without Developer Mode)
    }
    expect(await h.service.list(h.caller(), { panelId: PANEL, filePath: h.project.path('link.txt') })).toEqual(
      refused(ErrorCode.COMMENT_PATH_REFUSED, 'outside-project')
    )
    expect((await readFile(join(outside, 'secret.txt'))).toString('utf8')).toBe(DOC)
    await rm(outside, { recursive: true, force: true })
  })

  it('an empty file: no target, nothing written', async () => {
    await setUp({}, '')
    expect(await addAfterList(1)).toEqual(refused(ErrorCode.COMMENT_TARGET_MOVED, 'target-moved'))
    await unchanged()
  })

  it('a frontmatter-only file: the frontmatter is refused with its reason', async () => {
    await setUp({}, '---\ntitle: Notes\n---\n')
    expect(await addAfterList(2)).toEqual(refused(ErrorCode.COMMENT_TARGET_MOVED, 'frontmatter'))
    await unchanged()
  })

  it('a generated region: refused with its reason (024-FR-023)', async () => {
    await setUp({}, `${DOC}\n<!-- START -->\nGenerated text.\n<!-- END -->\n`)
    expect(await addAfterList(6)).toEqual(refused(ErrorCode.COMMENT_TARGET_MOVED, 'generated-region'))
    await unchanged()
  })

  it('no final line break: a refused save leaves it as it was; a landed one changes only its range', async () => {
    await setUp({ kind: { failVerify: Infinity } }, 'Only paragraph, no line break')
    expect(await addAfterList(1)).toEqual(refused(ErrorCode.COMMENT_RENDER_CHANGED, 'render-changed'))
    await unchanged()
    await h.service.clear()
    await h.project.dispose()
    await setUp({}, 'Only paragraph, no line break')
    expect(await addAfterList(1)).toMatchObject({ ok: true })
    const after = (await h.project.read('notes.txt')).toString('utf8')
    expect(after.startsWith('<!-- erfana:comment v1')).toBe(true)
    expect(after.endsWith('-->\nOnly paragraph, no line break')).toBe(true)
  })

  it('C12 the file changed right after the rename: reported, never hidden', async () => {
    await setUp()
    hooks.afterWrite = path => writeFile(path, 'Someone else wrote this.\n')
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_WRITE_FAILED, 'changed-during-save'))
  })
})

describe('024-AC-034 (b) another window\'s unsaved edits refuse the save in main', () => {
  it('refused with its reason, nothing written', async () => {
    await setUp()
    await h.listOk('notes.txt', { windowId: 2 })
    // Window 2 – not the saving window – holds unsaved edits for the file
    h.dirty.add(h.project.path('notes.txt'))
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_UNSAVED_SOURCE, 'unsaved-source'))
    await unchanged()
  })

  it('the under-lock re-check refuses when the report arrives between the plan and the rename', async () => {
    await setUp()
    const real = h.project.path('notes.txt')
    h.hasAny.mockImplementationOnce(async () => false).mockImplementationOnce(async () => true)
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_UNSAVED_SOURCE, 'unsaved-source'))
    expect(h.hasAny).toHaveBeenCalledTimes(2)
    expect(h.hasAny).toHaveBeenLastCalledWith(real)
    await unchanged()
  })
})

describe('024-AC-014 at main level: byte-identical, with a code and a reason', () => {
  it('(a) a forced check failure', async () => {
    await setUp({ kind: { failVerify: Infinity } })
    expect(await addAfterList()).toEqual(refused(ErrorCode.COMMENT_RENDER_CHANGED, 'render-changed'))
    await unchanged()
  })

  it('(b) the target removed from the file before Save', async () => {
    await setUp()
    await h.listOk('notes.txt')
    await h.project.write('notes.txt', 'Intro paragraph one.\n')
    before = await h.project.read('notes.txt')
    expect(await h.add('notes.txt', 3, 'x')).toEqual(refused(ErrorCode.COMMENT_TARGET_MOVED, 'target-moved'))
    await unchanged()
  })

  it('(c) the target moved and edited before Save', async () => {
    await setUp()
    await h.listOk('notes.txt')
    await h.project.write('notes.txt', 'Intro paragraph one.\n\n\n\nSecond paragraph, now edited.\n')
    before = await h.project.read('notes.txt')
    expect(await h.add('notes.txt', 3, 'x')).toEqual(refused(ErrorCode.COMMENT_TARGET_MOVED, 'target-moved'))
    await unchanged()
  })
})

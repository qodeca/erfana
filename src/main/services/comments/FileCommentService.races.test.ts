// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `FileCommentService` under races found by the security audit of 8a4e442e:
 * a list racing a window close or a project switch records nothing (L5), and
 * a folder swapped for an in-project link between list and save never
 * redirects the write (L3).
 */
import { copyFile, mkdir, rename, symlink } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { fileCommentHarness, PANEL, type FileCommentHarness } from './__test-helpers__/fileCommentHarness'

const DOC = 'Intro paragraph one.\n\nSecond paragraph here.\n'
const NOT_OPEN = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID, reason: 'not-open' }

let h: FileCommentHarness

beforeEach(async () => {
  h = await fileCommentHarness()
  await h.project.write('notes.txt', DOC)
})

afterEach(async () => {
  await h.service.clear()
  await h.project.dispose()
})

describe('L5: a list racing its cleanup records no panel and no watch', () => {
  it('the window closes while the list confines the path', async () => {
    const listing = h.service.list(h.caller(), { panelId: PANEL, filePath: h.project.path('notes.txt') })
    h.service.forgetWindow(1)
    expect(await listing).toEqual(NOT_OPEN)
    expect(h.service.watchCount).toBe(0)
    expect(await h.service.openDraft(h.caller(), { panelId: PANEL, filePath: h.project.path('notes.txt') })).toEqual(NOT_OPEN)
  })

  it('the project changes while the list confines the path', async () => {
    const listing = h.service.list(h.caller(), { panelId: PANEL, filePath: h.project.path('notes.txt') })
    const clearing = h.service.clear()
    expect(await listing).toEqual(NOT_OPEN)
    await clearing
    expect(h.service.watchCount).toBe(0)
    expect(h.watches.open.size).toBe(0)
  })

  it('another window closing does not refuse this window\'s list, and a later list of the closed window\'s id is served', async () => {
    const listing = h.service.list(h.caller(1), { panelId: PANEL, filePath: h.project.path('notes.txt') })
    h.service.forgetWindow(2)
    expect(await listing).toMatchObject({ ok: true })
    h.service.forgetWindow(1)
    expect((await h.listOk('notes.txt')).ok).toBe(true)
    expect(h.service.watchCount).toBe(1)
  })
})

describe('L3: the writer is held to the real path the panel listed', () => {
  it('a folder swapped for an in-project junction between list and save is refused as changed; nothing is written', async ctx => {
    await mkdir(h.project.path('a'))
    await mkdir(h.project.path('b'))
    await h.project.write('a/notes.txt', DOC)
    await h.listOk('a/notes.txt')
    expect(await h.add('a/notes.txt', 3, 'First.')).toMatchObject({ ok: true })
    const { file } = await h.listOk('a/notes.txt')
    const [thread] = file.threads
    // The decoy holds the very same thread, so a redirected reply would land there.
    await copyFile(h.project.path('a/notes.txt'), h.project.path('b/notes.txt'))
    const decoy = await h.project.read('b/notes.txt')
    await rename(h.project.path('a'), h.project.path('a-old'))
    try {
      await symlink(h.project.path('b'), h.project.path('a'), 'junction')
    } catch {
      ctx.skip() // this host cannot create a directory link
    }
    const reply = await h.service.save(h.caller(), {
      panelId: PANEL,
      fileKey: file.fileKey,
      threadKey: thread.threadKey,
      rawHash: thread.rawHash,
      op: 'reply',
      text: 'Redirected?'
    })
    expect(reply).toEqual({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'changed' })
    expect(await h.project.read('b/notes.txt')).toEqual(decoy)
  })
})

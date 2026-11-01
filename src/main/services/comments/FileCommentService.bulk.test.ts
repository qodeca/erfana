// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** `file-comment:bulk` over a real write (024-FR-028): keys, the panel's own file, and comments off. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { fileCommentHarness, PANEL, type FileCommentHarness } from './__test-helpers__/fileCommentHarness'

const FILE = 'notes.txt'

describe('FileCommentService.bulk', () => {
  let h: FileCommentHarness

  beforeEach(async () => {
    h = await fileCommentHarness()
    await h.project.write(FILE, 'One.\n\nTwo.\n\nThree.\n')
    await h.listOk(FILE)
    for (const line of [5, 3, 1]) expect(await h.add(FILE, line, `On ${line}`)).toMatchObject({ ok: true })
  })
  afterEach(() => h.project.dispose())

  const requestFor = async (change: 'resolve' | 'deleteResolved') => {
    const { file } = await h.listOk(FILE)
    return { panelId: PANEL, change, files: [{ fileKey: file.fileKey, threads: file.threads.map(t => ({ threadKey: t.threadKey, rawHash: t.rawHash })) }] }
  }

  it('024-FR-028 resolves, then deletes, every thread, and the file is the file before them', async () => {
    const resolved = await h.service.bulk(h.caller(), await requestFor('resolve'))
    expect(resolved).toMatchObject({ ok: true, files: [{ ok: true, done: 3 }] })
    expect((await h.listOk(FILE)).file.threads.map(t => t.status)).toEqual(['resolved', 'resolved', 'resolved'])
    expect(await h.service.bulk(h.caller(), await requestFor('deleteResolved'))).toMatchObject({ ok: true, files: [{ ok: true, done: 3 }] })
    expect((await h.project.read(FILE)).toString('utf8')).toBe('One.\n\nTwo.\n\nThree.\n')
  })

  it('024-FR-028 refuses a window whose panel does not show the file: keys are per panel', async () => {
    const request = await requestFor('resolve')
    expect(await h.service.bulk(h.caller(2), request)).toMatchObject({ ok: false, reason: 'not-open' })
    await h.listOk(FILE, { windowId: 2, panelId: 'other-panel' })
    expect(await h.service.bulk(h.caller(2), { ...request, panelId: 'other-panel' })).toMatchObject({
      ok: true,
      files: [{ ok: false, code: ErrorCode.COMMENT_KEY_INVALID }]
    })
  })

  it('024-AC-038 unsaved edits refuse the write and leave the file byte-identical', async () => {
    const before = await h.project.read(FILE)
    const request = await requestFor('resolve')
    h.dirty.add(h.project.path(FILE))
    expect(await h.service.bulk(h.caller(), request)).toMatchObject({ ok: true, files: [{ ok: false, reason: 'unsaved-source' }] })
    expect((await h.project.read(FILE)).equals(before)).toBe(true)
  })

  it('024-FR-028 comments off in Settings refuses before any key is read', async () => {
    const request = await requestFor('resolve')
    const off = await fileCommentHarness({ service: { isKindEnabled: () => false } })
    await off.project.write(FILE, 'One.\n')
    await off.service.list(off.caller(), { panelId: PANEL, filePath: off.project.path(FILE) })
    const spy = vi.fn()
    expect(await off.service.bulk(off.caller(), request).catch(spy)).toMatchObject({ ok: false })
    expect(spy).not.toHaveBeenCalled()
    await off.project.dispose()
  })
})

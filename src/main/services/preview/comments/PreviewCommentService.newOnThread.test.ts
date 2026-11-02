// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "New comment" with no pin's draft (comments-v2 C-22; owner decision,
 * 2026-11-01): a window opened from a drawer row or a step key asks main for
 * a draft on the thread's element, by the thread's own key.
 */
import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { logger } from '../../LoggingService'
import { commentedPage } from './__test-helpers__/commentedPages'
import { commentServiceFixture, type CommentServiceFixture } from './__test-helpers__/commentServiceFixture'
import { READ_VIEW_SCRIPT } from './commentScripts'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

let f: CommentServiceFixture | undefined

afterEach(async () => {
  await f?.dispose()
  f = undefined
})

async function listed(fixture: CommentServiceFixture) {
  const list = await fixture.service.list()
  if (!list.ok) throw new Error('list')
  return list.files[0]
}

const VIEW = { w: 900, h: 600, dpr: 2, x: 0, y: 120 }

describe('C-22 a new comment on a listed thread\'s target', () => {
  it('C-22 sends the draft as an open draft: nothing painted, nothing captured, the page not asked', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    const file = await listed(f)
    const thread = file.threads.find(one => one.status === 'open')!
    f.view.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world: number, [script]: { code: string }[]) => (script.code === READ_VIEW_SCRIPT ? VIEW : true))
    f.captureFresh.mockClear()
    f.emit.draftOpened.mockClear()
    expect(await f.service.newOnThread(thread.threadKey)).toEqual({ ok: true })
    expect(f.captureFresh).not.toHaveBeenCalled()
    expect(f.emit.draftOpened).toHaveBeenCalledTimes(1)
    const [, payload] = f.emit.draftOpened.mock.calls[0]
    expect(payload).toMatchObject({ kind: 'open', displayPath: 'index.html', fileKey: file.fileKey, draftToken: expect.any(String), draftKey: expect.any(String), target: { tag: thread.tag } })
  })

  it('C-22 a resolved thread has no pin, and its target still takes a new comment', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    const resolved = (await listed(f)).threads.find(one => one.status === 'resolved')!
    expect(await f.service.newOnThread(resolved.threadKey)).toEqual({ ok: true })
  })

  it('SEC-08 another kind of key, or an unknown one, is invalid and opens nothing', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    const file = await listed(f)
    f.emit.draftOpened.mockClear()
    expect(await f.service.newOnThread(file.fileKey)).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
    expect(await f.service.newOnThread('k'.repeat(32))).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
    expect(f.emit.draftOpened).not.toHaveBeenCalled()
  })

  it('C-14 a file changed since the page loaded opens no draft, and says so', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    const thread = (await listed(f)).threads.find(one => one.status === 'open')!
    f.emit.draftOpened.mockClear()
    await writeFile(f.pagePath, '<p>Another page</p>')
    const answer = await f.service.newOnThread(thread.threadKey)
    expect(answer.ok).toBe(false)
    expect(f.emit.draftOpened).not.toHaveBeenCalled()
  })

  it('C-22 a page that does not answer still gets its new comment: the reader\'s place is only a note', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    const thread = (await listed(f)).threads.find(one => one.status === 'open')!
    f.view.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async () => {
      throw new Error('gone')
    })
    expect(await f.service.newOnThread(thread.threadKey)).toEqual({ ok: true })
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith('Preview comments: the view could not be read', { error: 'Error' })
  })
})

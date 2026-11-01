// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the service holds back (security audit of the comments work): a press
 * does not outlive the page or the mode it was made in (`ContextKeyGate.clear`),
 * and nothing runs for a view whose comments were turned off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { BASE_PAGE, commentedPage } from './__test-helpers__/commentedPages'
import { commentServiceFixture, type CommentServiceFixture } from './__test-helpers__/commentServiceFixture'
import { FakeFrame, tokenOfTag } from './__test-helpers__/commentServiceHarness'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }
const REFUSED = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }

let f: CommentServiceFixture | undefined

afterEach(async () => {
  await f?.dispose()
  f = undefined
})

const menuOn = (token: string) => ({ kind: 'menu', via: 'pointer', token, tag: 'button', screen: { x: 30, y: 40 }, view: VIEW })
const keyMenuOn = (token: string) => ({ kind: 'context', via: 'keyboard', token, tag: 'button', point: { x: 1, y: 2 }, view: VIEW })

describe('PreviewCommentService real input', () => {
  it('L-1 a press in comment mode lets a pick through, once', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    const token = tokenOfTag(load.doc, 'button')
    await f.forgedPick(f.top, menuOn(token))
    expect(f.emit.draftOpened).not.toHaveBeenCalled()
    f.service.pagePressed('down')
    await f.forgedPick(f.top, menuOn(token))
    await f.forgedPick(f.top, menuOn(token))
    expect(f.emit.draftOpened).toHaveBeenCalledTimes(1)
  })

  it('B a press does not outlive the main-frame document it was made on', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    f.service.pagePressed('down')
    const next = await f.loadPage()
    await f.forgedPick(f.top, menuOn(tokenOfTag(next.doc, 'button')))
    expect(f.emit.draftOpened).not.toHaveBeenCalled()
    expect(load.doc).not.toBe(next.doc)
  })

  it('B a menu key does not outlive the main-frame document it was pressed on', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    await f.loadPage()
    f.service.menuKeyPressed()
    const next = await f.loadPage()
    await f.forgedPick(f.top, keyMenuOn(tokenOfTag(next.doc, 'button')))
    expect(f.emit.draftOpened).not.toHaveBeenCalled()
  })

  it('B a child frame loading keeps a press: only the page changing forgets it', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    f.service.pagePressed('down')
    f.navigate(new FakeFrame(2, f.top), 'frame.html')
    await f.forgedPick(f.top, menuOn(tokenOfTag(load.doc, 'button')))
    expect(f.emit.draftOpened).toHaveBeenCalledTimes(1)
  })

  it('B a key pressed in one mode buys nothing in the next', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    f.service.menuKeyPressed()
    await f.service.setMode(true, true)
    await f.service.setMode(false, true)
    await f.forgedPick(f.top, keyMenuOn(tokenOfTag(load.doc, 'button')))
    expect(f.emit.draftOpened).not.toHaveBeenCalled()
  })

  it('B setting the same mode again keeps a press: a click may be on its way', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    f.service.pagePressed('down')
    await f.service.setMode(true, false)
    await f.forgedPick(f.top, menuOn(tokenOfTag(load.doc, 'button')))
    expect(f.emit.draftOpened).toHaveBeenCalledTimes(1)
  })

  it('D a press with comments off is not kept for after they come back on', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    f.setEnabled(false)
    f.service.pagePressed('down')
    f.setEnabled(true)
    await f.forgedPick(f.top, menuOn(tokenOfTag(load.doc, 'button')))
    expect(f.emit.draftOpened).not.toHaveBeenCalled()
  })
})

describe('PreviewCommentService with comments off', () => {
  it('D refuses reveal, new-on-thread, keep-draft and save, and a pick opens nothing', async () => {
    f = await commentServiceFixture(commentedPage().text)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    await f.pick(f.top, menuOn(tokenOfTag(load.doc, 'button')))
    const draftToken = f.emit.draftOpened.mock.calls[0][1].draftToken as string
    const listed = await f.service.list()
    if (!listed.ok) throw new Error('set-up: the list')
    const threadKey = listed.files[0].threads[0].threadKey
    f.emit.draftOpened.mockClear()

    f.setEnabled(false)
    expect(f.service.reveal(threadKey)).toEqual(REFUSED)
    expect(await f.service.newOnThread(threadKey)).toEqual(REFUSED)
    expect(f.service.keepDraft(draftToken)).toEqual(REFUSED)
    expect(await f.service.save({ panelId: 'html-preview-index', op: 'add', draftToken, text: 'Late' })).toEqual(REFUSED)
    await f.pick(f.top, menuOn(tokenOfTag(load.doc, 'button')))
    expect(f.emit.draftOpened).not.toHaveBeenCalled()

    // Refused, not spent: the draft is still good once comments are back.
    f.setEnabled(true)
    expect(f.service.keepDraft(draftToken)).toEqual({ ok: true })
  })
})

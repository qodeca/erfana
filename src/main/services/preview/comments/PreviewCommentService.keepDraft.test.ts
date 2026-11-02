// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML Preview's draft keep-alive in main (spec 024 C-14.2): an open
 * new-comment window renews its own draft through `preview:commentCommand`
 * `keep-draft`; the store's rules are pinned in `commentKeyStore.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { BASE_PAGE } from './__test-helpers__/commentedPages'
import { commentServiceFixture, type CommentServiceFixture } from './__test-helpers__/commentServiceFixture'
import { tokenOfTag } from './__test-helpers__/commentServiceHarness'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }

let f: CommentServiceFixture | undefined

afterEach(async () => {
  await f?.dispose()
  f = undefined
})

describe('PreviewCommentService keepDraft', () => {
  it('C-14 (HTML) renews a draft this view minted, which still saves; an unknown or spent one is invalid', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    const pick = { kind: 'menu', via: 'pointer', token: tokenOfTag(load.doc, 'button'), tag: 'button', screen: { x: 30, y: 40 }, box: { x: 0, y: 0, w: 40, h: 20 }, view: VIEW }
    await f.pick(f.top, pick)
    const draftToken = f.emit.draftOpened.mock.calls[0][1].draftToken as string
    expect(f.service.keepDraft(draftToken)).toEqual({ ok: true })
    expect(f.service.keepDraft('0'.repeat(32))).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
    expect(await f.service.save({ panelId: 'html-preview-index', op: 'add', draftToken, text: 'Kept alive' })).toMatchObject({ ok: true })
    // The write consumed it: there is nothing left to keep alive.
    expect(f.service.keepDraft(draftToken)).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
  })
})

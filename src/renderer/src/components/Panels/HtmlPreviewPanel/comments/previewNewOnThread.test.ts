// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** "New comment" with no pin's draft, in the HTML Preview (C-22; owner decision, 2026-11-01). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../../shared/errors'
import type { CommentListState } from '../../../../stores/usePreviewCommentStore'
import { commentGateway } from '../../../../services/preview/commentGateway'
import { fileView, thread } from './__test-helpers__/commentTestKit'
import { newOnThreadAction } from './previewNewOnThread'

vi.mock('../../../../services/preview/commentGateway', () => ({ commentGateway: { newOnThread: vi.fn() } }))

const LIST: CommentListState = { status: 'ready', files: [fileView({ threads: [thread(1)] })], generation: 1 }
const ask = vi.mocked(commentGateway.newOnThread)

beforeEach(() => ask.mockReset())

describe('C-22 newOnThreadAction', () => {
  it('C-22 asks main only when pressed, for the thread shown', async () => {
    ask.mockResolvedValue({ ok: true })
    const alert = vi.fn()
    const action = newOnThreadAction('panel', LIST, 't1', alert)
    expect(ask).not.toHaveBeenCalled()
    action?.()
    await vi.waitFor(() => expect(ask).toHaveBeenCalledWith('panel', 't1'))
    expect(alert).not.toHaveBeenCalled()
  })

  it('W-04 a thread the list no longer holds offers none', () => {
    expect(newOnThreadAction('panel', LIST, 't9', vi.fn())).toBeNull()
  })

  it('C-19 a refusal is said, not swallowed', async () => {
    ask.mockResolvedValue({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED })
    const alert = vi.fn()
    newOnThreadAction('panel', LIST, 't1', alert)?.()
    await vi.waitFor(() => expect(alert).toHaveBeenCalledTimes(1))
    expect(alert.mock.calls[0][0]).not.toBe('')
  })
})

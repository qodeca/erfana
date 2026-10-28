// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the panel says when a write answered "still saving" settles
 * (docs/designs/comments/html-preview-comments.md §19 "Save pending settles"; review
 * finding H1).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../../shared/errors'
import type { CommentSaveRequest } from '../../../../../../shared/ipc/preview-comment-schema'
import {
  DRAFT_TOKEN,
  installCommentsBridge,
  newRequest,
  threadsRequest,
  type FakeCommentsBridge
} from './__test-helpers__/commentTestKit'
import { resetCommentPendingWrites, trackCommentWrite } from './commentPendingWrites'
import { draftKeyOf, type CommentWindowRequest } from './commentWindowTypes'
import { useCommentSettleNotices } from './useCommentSettleNotices'

const PANEL = 'preview-index'
const PENDING = { ok: false as const, code: ErrorCode.COMMENT_SAVE_PENDING }
const ADD: CommentSaveRequest = { panelId: PANEL, op: 'add', draftToken: DRAFT_TOKEN, text: 'Hi' }
const RESOLVE: CommentSaveRequest = { panelId: PANEL, op: 'setStatus', status: 'resolved', fileKey: 'f1', threadKey: 't1', rawHash: 'a'.repeat(64) }

describe('useCommentSettleNotices', () => {
  let fake: FakeCommentsBridge
  const announce = vi.fn()
  const alert = vi.fn()
  const closeWindow = vi.fn()
  beforeEach(() => {
    fake = installCommentsBridge()
    vi.clearAllMocks()
  })
  afterEach(() => {
    resetCommentPendingWrites()
    fake.uninstall()
  })

  function mount(request: CommentWindowRequest | null) {
    return renderHook(
      ({ current }) =>
        useCommentSettleNotices({ panelId: PANEL, request: current, pageName: 'index.html', announce, alert, closeWindow }),
      { initialProps: { current: request } }
    )
  }

  /** Sends `save` and has main answer "still saving". */
  function sendPending(save: CommentSaveRequest, draftKey?: string): void {
    trackCommentWrite(save, { file: 'child.html', ...(draftKey === undefined ? {} : { draftKey }) }).answered(PENDING)
  }

  it('a landed comment is announced like an in-time save, and the window that sent it closes', () => {
    const request = newRequest()
    mount(request)
    sendPending(ADD, draftKeyOf(request))
    act(() => fake.emitSettled({ panelId: PANEL, op: 'add', draftToken: DRAFT_TOKEN, ok: true }))
    expect(announce).toHaveBeenCalledExactlyOnceWith('Comment saved to child.html.')
    expect(closeWindow).toHaveBeenCalledTimes(1)
    expect(alert).not.toHaveBeenCalled()
  })

  it('a landed write leaves another window open, and still announces', () => {
    mount(threadsRequest({ threadKeys: ['t7'] }))
    sendPending(RESOLVE)
    act(() => fake.emitSettled({ panelId: PANEL, op: 'setStatus', threadKey: 't1', ok: true }))
    expect(announce).toHaveBeenCalledExactlyOnceWith('Comment resolved.')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  it('a refusal with no window showing it is said from the panel – the text waits in the drafts', () => {
    mount(null)
    sendPending(ADD, draftKeyOf(newRequest()))
    act(() =>
      fake.emitSettled({ panelId: PANEL, op: 'add', draftToken: DRAFT_TOKEN, ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })
    )
    expect(alert).toHaveBeenCalledExactlyOnceWith("Couldn't save the comment. Your text is still here – try again.")
    expect(announce).not.toHaveBeenCalled()
    expect(closeWindow).not.toHaveBeenCalled()
  })

  it('a refusal the open window shows is left to that window to word', () => {
    const request = newRequest()
    const panel = mount(request)
    sendPending(ADD, draftKeyOf(request))
    act(() =>
      fake.emitSettled({ panelId: PANEL, op: 'add', draftToken: DRAFT_TOKEN, ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })
    )
    panel.rerender({ current: threadsRequest() })
    sendPending(RESOLVE)
    act(() =>
      fake.emitSettled({ panelId: PANEL, op: 'setStatus', threadKey: 't1', ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED })
    )
    expect(alert).not.toHaveBeenCalled()
  })

  it('another panel\'s write is not this panel\'s news', () => {
    mount(null)
    sendPending({ ...ADD, panelId: 'preview-other' })
    act(() => fake.emitSettled({ panelId: 'preview-other', op: 'add', draftToken: DRAFT_TOKEN, ok: true }))
    expect(announce).not.toHaveBeenCalled()
  })
})

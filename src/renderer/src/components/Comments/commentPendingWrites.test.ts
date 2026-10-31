// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The writes still waiting for main to say how they ended
 * (docs/designs/comments/html-preview-comments.md §8 Rev 3 note, §19 "Save pending
 * settles"; review finding H1).
 */
import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import type { CommentSaveRequest } from '../../../../shared/ipc/preview-comment-schema'
import { commentDrafts } from '../../stores/usePreviewCommentStore'
import { DRAFT_TOKEN, installCommentsBridge, type FakeCommentsBridge } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import {
  PENDING_WRITE_MAX_MS,
  isCommentWritePending,
  onCommentWriteSettled,
  resetCommentPendingWrites,
  trackCommentWrite,
  useCommentWritePending,
  writeKeyOf
} from './commentPendingWrites'

const PANEL = 'preview-index'
const PENDING = { ok: false as const, code: ErrorCode.COMMENT_SAVE_PENDING }
const ADD: CommentSaveRequest = { panelId: PANEL, op: 'add', draftToken: DRAFT_TOKEN, text: 'Hi' }
const REPLY: CommentSaveRequest = { panelId: PANEL, op: 'reply', fileKey: 'f1', threadKey: 't1', rawHash: 'a'.repeat(64), text: 'Re' }
const DRAFT_KEY = 'new|preview-index|' + 'd'.repeat(32)

describe('commentPendingWrites', () => {
  let fake: FakeCommentsBridge
  beforeEach(() => {
    fake = installCommentsBridge()
  })
  afterEach(() => {
    resetCommentPendingWrites()
    commentDrafts.reset()
    fake.uninstall()
    vi.useRealTimers()
  })

  it('names a write by the key main names it by', () => {
    expect(writeKeyOf(ADD)).toBe(DRAFT_TOKEN)
    expect(writeKeyOf(REPLY)).toBe('t1')
    expect(writeKeyOf({ panelId: PANEL, op: 'deleteBlock', fileKey: 'f1', blockKey: 'b1', rawHash: 'a'.repeat(64) })).toBe('b1')
  })

  it('a write answered in time ends at its answer: released once, no longer pending, nothing heard', () => {
    const release = vi.fn()
    const write = trackCommentWrite(ADD, { file: 'index.html', draftKey: DRAFT_KEY, release })
    // Outstanding from the send on – by its token and by its session draft.
    expect(isCommentWritePending(PANEL, DRAFT_TOKEN)).toBe(true)
    expect(isCommentWritePending(PANEL, DRAFT_KEY)).toBe(true)
    expect(isCommentWritePending(PANEL, DRAFT_TOKEN, true)).toBe(false)
    expect(isCommentWritePending('other-panel', DRAFT_TOKEN)).toBe(false)
    write.answered({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED })
    write.answered({ ok: true, threadKey: 't9' })
    expect(release).toHaveBeenCalledTimes(1)
    expect(isCommentWritePending(PANEL, DRAFT_TOKEN)).toBe(false)
  })

  it('H1 a pending answer keeps the hold until main says the write landed – then clears the draft and tells the listeners', () => {
    const release = vi.fn()
    const heard = vi.fn()
    const off = onCommentWriteSettled(heard)
    commentDrafts.set(DRAFT_KEY, 'Hi')
    trackCommentWrite(ADD, { file: 'index.html', draftKey: DRAFT_KEY, release }).answered(PENDING)
    expect(release).not.toHaveBeenCalled()
    expect(isCommentWritePending(PANEL, DRAFT_TOKEN, true)).toBe(true)

    // Another panel's write, another op or another key: not this one.
    fake.emitSettled({ panelId: 'other', op: 'add', draftToken: DRAFT_TOKEN, ok: true })
    fake.emitSettled({ panelId: PANEL, op: 'reply', threadKey: DRAFT_TOKEN, ok: true })
    fake.emitSettled({ panelId: PANEL, op: 'add', draftToken: 'f'.repeat(32), ok: true })
    expect(release).not.toHaveBeenCalled()

    fake.emitSettled({ panelId: PANEL, op: 'add', draftToken: DRAFT_TOKEN, ok: true })
    expect(release).toHaveBeenCalledTimes(1)
    expect(isCommentWritePending(PANEL, DRAFT_KEY)).toBe(false)
    expect(commentDrafts.get(DRAFT_KEY)).toBe('')
    expect(heard).toHaveBeenCalledExactlyOnceWith({
      event: { panelId: PANEL, op: 'add', draftToken: DRAFT_TOKEN, ok: true },
      request: ADD,
      file: 'index.html',
      draftKey: DRAFT_KEY
    })
    off()
  })

  it('H1 a pending write that is refused after all releases the hold and keeps the typed text', () => {
    const release = vi.fn()
    const heard = vi.fn()
    onCommentWriteSettled(heard)
    commentDrafts.set('reply|draft', 'Re')
    trackCommentWrite(REPLY, { file: 'index.html', draftKey: 'reply|draft', release }).answered(PENDING)
    fake.emitSettled({ panelId: PANEL, op: 'reply', threadKey: 't1', ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED })
    expect(release).toHaveBeenCalledTimes(1)
    expect(commentDrafts.get('reply|draft')).toBe('Re')
    expect(heard.mock.calls[0][0].event).toMatchObject({ ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED })
    // Settled once: a repeat of the event finds nothing.
    fake.emitSettled({ panelId: PANEL, op: 'reply', threadKey: 't1', ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED })
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('listens to main only while a write is tracked', () => {
    expect(fake.bridge.onSaveSettled).not.toHaveBeenCalled()
    const first = trackCommentWrite(ADD, { file: 'index.html' })
    const second = trackCommentWrite(REPLY, { file: 'index.html' })
    expect(fake.bridge.onSaveSettled).toHaveBeenCalledTimes(1)
    first.answered({ ok: true, threadKey: 't9' })
    second.answered(PENDING)
    fake.emitSettled({ panelId: PANEL, op: 'reply', threadKey: 't1', ok: true })
    // Nothing tracked: a late event has no listener left to reach.
    const heard = vi.fn()
    onCommentWriteSettled(heard)
    fake.emitSettled({ panelId: PANEL, op: 'reply', threadKey: 't1', ok: true })
    expect(heard).not.toHaveBeenCalled()
  })

  it('a settle that never comes lets the hold go after the safety limit', () => {
    vi.useFakeTimers()
    const release = vi.fn()
    trackCommentWrite(ADD, { file: 'index.html', release }).answered(PENDING)
    vi.advanceTimersByTime(PENDING_WRITE_MAX_MS - 1)
    expect(release).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(isCommentWritePending(PANEL, DRAFT_TOKEN)).toBe(false)
  })

  it('useCommentWritePending follows the write', () => {
    const { result } = renderHook(() => useCommentWritePending(PANEL, 't1'))
    expect(result.current).toBe(false)
    let write!: ReturnType<typeof trackCommentWrite>
    act(() => {
      write = trackCommentWrite(REPLY, { file: 'index.html' })
    })
    expect(result.current).toBe(true)
    act(() => write.answered(PENDING))
    expect(result.current).toBe(true)
    act(() => fake.emitSettled({ panelId: PANEL, op: 'reply', threadKey: 't1', ok: true }))
    expect(result.current).toBe(false)
    expect(renderHook(() => useCommentWritePending(PANEL, undefined)).result.current).toBe(false)
  })
})

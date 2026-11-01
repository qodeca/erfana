// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the shared window rules (`overlay.suite.ts`) leave to one host: the
 * rarer writes behind the identity step, the identity refusal from main, and
 * unsaved edits in a new comment and a thread (024-FR-015, 024-FR-022; P-F01,
 * P-F02, P-F06). No test here uses the mouse.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import type { CommentSaveResult } from '../../../../shared/ipc/preview-comment-schema'
import type { CommentDirtyGuard } from '../../hooks/useCommentDirtyGuard'
import { commentDrafts, type CommentListState } from '../../stores/usePreviewCommentStore'

const guard = vi.hoisted(() => ({ current: null as unknown as CommentDirtyGuard }))
vi.mock('../../hooks/useCommentDirtyGuard', () => ({ useCommentDirtyGuard: () => guard.current }))

import { damaged, fileView, newRequest, thread, threadsRequest } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { MARKDOWN_WORDS } from './commentCopyWords'
import { CommentWindow, type CommentWindowProps } from './CommentWindow'
import { resetCommentPendingWrites } from './commentPendingWrites'
import { CommentWordsContext } from './commentWords'

const READY = { authorName: 'Ada', identityNoticeSeen: true }
const ready = (files: CommentListState['files']): CommentListState => ({ status: 'ready', files, generation: 1 })
const ELSEWHERE = 'index.html has unsaved changes in another window – save it there, then try again.'

function setup(patch: Partial<CommentWindowProps> = {}, markdown = false) {
  const props: CommentWindowProps = {
    request: threadsRequest({ listAfter: 1 }),
    list: ready([fileView({ threads: [thread(1)] })]),
    identity: null,
    notVisible: [],
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    onClose: vi.fn(),
    onSaveIdentity: vi.fn(async () => true),
    onSave: vi.fn(async (): Promise<CommentSaveResult> => ({ ok: true, threadKey: 't1' })),
    onWritten: vi.fn(),
    onRefresh: vi.fn(),
    onPickAgain: vi.fn(),
    onOpenInSource: vi.fn(),
    onCopyRaw: vi.fn(),
    ...patch
  }
  const tree = (next: CommentWindowProps): React.JSX.Element =>
    markdown ? (
      <CommentWordsContext.Provider value={MARKDOWN_WORDS}>
        <CommentWindow {...next} modal={false} />
      </CommentWordsContext.Provider>
    ) : (
      <CommentWindow {...next} />
    )
  const view = render(tree(props))
  return { props, again: (next: Partial<CommentWindowProps>) => view.rerender(tree({ ...props, ...next })) }
}

/** Press the button with the keyboard. */
async function press(user: ReturnType<typeof userEvent.setup>, testId: string): Promise<void> {
  act(() => screen.getByTestId(testId).focus())
  await user.keyboard('{Enter}')
}

/** Answer the identity step. */
async function answer(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const name = screen.getByTestId('comment-identity-name')
  await waitFor(() => expect(name).toHaveFocus())
  await user.keyboard('Grace')
  await press(user, 'comment-identity-continue')
}

describe('CommentWindow – a first write, and unsaved edits', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    guard.current = { state: 'clean', justSaved: false, cleared: null, goToTab: vi.fn(), save: vi.fn(async () => true), holdForWrite: () => () => {} }
  })
  afterEach(() => {
    cleanup()
    portalRoot.remove()
    commentDrafts.reset()
    resetCommentPendingWrites()
  })

  it('P-F01 Re-open waits for the name too, then re-opens', async () => {
    const user = userEvent.setup()
    const { props } = setup({ list: ready([fileView({ threads: [thread(1, { status: 'resolved' })] })]) })
    await press(user, 'comment-reopen')
    await waitFor(() => expect(screen.getByTestId('comment-window')).toHaveAttribute('data-view', 'identity'))
    await answer(user)
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'setStatus', status: 'open' })))
  })

  it('P-F01 Mark resolved waits for the name, then finishes; Keep open writes no name and does not ask', async () => {
    const user = userEvent.setup()
    const block = damaged(1, { reason: 'readable-mismatch', rebuild: { lines: [{ file: 'status: resolved', data: 'status: open' }], claims: 'resolved' } })
    const list = ready([fileView({ damaged: [block] })])
    const { props } = setup({ list, request: threadsRequest({ threadKeys: [], blockKeys: [block.blockKey], listAfter: 1 }) })
    await press(user, 'comment-rebuild')
    await press(user, 'comment-rebuild-keep-open')
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    expect(props.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'rebuildBlock', status: 'open' }))
    await press(user, 'comment-rebuild')
    await press(user, 'comment-rebuild-mark-resolved')
    await waitFor(() => expect(screen.getByTestId('comment-window')).toHaveAttribute('data-view', 'identity'))
    await answer(user)
    await waitFor(() => expect(props.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'rebuildBlock', status: 'resolved' })))
  })

  it('P-F01 main still wants a name: no dead-end error – the step, then the same write again', async () => {
    const user = userEvent.setup()
    const onSave = vi
      .fn<CommentWindowProps['onSave']>()
      .mockResolvedValueOnce({ ok: false, code: ErrorCode.COMMENT_IDENTITY_REQUIRED })
      .mockResolvedValueOnce({ ok: true, threadKey: 't1' })
    setup({ identity: READY, onSave })
    await press(user, 'comment-resolve')
    await waitFor(() => expect(screen.getByTestId('comment-window')).toHaveAttribute('data-view', 'identity'))
    expect(screen.queryByTestId('comment-save-error')).toBeNull()
    await answer(user)
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
  })

  it('P-F01 a window closed at the step sends nothing', async () => {
    const user = userEvent.setup()
    const { props } = setup()
    await press(user, 'comment-resolve')
    cleanup()
    await act(async () => {})
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('P-F06 Go to tab in a thread closes the window first, then goes to the edits', async () => {
    const user = userEvent.setup()
    guard.current = { ...guard.current, state: 'dirty' }
    const { props } = setup({ identity: READY })
    await press(user, 'comment-unsaved-go-to-tab')
    expect(props.onClose).toHaveBeenCalledWith(false)
    expect(guard.current.goToTab).toHaveBeenCalled()
  })

  it('P-F06 a host way to the edits is used instead of Go to tab', async () => {
    const user = userEvent.setup()
    guard.current = { ...guard.current, state: 'dirty' }
    const onGoToUnsaved = vi.fn()
    setup({ identity: READY, onGoToUnsaved })
    await press(user, 'comment-unsaved-go-to-tab')
    expect(onGoToUnsaved).toHaveBeenCalled()
    expect(guard.current.goToTab).not.toHaveBeenCalled()
  })

  it('P-F06 saved: the reply box comes back with the typed text, and focus is in the window', async () => {
    const user = userEvent.setup()
    commentDrafts.set('reply|preview-index|f1|t1', 'Kept')
    guard.current = { ...guard.current, state: 'dirty' }
    const { again } = setup({ identity: READY })
    expect(screen.queryByTestId('comment-reply-field')).toBeNull()
    await press(user, 'comment-unsaved-save')
    guard.current = { ...guard.current, state: 'clean', justSaved: true }
    again({})
    expect(screen.getByTestId('comment-window').contains(document.activeElement)).toBe(true)
    expect(screen.getByTestId('comment-reply-field')).toBeVisible()
  })

  it('P-F06 a damaged block offers no delete while paused', () => {
    guard.current = { ...guard.current, state: 'dirty' }
    const block = damaged(1, { reason: 'bad-json' })
    setup({ identity: READY, list: ready([fileView({ damaged: [block] })]), request: threadsRequest({ threadKeys: [], blockKeys: [block.blockKey], listAfter: 1 }) })
    expect(screen.queryByTestId('comment-delete-block')).toBeNull()
  })

  it('P-F02 (Markdown) a new comment refused for another window: one sentence, no dead buttons, Save still tries again', async () => {
    const user = userEvent.setup()
    const onSave = vi
      .fn<CommentWindowProps['onSave']>()
      .mockResolvedValueOnce({ ok: false, code: ErrorCode.COMMENT_UNSAVED_SOURCE })
      .mockResolvedValueOnce({ ok: true, threadKey: 't1' })
    setup({ identity: READY, request: newRequest(), onSave }, true)
    const field = screen.getByTestId('comment-new-field')
    await waitFor(() => expect(field).toHaveFocus())
    await user.keyboard('Text{Control>}{Enter}{/Control}')
    expect(await screen.findByTestId('comment-unsaved-banner')).toHaveTextContent(ELSEWHERE)
    expect(screen.queryByTestId('comment-unsaved-save')).toBeNull()
    expect(screen.queryByTestId('comment-unsaved-go-to-tab')).toBeNull()
    expect(screen.getByTestId('comment-save')).not.toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('comment-unsaved-banner')).toBeNull()
  })
})

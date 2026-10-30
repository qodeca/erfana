// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment window – second-review findings (comments-v2 C-07, C-13; spec
 * 024 024-FR-004, 024-NFR-006):
 *
 * - **M-B** "Resolve and next" announces where it landed counting the
 *   resolved comment as resolved: the file view still lists it open until
 *   the re-list, which said "Comment 2 of 3" when 2 remained.
 * - **M-C** an edit of the text alone is never blocked by the stored words:
 *   the blank/tie check is for a range the reader moved.
 * - **M-D** a re-list that changes the stored words during an open edit puts
 *   the Narrow to words range back on the new words: the old offsets would
 *   name other characters of the new text.
 * - **L-4** Alt+F9 from the preview is taken by the window only when it
 *   stepped, and only in the threads view; otherwise it goes on to the host.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentFileView, CommentSaveResult, CommentThreadView } from '../../../../shared/ipc/preview-comment-schema'
import { commentDrafts, type CommentListState } from '../../stores/usePreviewCommentStore'
import { TEST_IDS } from '../../constants/testids'
import { fileView, newRequest, thread, threadsRequest } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { COPY } from './commentCopy'
import { HTML_WORDS } from './commentCopyWords'
import { CommentWindow, type CommentWindowProps } from './CommentWindow'
import { resetCommentPendingWrites } from './commentPendingWrites'
import { resetCommentStepKeys, stepOpenWindow } from './commentStepKeys'
import { WINDOW_COPY } from './commentWindowCopy'

const TEXT = 'We ship the beta to ten customers by Friday.'
const ready = (files: CommentFileView[]): CommentListState => ({ status: 'ready', files, generation: 1 })

function propsOf(patch: Partial<CommentWindowProps>): CommentWindowProps {
  return {
    request: threadsRequest(),
    list: ready([fileView({ threads: [thread(1)] })]),
    identity: { authorName: 'Ada', identityNoticeSeen: true },
    notVisible: [],
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    now: () => new Date(2026, 9, 26, 12, 0),
    locale: 'en-GB',
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
}

function setup(patch: Partial<CommentWindowProps> = {}) {
  const props = propsOf(patch)
  const view = render(<CommentWindow {...props} />)
  return { props, rerenderWith: (next: Partial<CommentWindowProps>) => view.rerender(<CommentWindow {...props} {...next} />) }
}

/** A file whose first thread's first message carries `words`. */
const withWords = (words: CommentThreadView['words']): CommentFileView => fileView({ threads: [thread(1, { words })] })

async function openEdit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getAllByTestId(TEST_IDS.COMMENT_MESSAGE_ACTIONS)[0])
  await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
}

async function narrow(user: ReturnType<typeof userEvent.setup>, start: number, end: number): Promise<void> {
  await user.click(screen.getByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE))
  const field = screen.getByTestId(TEST_IDS.COMMENT_NARROW_FIELD) as HTMLTextAreaElement
  act(() => {
    field.setSelectionRange(start, end)
    fireEvent.select(field)
  })
}

describe('CommentWindow – second-review findings', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })
  afterEach(() => {
    portalRoot.remove()
    commentDrafts.reset()
    resetCommentPendingWrites()
    resetCommentStepKeys()
  })

  it('024-AC-029 M-B Resolve and next announces the position without the comment it resolved', async () => {
    const user = userEvent.setup()
    const file = fileView({ threads: [thread(1), thread(2), thread(3)] })
    setup({ list: ready([file]), onReveal: vi.fn() })
    await user.click(screen.getByTestId('comment-resolve-next'))
    // t1 resolved: t2 is the first of the two left open.
    const said = WINDOW_COPY.stepAnnounce(1, 2, HTML_WORDS.noun(thread(2)), thread(2).line)
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_WINDOW_POLITE)).toHaveTextContent(said))
  })

  it('024-AC-004 M-C stored words the field would call blank do not block an edit of the text alone', async () => {
    const user = userEvent.setup()
    // The stored range is the space after "We": as stored, never chosen here.
    const { props } = setup({ list: ready([withWords({ text: TEXT, start: 2, end: 3, cut: false })]) })
    await openEdit(user)
    await user.type(screen.getByTestId(TEST_IDS.COMMENT_EDIT_FIELD), '!')
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_EDIT_SAVE))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    expect(props.onSave).toHaveBeenCalledWith(expect.not.objectContaining({ sel: expect.anything() }))
  })

  it('024-AC-004 M-C a range the reader moved onto blanks still waits, and says why', async () => {
    const user = userEvent.setup()
    const { props } = setup({ list: ready([withWords({ text: TEXT, start: 0, end: 0, cut: false })]) })
    await openEdit(user)
    await narrow(user, 2, 3)
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_EDIT_SAVE))
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('024-AC-004 M-D a re-list that changes the stored words during an edit puts the range back on them: no stale offsets are sent', async () => {
    const user = userEvent.setup()
    const { props, rerenderWith } = setup({ list: ready([withWords({ text: TEXT, start: 0, end: 0, cut: false })]) })
    await openEdit(user)
    await narrow(user, 20, 33)
    // Another window rewrote the target: same thread, new text, no stored words.
    rerenderWith({ list: ready([withWords({ text: 'Ship it on Monday after the review.', start: 0, end: 0, cut: false })]) })
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_EDIT_SAVE))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    // Offsets 20–33 of the new text ("after the rev") are never sent as the words.
    expect(props.onSave).toHaveBeenCalledWith(expect.not.objectContaining({ sel: expect.anything() }))
  })

  it('024-AC-029 L-4 with nothing to step to, Alt+F9 from the preview is not swallowed by the window', () => {
    setup({ drawerId: 'drawer-l4' })
    act(() => {
      expect(stepOpenWindow('drawer-l4', 'next')).toBe(false)
    })
  })

  it('024-AC-029 L-4 a new-comment window takes no step from the preview', () => {
    setup({ request: newRequest(), drawerId: 'drawer-new' })
    act(() => {
      expect(stepOpenWindow('drawer-new', 'next')).toBe(false)
    })
  })

  it('024-AC-029 L-4 a threads window with a next comment still takes the step', () => {
    const { props } = setup({ list: ready([fileView({ threads: [thread(1), thread(2)] })]), onReveal: vi.fn(), drawerId: 'drawer-two' })
    act(() => {
      expect(stepOpenWindow('drawer-two', 'next')).toBe(true)
    })
    expect(props.onReveal).toHaveBeenLastCalledWith('t2')
  })
})

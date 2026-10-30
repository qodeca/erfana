// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words of a new comment in the shared window (spec 024 024-FR-004;
 * comments-v2 C-07 "Narrow to words", C-21 clamped quote): the quote, the
 * notices, the field and what Save sends. Split from CommentWindow.test.tsx
 * because the dirty-guard mock hoists to module scope.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentSaveResult } from '../../../../shared/ipc/preview-comment-schema'
import { INITIAL_PANEL_COMMENT_STATE, commentDrafts } from '../../stores/usePreviewCommentStore'
import { useOverlayOccluderStore } from '../../stores/useOverlayOccluderStore'
import type { CommentDirtyGuard } from '../../hooks/useCommentDirtyGuard'
import { TEST_IDS } from '../../constants/testids'

vi.mock('../../hooks/useCommentDirtyGuard', () => ({
  useCommentDirtyGuard: (): CommentDirtyGuard => ({
    state: 'clean',
    justSaved: false,
    cleared: null,
    goToTab: () => {},
    save: async () => true,
    holdForWrite: () => () => {}
  })
}))

import { newRequest } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { SELECTION_COPY } from './commentCopyWords'
import { CommentWindow, type CommentWindowProps } from './CommentWindow'
import { resetCommentPendingWrites } from './commentPendingWrites'
import type { NewCommentWords } from './commentWindowTypes'

const TEXT = 'We ship the beta to ten customers by Friday.'

function setup(words: NewCommentWords | undefined, extra: { readonly wordsMissing?: true } = {}) {
  const onSave = vi.fn(async (): Promise<CommentSaveResult> => ({ ok: true, threadKey: 't1' }))
  const props: CommentWindowProps = {
    request: { ...newRequest(), ...(words === undefined ? {} : { words }), ...extra },
    list: INITIAL_PANEL_COMMENT_STATE.list,
    identity: { authorName: 'Ada', identityNoticeSeen: true },
    notVisible: [],
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    onClose: vi.fn(),
    onSaveIdentity: vi.fn(async () => true),
    onSave,
    onWritten: vi.fn(),
    onRefresh: vi.fn(),
    onPickAgain: vi.fn(),
    onOpenInSource: vi.fn(),
    onCopyRaw: vi.fn()
  }
  render(<CommentWindow {...props} />)
  return onSave
}

async function type(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByTestId('comment-new-field'), 'A note')
}

describe('CommentWindow – the words of a new comment', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
    useOverlayOccluderStore.getState().reset()
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })
  afterEach(() => {
    portalRoot.remove()
    commentDrafts.reset()
    resetCommentPendingWrites()
  })

  it('024-AC-004 (g) words not in the file as written: the window itself says the comment is on the whole element', () => {
    setup({ text: TEXT, start: 0, end: 0, cut: false }, { wordsMissing: true })
    expect(screen.getByTestId(TEST_IDS.COMMENT_WORDS_MISSING)).toHaveTextContent(SELECTION_COPY.wordsNotInFile('index.html'))
  })

  it('024-AC-005: without words from the preview there is no quote and no field – the shipped HTML window', () => {
    setup(undefined)
    expect(screen.queryByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE)).toBeNull()
    expect(screen.queryByTestId(TEST_IDS.COMMENT_WORDS)).toBeNull()
  })

  it('024-AC-005: a target with no text (an image, a divider) offers no Narrow to words', () => {
    setup({ text: '', start: 0, end: 0, cut: false })
    expect(screen.queryByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE)).toBeNull()
  })

  it('024-AC-005: Narrow to words opens with the mouse selection selected, and Whole {kind} clears it to a comment on the whole target', async () => {
    const user = userEvent.setup()
    const onSave = setup({ text: TEXT, start: 8, end: 16, cut: false })
    expect(screen.getByTestId(TEST_IDS.COMMENT_WORDS)).toHaveTextContent(SELECTION_COPY.result('the beta'))
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE))
    const field = screen.getByTestId(TEST_IDS.COMMENT_NARROW_FIELD) as HTMLTextAreaElement
    expect([field.selectionStart, field.selectionEnd]).toEqual([8, 16])
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_NARROW_WHOLE))
    expect(screen.queryByTestId(TEST_IDS.COMMENT_WORDS)).toBeNull()
    await type(user)
    await user.click(screen.getByTestId('comment-save'))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]).toHaveLength(1)
  })

  it('024-AC-005: only spaces chosen in the field is refused – Save waits and the notice says why', async () => {
    const user = userEvent.setup()
    const onSave = setup({ text: TEXT, start: 0, end: 0, cut: false })
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE))
    const field = screen.getByTestId(TEST_IDS.COMMENT_NARROW_FIELD) as HTMLTextAreaElement
    act(() => {
      field.setSelectionRange(2, 3)
      fireEvent.select(field)
    })
    expect(screen.getByText(SELECTION_COPY.blank('element'))).toBeVisible()
    await type(user)
    await user.click(screen.getByTestId('comment-save'))
    expect(screen.getByTestId('comment-save')).toHaveAttribute('aria-disabled', 'true')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('024-AC-005: words that appear twice with the same context are a tie – the window offers the whole target', async () => {
    const user = userEvent.setup()
    const half = `${'x'.repeat(40)} the ${'y'.repeat(40)}`
    const text = `${half} ${half}`
    const at = text.indexOf(' the ') + 1
    const onSave = setup({ text, start: at, end: at + 3, cut: false })
    expect(screen.getByText(SELECTION_COPY.tie('element'), { exact: false })).toBeVisible()
    await type(user)
    await user.click(screen.getByTestId('comment-save'))
    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_WORDS_WHOLE))
    await user.click(screen.getByTestId('comment-save'))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]).toHaveLength(1)
  })

  it('024-AC-005: a long quote is clamped with Show all; the 200-character notice stays outside it', async () => {
    const user = userEvent.setup()
    const long = `Start ${'word '.repeat(60)}end.`
    setup({ text: long, start: 6, end: long.length - 1, cut: false })
    const quote = screen.getByTestId(TEST_IDS.COMMENT_WORDS)
    expect(quote).not.toHaveClass('erf-comment-words--open')
    await user.click(screen.getByRole('button', { name: SELECTION_COPY.showAll }))
    expect(quote).toHaveClass('erf-comment-words--open')
    const notice = screen.getByText(SELECTION_COPY.cut(200))
    expect(quote).not.toContainElement(notice)
  })
})

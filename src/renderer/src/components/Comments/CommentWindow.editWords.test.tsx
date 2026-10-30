// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Narrow to words on Edit of a thread's first message (comments-v2 C-07 "Add
 * a field to the new-comment window, and to Edit on a thread's first
 * message"; spec 024 024-FR-004, D-16). The field shows the target's text main
 * sent with the thread, opens on the stored words, and Save sends `sel` only
 * when the range moved – the words chosen, or `null` for the whole target.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentFileView, CommentSaveResult, CommentThreadView } from '../../../../shared/ipc/preview-comment-schema'
import { commentDrafts, type CommentListState } from '../../stores/usePreviewCommentStore'
import { TEST_IDS } from '../../constants/testids'
import { fileView, message, thread, threadsRequest } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { COPY } from './commentCopy'
import { MARKDOWN_WORDS, SELECTION_COPY } from './commentCopyWords'
import { CommentWindow, type CommentWindowProps } from './CommentWindow'
import { CommentWordsContext } from './commentWords'
import { resetCommentPendingWrites } from './commentPendingWrites'

const TEXT = 'We ship the beta to ten customers by Friday.'
const ready = (files: CommentFileView[]): CommentListState => ({ status: 'ready', files, generation: 1 })
const target = { panelId: 'preview-index', fileKey: 'f1', threadKey: 't1', rawHash: thread(1).rawHash }

function setup(patch: Partial<CommentThreadView> = {}, answer: CommentSaveResult = { ok: true, threadKey: 't1' }, markdown = false) {
  const shown = thread(1, { words: { text: TEXT, start: 0, end: 0, cut: false }, ...patch })
  const props: CommentWindowProps = {
    request: threadsRequest(),
    list: ready([fileView({ threads: [shown] })]),
    identity: { authorName: 'Ada', identityNoticeSeen: true },
    notVisible: [],
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    now: () => new Date(2026, 9, 26, 12, 0),
    locale: 'en-GB',
    onClose: vi.fn(),
    onSaveIdentity: vi.fn(async () => true),
    onSave: vi.fn(async (): Promise<CommentSaveResult> => answer),
    onWritten: vi.fn(),
    onRefresh: vi.fn(),
    onPickAgain: vi.fn(),
    onOpenInSource: vi.fn(),
    onCopyRaw: vi.fn()
  }
  const window = <CommentWindow {...props} />
  render(markdown ? <CommentWordsContext.Provider value={MARKDOWN_WORDS}>{window}</CommentWordsContext.Provider> : window)
  return props
}

async function openEdit(user: ReturnType<typeof userEvent.setup>, index = 0): Promise<void> {
  await user.click(screen.getAllByTestId(TEST_IDS.COMMENT_MESSAGE_ACTIONS)[index])
  await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
}

/** Opens the Narrow to words field and selects `[start, end)` in it. */
async function narrow(user: ReturnType<typeof userEvent.setup>, start: number, end: number): Promise<HTMLTextAreaElement> {
  await user.click(screen.getByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE))
  const field = screen.getByTestId(TEST_IDS.COMMENT_NARROW_FIELD) as HTMLTextAreaElement
  act(() => {
    field.setSelectionRange(start, end)
    fireEvent.select(field)
  })
  return field
}

describe('024-AC-004 C-07 Narrow to words on Edit of the first message', () => {
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
  })

  it('024-AC-004 C-07 the field holds the target\'s text; selecting words sends them as sel', async () => {
    const user = userEvent.setup()
    const props = setup()
    await openEdit(user)
    const field = await narrow(user, 20, 33)
    expect(field).toHaveValue(TEXT)
    expect(field).toHaveAttribute('readonly')
    expect(screen.getByTestId(TEST_IDS.COMMENT_NARROW_RESULT)).toHaveTextContent(SELECTION_COPY.result('ten customers'))
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_EDIT_SAVE))
    expect(props.onSave).toHaveBeenCalledWith({
      ...target,
      op: 'editMessage',
      messageId: thread(1).messages[0].id,
      text: 'Message 1',
      sel: { exact: 'ten customers', prefix: 'We ship the beta to ', suffix: ' by Friday.' }
    })
  })

  it('024-AC-004 C-07 an edit that leaves the range as stored sends no sel – what the window always sent', async () => {
    const user = userEvent.setup()
    const props = setup({ words: { text: TEXT, start: 20, end: 33, cut: false } })
    await openEdit(user)
    expect(screen.getByTestId(TEST_IDS.COMMENT_WORDS)).toHaveTextContent(SELECTION_COPY.result('ten customers'))
    await user.type(screen.getByTestId(TEST_IDS.COMMENT_EDIT_FIELD), '!')
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_EDIT_SAVE))
    expect(props.onSave).toHaveBeenCalledWith({ ...target, op: 'editMessage', messageId: thread(1).messages[0].id, text: 'Message 1!' })
  })

  it('024-AC-004 C-07 Whole {kind} clears the stored words: sel is null', async () => {
    const user = userEvent.setup()
    const props = setup({ words: { text: TEXT, start: 20, end: 33, cut: false } })
    await openEdit(user)
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE))
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_NARROW_WHOLE))
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_EDIT_SAVE))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'editMessage', sel: null }))
  })

  it('024-AC-004 C-07 only spaces selected: Save waits and the window says why', async () => {
    const user = userEvent.setup()
    const props = setup()
    await openEdit(user)
    await narrow(user, 2, 3)
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_EDIT_SAVE))
    expect(props.onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId(TEST_IDS.COMMENT_WORDS_NOTICE)).toHaveTextContent(SELECTION_COPY.blank('element'))
  })

  it('024-AC-004 C-07 a reply, or a thread main sent no text for, has no field', async () => {
    const user = userEvent.setup()
    setup({ messages: [message(1), message(2)] })
    await openEdit(user, 1)
    expect(screen.queryByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE)).toBeNull()
  })

  it('024-AC-004 C-07 D-16 main kept the edit but not its words: an info note says the comment is about the whole target', async () => {
    const user = userEvent.setup()
    setup({}, { ok: true, threadKey: 't1', wordsDropped: true })
    await openEdit(user)
    await narrow(user, 20, 33)
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_EDIT_SAVE))
    expect(await screen.findByTestId(TEST_IDS.COMMENT_SAVE_ERROR)).toHaveTextContent(SELECTION_COPY.wordsNotInFile('element', 'index.html'))
    // useLiveText empties the region, then sets the sentence a frame later: wait for it.
    await waitFor(() =>
      expect(screen.getByTestId(TEST_IDS.COMMENT_WINDOW_POLITE)).toHaveTextContent(SELECTION_COPY.wordsNotInFile('element', 'index.html'))
    )
  })

  it('024-AC-005 C-07 C-03 in Markdown the field is labelled with the target\'s noun from its place', async () => {
    const user = userEvent.setup()
    setup({ tag: 'table', classes: [], line: 5, runtime: { tag: 'td', path: 'tbody > tr:nth-of-type(2) > td:nth-of-type(3)' }, place: { kind: 'cell', row: 2, column: 3 } }, undefined, true)
    expect(screen.getByTestId('comment-window-title')).toHaveTextContent('Comment on row 2, column 3')
    await openEdit(user)
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE))
    expect(screen.getByLabelText(SELECTION_COPY.narrowLabel('row 2, column 3', 5))).toBeVisible()
  })
})

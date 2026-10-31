// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment window's threads view
 * (docs/designs/comments/html-preview-comments.md §7.7, §10.4; R-004, R-005, R-006,
 * R-013, R-017, SEC-19).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import {
  CommentAnchorStatusSchema,
  CommentDraftOpenedSchema,
  CommentsChangedSchema,
  type CommentFileView,
  type CommentSaveResult
} from '../../../../shared/ipc/preview-comment-schema'
import { commentDrafts, type CommentListState } from '../../stores/usePreviewCommentStore'
import {
  damaged,
  fileView,
  installCommentsBridge,
  message,
  thread,
  threadsRequest,
  type FakeCommentsBridge
} from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { COPY } from './commentCopy'
import { HTML_WORDS } from './commentCopyWords'
import { CommentWindow, type CommentWindowProps } from './CommentWindow'
import { newCommentFrom } from './commentWindowHeading'
import { selectThreads } from './ThreadsView'
import { resetCommentPendingWrites } from './commentPendingWrites'

/** A list read after the window opened (its request's `listAfter` is 0) unless `generation` says otherwise. */
const ready = (files: CommentFileView[], generation = 1): CommentListState => ({ status: 'ready', files, generation })

// BaseDialog moves focus to the title a moment after opening: typing before
// that lands would lose keystrokes to the title on a loaded machine.
const titleFocused = () =>
  waitFor(() => expect(screen.getByTestId('comment-window-title')).toHaveFocus())

function setup(patch: Partial<CommentWindowProps> = {}) {
  const props: CommentWindowProps = {
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
  return { props, ...render(<CommentWindow {...props} />) }
}

const target = {
  panelId: 'preview-index',
  fileKey: 'f1',
  threadKey: 't1',
  rawHash: thread(1).rawHash
}

describe('CommentWindow – threads', () => {
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

  describe('R-013 focus and title', () => {
    // Changed expectation under 024-FR-006 A-02 (was the selector in the title: "Comment on button.cta").
    it('024-AC-007 A-02 titles the window "Comment on element", the selector on its context line, and focuses the title', async () => {
      setup()
      const title = screen.getByTestId('comment-window-title')
      expect(title).toHaveTextContent('Comment on element')
      expect(screen.getByRole('dialog', { name: 'Comment on element' })).toBeVisible()
      expect(screen.getByText(/^button\.cta · index\.html, line \d+$/)).toBeVisible()
      await waitFor(() => expect(title).toHaveFocus())
    })

    it('says "Comments on" for several threads on one element', () => {
      setup({
        request: threadsRequest({ threadKeys: ['t1', 't2'] }),
        list: ready([fileView({ threads: [thread(1), thread(2)] })])
      })
      expect(screen.getByTestId('comment-window-title')).toHaveTextContent('Comments on element')
    })

    it('shows a reading state while the list is loading', () => {
      setup({ list: { status: 'loading', files: [] } })
      expect(screen.getByRole('status')).toHaveTextContent('Reading comments…')
    })

    it('closes itself when the comments it was opened for are gone', () => {
      const { props } = setup({ list: ready([fileView({ threads: [] })]) })
      expect(props.onClose).toHaveBeenCalled()
    })

    it('the close button in the head closes the window, handing focus back as usual', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-window-close'))
      expect(props.onClose).toHaveBeenCalledWith()
    })

    it('closes itself when the file is no longer in the list', () => {
      const { props } = setup({ list: ready([fileView({ fileKey: 'other' })]) })
      expect(props.onClose).toHaveBeenCalled()
    })

    it('M2 never closes itself on the list it opened with – a pin\'s new thread is not in it yet', () => {
      // A pin click opened the window over list 3, before the pin's thread was listed; list 4 is being read.
      const request = threadsRequest({ listAfter: 3 })
      const { props, rerender } = setup({ request, list: ready([fileView({ threads: [] })], 3) })
      expect(props.onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('status')).toHaveTextContent('Reading comments…')
      // Nor while the newer list is still being read (`beginList` keeps the old one, still 'ready').
      rerender(<CommentWindow {...props} list={ready([fileView({ fileKey: 'other' })], 3)} />)
      expect(props.onClose).not.toHaveBeenCalled()
      // The list read after the click has the thread.
      rerender(<CommentWindow {...props} list={ready([fileView({ threads: [thread(1)] })], 4)} />)
      expect(screen.getAllByTestId('comment-thread')).toHaveLength(1)
      expect(props.onClose).not.toHaveBeenCalled()
      // A later list without it: removed outside Erfana while shown – C-14.5 changed this from a silent
      // close: the window stays, read-only, and says so (W-04).
      rerender(<CommentWindow {...props} list={ready([fileView({ threads: [] })], 5)} />)
      expect(props.onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('comment-removed')).toBeVisible()
    })

    it('M2 a list that failed after the window opened says so instead of "Reading"', () => {
      const failed: CommentListState = { status: 'error', files: [fileView({ threads: [] })], code: 'COMMENT_WRITE_FAILED', generation: 4 }
      const { props } = setup({ request: threadsRequest({ listAfter: 3 }), list: failed })
      expect(props.onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('comment-window-read-error')).toBeVisible()
    })
  })

  describe('R-004 threads: order, reply, resolve, re-open, edit, delete', () => {
    it('lists threads in file order with their messages', () => {
      setup({
        request: threadsRequest({ threadKeys: ['t2', 't1'] }),
        list: ready([
          fileView({
            threads: [
              thread(1, { messages: [message(1), message(2, { by: { name: 'Bo' } })] }),
              thread(2)
            ]
          })
        ])
      })
      const threads = screen.getAllByTestId('comment-thread')
      expect(threads).toHaveLength(2)
      expect(
        within(threads[0])
          .getAllByTestId('comment-message-text')
          .map(n => n.textContent)
      ).toEqual(['Message 1', 'Message 2'])
      expect(within(threads[1]).getByTestId('comment-message-text')).toHaveTextContent('Message 2')
    })

    it('shows the time and the edited mark', () => {
      setup({
        list: ready([
          fileView({
            threads: [
              thread(1, {
                messages: [
                  message(1, {
                    at: new Date(2026, 9, 26, 9, 5).toISOString(),
                    edited: '2026-10-26'
                  })
                ]
              })
            ]
          })
        ])
      })
      const time = screen.getByText('Today, 09:05')
      expect(time.tagName).toBe('TIME')
      expect(time.closest('.erf-comment-message__meta-text')).toHaveTextContent(
        'Ada Lovelace · Today, 09:05 · edited'
      )
    })

    it('replies', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await titleFocused()
      await user.type(screen.getByTestId('comment-reply-field'), ' Agreed ')
      await user.click(screen.getByTestId('comment-reply'))
      expect(props.onSave).toHaveBeenCalledWith({ ...target, op: 'reply', text: 'Agreed' })
      expect(props.onWritten).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'reply' }),
        'index.html'
      )
      await waitFor(() => expect(screen.getByTestId('comment-reply-field')).toHaveValue(''))
    })

    it('refuses an empty reply', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-reply'))
      expect(screen.getByText(COPY.emptyError)).toBeVisible()
      expect(props.onSave).not.toHaveBeenCalled()
    })

    it('B: a reply still being written shows the info banner, file named', async () => {
      const user = userEvent.setup()
      setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_SAVE_PENDING }))
      })
      await titleFocused()
      await user.type(screen.getByTestId('comment-reply-field'), 'Later')
      await user.click(screen.getByTestId('comment-reply'))
      const banner = await screen.findByTestId('comment-save-error')
      expect(banner).toHaveClass('erf-comment-banner--info')
      expect(banner).toHaveTextContent('Still saving to index.html.')
      expect(screen.getByTestId('comment-reply-field')).toHaveValue('Later')
    })

    describe('H1 a pending reply settles', () => {
      let fake: FakeCommentsBridge
      beforeEach(() => {
        fake = installCommentsBridge()
      })
      afterEach(() => fake.uninstall())

      /** Replies `text` and waits for "Still saving". */
      async function replyPending(text: string) {
        const user = userEvent.setup()
        const view = setup({
          onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_SAVE_PENDING }))
        })
        await titleFocused()
        await user.type(screen.getByTestId('comment-reply-field'), text)
        await user.click(screen.getByTestId('comment-reply'))
        await screen.findByTestId('comment-save-error')
        return { user, ...view }
      }

      it('Reply stays "Saving…" and sends nothing more until main says the reply landed; then the field empties', async () => {
        const { user, props } = await replyPending('Later')
        const replyButton = screen.getByTestId('comment-reply')
        expect(replyButton).toHaveAttribute('aria-disabled', 'true')
        expect(replyButton).toHaveTextContent(COPY.saving)
        expect(screen.getByTestId('comment-reply-field')).toHaveAttribute('readonly')
        await user.click(replyButton)
        expect(props.onSave).toHaveBeenCalledTimes(1)
        act(() => fake.emitSettled({ panelId: 'preview-index', op: 'reply', threadKey: 't1', ok: true }))
        expect(screen.getByTestId('comment-reply-field')).toHaveValue('')
        expect(screen.getByTestId('comment-reply-field')).not.toHaveAttribute('readonly')
        expect(screen.queryByTestId('comment-save-error')).toBeNull()
        expect(screen.getByTestId('comment-reply')).toHaveTextContent(COPY.reply)
      })

      it('refused after all: the refusal replaces "Still saving", Reply is back, the text stays and the list is re-read', async () => {
        const { props } = await replyPending('Keep me')
        act(() =>
          fake.emitSettled({
            panelId: 'preview-index',
            op: 'reply',
            threadKey: 't1',
            ok: false,
            code: ErrorCode.COMMENT_BLOCK_CHANGED
          })
        )
        expect(screen.getByTestId('comment-save-error')).toHaveClass('erf-comment-banner--error')
        expect(screen.getByTestId('comment-reply-field')).toHaveValue('Keep me')
        expect(screen.getByTestId('comment-reply')).not.toHaveAttribute('aria-disabled')
        expect(props.onRefresh).toHaveBeenCalled()
      })

      it('an edit on the thread is not sent while the reply is still being written: the window says why', async () => {
        const { user, props } = await replyPending('Later')
        await user.click(screen.getByTestId('comment-message-actions'))
        await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
        await user.type(screen.getByTestId('comment-edit-field'), '!')
        await user.click(screen.getByTestId('comment-edit-save'))
        expect(props.onSave).toHaveBeenCalledTimes(1)
        expect(screen.getByTestId('comment-save-error')).toHaveClass('erf-comment-banner--info')
        expect(screen.getByTestId('comment-edit-field')).toHaveValue('Message 1!')
      })

      it('Resolve sends nothing either while the reply is still being written', async () => {
        const { user, props } = await replyPending('Later')
        await user.click(screen.getByTestId('comment-resolve'))
        expect(props.onSave).toHaveBeenCalledTimes(1)
        expect(screen.getByTestId('comment-save-error')).toHaveClass('erf-comment-banner--info')
      })

      it('refused after all with no code: the window says the write failed, and the text stays', async () => {
        await replyPending('Keep me')
        act(() => fake.emitSettled({ panelId: 'preview-index', op: 'reply', threadKey: 't1', ok: false }))
        expect(screen.getByTestId('comment-save-error')).toHaveClass('erf-comment-banner--error')
        expect(screen.getByTestId('comment-reply-field')).toHaveValue('Keep me')
        expect(screen.getByTestId('comment-reply')).not.toHaveAttribute('aria-disabled')
      })

      it('another thread\'s settle changes nothing here', async () => {
        await replyPending('Later')
        act(() => fake.emitSettled({ panelId: 'preview-index', op: 'reply', threadKey: 't2', ok: true }))
        expect(screen.getByTestId('comment-reply')).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByTestId('comment-save-error')).toHaveClass('erf-comment-banner--info')
      })
    })

    it('replies with Ctrl+Enter and keeps the text when the write is refused', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_FILE_READ_ONLY }))
      })
      await titleFocused()
      await user.type(screen.getByTestId('comment-reply-field'), 'Hmm')
      await user.keyboard('{Control>}{Enter}{/Control}')
      expect(await screen.findByTestId('comment-save-error')).toHaveTextContent(
        'index.html is read-only'
      )
      expect(screen.getByTestId('comment-reply-field')).toHaveValue('Hmm')
      expect(props.onWritten).not.toHaveBeenCalled()
    })

    it('resolves and re-opens', async () => {
      const user = userEvent.setup()
      const { props, rerender } = setup()
      await user.click(screen.getByTestId('comment-resolve'))
      expect(props.onSave).toHaveBeenCalledWith({ ...target, op: 'setStatus', status: 'resolved' })

      rerender(
        <CommentWindow
          {...props}
          list={ready([
            fileView({
              threads: [
                thread(1, {
                  status: 'resolved',
                  resolved: { by: { name: 'Bo' }, at: new Date(2026, 9, 25, 8, 0).toISOString() }
                })
              ]
            })
          ])}
        />
      )
      expect(screen.getByTestId('comment-resolved-thread')).toHaveTextContent(
        'Resolved by Bo · Yesterday, 08:00'
      )
      // Folded until expanded.
      expect(screen.queryByTestId('comment-message-text')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Show the resolved thread' }))
      expect(screen.getByTestId('comment-message-text')).toHaveTextContent('Message 1')
      await user.click(screen.getByTestId('comment-reopen'))
      expect(props.onSave).toHaveBeenLastCalledWith({ ...target, op: 'setStatus', status: 'open' })
    })

    it('edits a message through its actions menu', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-message-actions'))
      await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
      const edit = screen.getByTestId('comment-edit-field')
      expect(edit).toHaveValue('Message 1')
      await user.clear(edit)
      await user.click(screen.getByTestId('comment-edit-save'))
      expect(screen.getByText(COPY.emptyError)).toBeVisible()
      await user.type(edit, 'Better words')
      await user.click(screen.getByTestId('comment-edit-save'))
      expect(props.onSave).toHaveBeenCalledWith({
        ...target,
        op: 'editMessage',
        messageId: message(1).id,
        text: 'Better words'
      })
      await waitFor(() => expect(screen.queryByTestId('comment-edit-field')).toBeNull())
    })

    it('cancels an edit', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByTestId('comment-message-actions'))
      await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
      await user.click(screen.getByRole('button', { name: COPY.cancel }))
      expect(screen.queryByTestId('comment-edit-field')).toBeNull()
    })

    it('deletes a lone comment after confirming, focusing Cancel first', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-message-actions'))
      await user.click(screen.getByRole('menuitem', { name: COPY.delete }))
      expect(
        screen.getByText(
          'Delete this comment? It is removed from index.html. Git history keeps earlier versions.'
        )
      ).toBeVisible()
      expect(screen.getByTestId('comment-delete-cancel')).toHaveFocus()
      await user.click(screen.getByTestId('comment-delete-confirm'))
      expect(props.onSave).toHaveBeenCalledWith({ ...target, op: 'deleteThread' })
    })

    it('deleting the first message of a thread with replies deletes the thread', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        list: ready([
          fileView({ threads: [thread(1, { messages: [message(1), message(2), message(3)] })] })
        ])
      })
      await user.click(screen.getAllByTestId('comment-message-actions')[0])
      await user.click(screen.getByRole('menuitem', { name: COPY.delete }))
      expect(screen.getByText('Delete this thread and its 2 replies?')).toBeVisible()
      await user.click(screen.getByRole('button', { name: COPY.deleteThread }))
      expect(props.onSave).toHaveBeenCalledWith({ ...target, op: 'deleteThread' })
    })

    it('deletes one reply', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        list: ready([fileView({ threads: [thread(1, { messages: [message(1), message(2)] })] })])
      })
      await user.click(screen.getAllByTestId('comment-message-actions')[1])
      await user.click(screen.getByRole('menuitem', { name: COPY.delete }))
      await user.click(screen.getByTestId('comment-delete-confirm'))
      expect(props.onSave).toHaveBeenCalledWith({
        ...target,
        op: 'deleteMessage',
        messageId: message(2).id
      })
    })

    it('backs out of a delete', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-message-actions'))
      await user.click(screen.getByRole('menuitem', { name: COPY.delete }))
      await user.click(screen.getByTestId('comment-delete-cancel'))
      expect(screen.queryByTestId('comment-delete-confirm')).toBeNull()
      expect(props.onSave).not.toHaveBeenCalled()
    })

    it('a refused delete returns to the message and shows why', async () => {
      const user = userEvent.setup()
      setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_FILE_CONFLICTED }))
      })
      await user.click(screen.getByTestId('comment-message-actions'))
      await user.click(screen.getByRole('menuitem', { name: COPY.delete }))
      await user.click(screen.getByTestId('comment-delete-confirm'))
      expect(await screen.findByTestId('comment-save-error')).toHaveTextContent(
        'unresolved git conflicts'
      )
      expect(screen.queryByTestId('comment-delete-confirm')).toBeNull()
    })

    it.each([ErrorCode.COMMENT_BLOCK_CHANGED, ErrorCode.COMMENT_KEY_INVALID])(
      're-reads the list after %s',
      async code => {
        const user = userEvent.setup()
        const { props } = setup({ onSave: vi.fn(async () => ({ ok: false as const, code })) })
        await user.click(screen.getByTestId('comment-resolve'))
        await waitFor(() => expect(props.onRefresh).toHaveBeenCalled())
      }
    )

    it('shows an email only to tell two people with one name apart', () => {
      setup({
        request: threadsRequest({ threadKeys: ['t1', 't2'] }),
        list: ready([
          fileView({
            threads: [
              thread(1, { messages: [message(1, { by: { name: 'Sam', email: 'sam@a.io' } })] }),
              thread(2, {
                messages: [
                  message(2, { by: { name: 'Sam', email: 'sam@b.io' } }),
                  message(3, { by: { name: 'Kim', email: 'kim@c.io' } })
                ]
              })
            ]
          })
        ])
      })
      expect(screen.getByText('sam@a.io', { selector: 'bdi' })).toBeVisible()
      expect(screen.queryByText('kim@c.io', { selector: 'bdi' })).toBeNull()
    })

    it('Open in source opens the file at the thread line; Close closes', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-open-in-source'))
      expect(props.onOpenInSource).toHaveBeenCalledWith('/project/index.html', 11)
      await user.click(screen.getByTestId('comment-close'))
      expect(props.onClose).toHaveBeenCalled()
    })

    it('a read-only file states its reason and offers no writes', () => {
      setup({
        list: ready([
          fileView({ writable: false, readOnlyReason: 'encoding', threads: [thread(1)] })
        ])
      })
      expect(screen.getByTestId('comment-read-only')).toHaveTextContent(
        'Erfana can only add comments to UTF-8 files.'
      )
      expect(screen.queryByTestId('comment-reply-field')).toBeNull()
      expect(screen.queryByTestId('comment-message-actions')).toBeNull()
    })
  })

  describe('R-005 damaged block view', () => {
    const damagedRequest = threadsRequest({ threadKeys: [], blockKeys: ['b1'] })

    it('is read-only with its reason, raw text, Copy raw text, Open in source and Delete block', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        request: damagedRequest,
        list: ready([fileView({ damaged: [damaged(1)] })])
      })
      expect(screen.getByTestId('comment-window-title')).toHaveTextContent(COPY.damagedComment)
      expect(screen.getByText(COPY.damagedText)).toBeVisible()
      const raw = screen.getByTestId('comment-damaged-raw')
      expect(raw).toHaveTextContent('<!-- erfana:comment {not json -->')
      expect(raw).toHaveAccessibleName(COPY.rawLabel)
      expect(raw).toHaveAttribute('tabindex', '0')

      await user.click(screen.getByRole('button', { name: COPY.copyRaw }))
      expect(props.onCopyRaw).toHaveBeenCalledWith('<!-- erfana:comment {not json -->')
      await user.click(
        within(screen.getByTestId('comment-damaged')).getByRole('button', {
          name: COPY.openInSource
        })
      )
      expect(props.onOpenInSource).toHaveBeenCalledWith('/project/index.html', 41)

      await user.click(screen.getByTestId('comment-delete-block'))
      expect(
        screen.getByText(/Erfana removes exactly the text shown above from index.html/)
      ).toBeVisible()
      await user.click(screen.getByTestId('comment-delete-block-confirm'))
      expect(props.onSave).toHaveBeenCalledWith({
        panelId: 'preview-index',
        op: 'deleteBlock',
        fileKey: 'f1',
        blockKey: 'b1',
        rawHash: damaged(1).rawHash
      })
    })

    it('can back out of Delete block', async () => {
      const user = userEvent.setup()
      setup({ request: damagedRequest, list: ready([fileView({ damaged: [damaged(1)] })]) })
      await user.click(screen.getByTestId('comment-delete-block'))
      await user.click(screen.getByRole('button', { name: COPY.cancel }))
      expect(screen.getByTestId('comment-delete-block')).toBeVisible()
    })

    it('S-08 uses the conflict wording for conflict markers, and offers Delete only while the file is writable', () => {
      const { unmount } = setup({
        request: damagedRequest,
        list: ready([fileView({ damaged: [damaged(1, { reason: 'conflict-marker' })] })])
      })
      expect(screen.getByText(COPY.conflictText)).toBeVisible()
      expect(screen.getByTestId('comment-delete-block')).toBeVisible()
      unmount()
      setup({
        request: damagedRequest,
        list: ready([fileView({ writable: false, damaged: [damaged(1, { reason: 'conflict-marker' })] })])
      })
      expect(screen.queryByTestId('comment-delete-block')).toBeNull()
    })

    it.each([
      ['an unterminated block', { reason: 'unterminated' as const }, true],
      ['a read-only file', {}, false]
    ])('offers no delete for %s', (_label, patch, writable) => {
      setup({
        request: damagedRequest,
        list: ready([fileView({ writable, damaged: [damaged(1, patch)] })])
      })
      expect(screen.queryByTestId('comment-delete-block')).toBeNull()
    })

    it('a resolved thread with no resolver recorded says "Resolved"; read-only offers no Re-open', () => {
      setup({
        list: ready([fileView({ writable: false, threads: [thread(1, { status: 'resolved' })] })])
      })
      expect(screen.getByTestId('comment-resolved-thread')).toHaveTextContent('Resolved')
      expect(screen.queryByTestId('comment-reopen')).toBeNull()
    })

    it('sends one reply, one edit and one delete however often the button is pressed', async () => {
      const user = userEvent.setup()
      let answer: (r: CommentSaveResult) => void = () => {}
      const onSave = vi.fn(() => new Promise<CommentSaveResult>(resolve => (answer = resolve)))
      setup({ onSave })
      await titleFocused()
      await user.type(screen.getByTestId('comment-reply-field'), 'Once')
      await user.click(screen.getByTestId('comment-reply'))
      await user.click(screen.getByTestId('comment-reply'))
      expect(onSave).toHaveBeenCalledTimes(1)
      await act(async () => answer({ ok: true, threadKey: 't1' }))

      await user.click(screen.getByTestId('comment-message-actions'))
      await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
      await user.click(screen.getByTestId('comment-edit-save'))
      await user.click(screen.getByTestId('comment-edit-save'))
      expect(onSave).toHaveBeenCalledTimes(2)
      await act(async () => answer({ ok: false, code: ErrorCode.COMMENT_FILE_READ_ONLY }))
      // A refused edit stays in edit mode with the text.
      expect(screen.getByTestId('comment-edit-field')).toHaveValue('Message 1')
      await user.click(screen.getByRole('button', { name: COPY.cancel }))

      await user.click(screen.getByTestId('comment-message-actions'))
      await user.click(screen.getByRole('menuitem', { name: COPY.delete }))
      await user.click(screen.getByTestId('comment-delete-confirm'))
      await user.click(screen.getByTestId('comment-delete-confirm'))
      expect(onSave).toHaveBeenCalledTimes(3)
      await act(async () => answer({ ok: true, threadKey: null }))
    })

    // Changed expectation under A-02 (was "Comment on li" in the title): the script-built tag stays on the context line.
    it('names a script-built element by its own tag on the context line and notes a frame file', () => {
      setup({
        list: ready([
          fileView({
            frame: true,
            displayPath: 'child.html',
            threads: [thread(1, { runtime: { tag: 'li', path: '0/2' } })]
          })
        ])
      })
      expect(screen.getByTestId('comment-window-title')).toHaveTextContent('Comment on element')
      expect(screen.getByText('li · child.html, line 11')).toBeVisible()
      expect(screen.getByText('Saved in child.html.')).toBeVisible()
    })

    it('saves an edit with Ctrl+Enter', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-message-actions'))
      await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
      await user.type(screen.getByTestId('comment-edit-field'), '!')
      await user.keyboard('{Control>}{Enter}{/Control}')
      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'editMessage', text: 'Message 1!' })
      )
    })

    it('opens a newer-format block in source', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        request: threadsRequest({ threadKeys: [], blockKeys: ['n1'] }),
        list: ready([fileView({ newer: [{ blockKey: 'n1', version: 2, line: 70 }] })])
      })
      expect(screen.getByText('index.html, line 70')).toBeVisible()
      await user.click(
        within(screen.getByTestId('comment-newer')).getByRole('button', { name: COPY.openInSource })
      )
      expect(props.onOpenInSource).toHaveBeenCalledWith('/project/index.html', 70)
    })

    it('shows a newer-format block, never changed', () => {
      setup({
        request: threadsRequest({ threadKeys: [], blockKeys: ['n1'] }),
        list: ready([fileView({ newer: [{ blockKey: 'n1', version: 2, line: 70 }] })])
      })
      expect(screen.getByTestId('comment-newer')).toHaveTextContent(COPY.newerText)
      expect(screen.getByTestId('comment-window-title')).toHaveTextContent(COPY.damagedComment)
      expect(screen.queryByTestId('comment-delete-block')).toBeNull()
    })
  })

  describe('"New comment" from a pin (optional draftToken on icon drafts)', () => {
    const TOKEN = 'b'.repeat(32)
    const FILE = {
      fileKey: 'f1',
      displayPath: 'index.html',
      filePath: '/project/index.html',
      frame: false
    }
    const TARGET = {
      tag: 'button',
      elementId: 'buy',
      classes: ['cta', 'primary'],
      line: 12,
      excerpt: 'Buy now'
    }
    const KEY = 'e'.repeat(32)
    const pinRequest = threadsRequest({ draftToken: TOKEN, draftKey: KEY, file: FILE, target: TARGET })

    it('offers New comment and hands over a new-comment request on the same element', async () => {
      const user = userEvent.setup()
      const onNewComment = vi.fn()
      setup({ request: pinRequest, onNewComment })
      await user.click(screen.getByTestId('comment-new-on-element'))
      expect(onNewComment).toHaveBeenCalledWith({
        kind: 'new',
        panelId: 'preview-index',
        draftToken: TOKEN,
        draftKey: KEY,
        // Main's own description of the element, not one rebuilt from the thread.
        target: TARGET,
        file: FILE,
        point: pinRequest.point,
        opener: 'page'
      })
    })

    it.each([
      ['a drawer row (no draft)', { request: threadsRequest() }],
      [
        'a read-only file',
        { request: pinRequest, list: ready([fileView({ writable: false, threads: [thread(1)] })]) }
      ],
      ['no handler', { request: pinRequest, onNewComment: undefined }]
    ])('offers nothing for %s', (_label, patch) => {
      setup({ onNewComment: vi.fn(), ...patch })
      expect(screen.queryByTestId('comment-new-on-element')).toBeNull()
    })

    it('needs the draft, the file and the target main sent with the pin', () => {
      const files = [fileView({ threads: [thread(1)] })]
      const selection = selectThreads(files, 'f1', ['t1'], [])
      expect(newCommentFrom(pinRequest, null)).toBeNull()
      expect(newCommentFrom(threadsRequest({ draftToken: TOKEN, draftKey: KEY, file: FILE }), selection)).toBeNull()
      expect(newCommentFrom(threadsRequest({ draftToken: TOKEN, draftKey: KEY, target: TARGET }), selection)).toBeNull()
      expect(newCommentFrom(threadsRequest({ draftKey: KEY, file: FILE, target: TARGET }), selection)).toBeNull()
      // M1: no element key, no session draft to keep the text under – no New comment.
      expect(newCommentFrom(threadsRequest({ draftToken: TOKEN, file: FILE, target: TARGET }), selection)).toBeNull()
    })

    it('carries a script-built element as main described it', () => {
      const files = [fileView({ threads: [thread(1)] })]
      const request = threadsRequest({
        draftToken: TOKEN,
        draftKey: KEY,
        file: FILE,
        target: { ...TARGET, runtime: { tag: 'li' } }
      })
      expect(
        newCommentFrom(request, selectThreads(files, 'f1', ['t1'], []))?.target.runtime
      ).toEqual({ tag: 'li' })
    })
  })

  describe('R-006 not found and not visible', () => {
    it('shows the stored quote, struck through, under "It was attached to:" when the block has one', () => {
      const lost = {
        ...thread(1, { attached: false }),
        quote: 'Choose the plan that fits your team'
      }
      setup({ list: ready([fileView({ threads: [lost] })]) })
      const banner = screen.getByTestId('comment-not-found')
      expect(banner).toHaveTextContent(COPY.attachedTo)
      const quote = screen.getByTestId('comment-not-found-quote')
      expect(quote.tagName).toBe('S')
      expect(quote).toHaveTextContent('Choose the plan that fits your team')
    })

    it.each([
      ['no quote', {}],
      ['an empty quote', { quote: '  ' }]
    ])('shows no quote line for %s', (_label, extra) => {
      setup({
        list: ready([fileView({ threads: [{ ...thread(1, { attached: false }), ...extra }] })])
      })
      expect(screen.queryByText(COPY.attachedTo)).toBeNull()
    })

    // C-05 changed this wording: not found reads as a possible success, and where the comment is follows it.
    it('C-05 (HTML) says the element is gone as a possible success and keeps the thread usable', () => {
      setup({ list: ready([fileView({ threads: [thread(1, { attached: false })] })]) })
      expect(screen.getByTestId('comment-not-found')).toHaveTextContent(
        'This element is no longer in index.html – it may have been removed or rewritten as asked. Check, then resolve.'
      )
      expect(screen.getByTestId('comment-comment-line')).toHaveTextContent('The comment itself is on line 11 of index.html.')
      expect(screen.getByTestId('comment-reply-field')).toBeVisible()
    })

    it('says the element is not on screen now, from the thread or from main', () => {
      const { unmount } = setup({
        list: ready([fileView({ threads: [thread(1, { notVisible: true })] })])
      })
      expect(screen.getByTestId('comment-not-visible')).toHaveTextContent(HTML_WORDS.notVisibleText('p'))
      unmount()
      setup({ notVisible: ['t1'] })
      expect(screen.getByTestId('comment-not-visible')).toBeVisible()
    })
  })

  describe('SEC-19 React XSS', () => {
    it('renders markup in a comment as text', () => {
      const evil = '<img src=x onerror="window.__pwned=1">'
      setup({
        list: ready([
          fileView({
            threads: [
              thread(1, { messages: [message(1, { text: evil, by: { name: '<b>x</b>' } })] })
            ]
          })
        ])
      })
      expect(screen.getByTestId('comment-message-text')).toHaveTextContent(evil)
      expect(document.querySelector('img')).toBeNull()
      expect(document.querySelector('.erf-comment-message b')).toBeNull()
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    })

    it('the page-facing payloads carry no text field', () => {
      // Comment text reaches the renderer only through the list answer; what
      // main tells the page or the toolbar never carries it (§4.1 B5).
      const keysOf = (schema: { shape?: Record<string, unknown> }) =>
        Object.keys(schema.shape ?? {})
      expect(keysOf(CommentsChangedSchema)).not.toContain('text')
      expect(keysOf(CommentAnchorStatusSchema)).not.toContain('text')
      for (const option of CommentDraftOpenedSchema.options) {
        expect(keysOf(option)).not.toContain('text')
        expect(keysOf(option)).not.toContain('messages')
      }
    })
  })

  describe('round 3: focus, Esc order, kept text, alerts', () => {
    const resolvedList = ready([
      fileView({
        threads: [
          thread(1, {
            status: 'resolved',
            resolved: { by: { name: 'Bo' }, at: new Date(2026, 9, 25, 8, 0).toISOString() }
          })
        ]
      })
    ])

    it('H1 speaks a refused write from the window\'s own assertive region', async () => {
      const user = userEvent.setup()
      setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_FILE_READ_ONLY }))
      })
      const region = screen.getByTestId('comment-window-alert')
      // Mounted before there is anything to say, inside the modal subtree.
      expect(region).toHaveAttribute('aria-live', 'assertive')
      expect(region).toBeEmptyDOMElement()
      expect(screen.getByRole('dialog')).toContainElement(region)
      await titleFocused()
      await user.type(screen.getByTestId('comment-reply-field'), 'Hmm')
      await user.click(screen.getByTestId('comment-reply'))
      await waitFor(() => expect(region).toHaveTextContent('index.html is read-only'))
    })

    it('M4 an edit takes focus in its field; Esc backs out to the … button, keeping the text', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      const actions = screen.getByTestId('comment-message-actions')
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
      const edit = screen.getByTestId('comment-edit-field')
      await waitFor(() => expect(edit).toHaveFocus())
      await user.type(edit, ' and more')
      await user.keyboard('{Escape}')
      expect(screen.queryByTestId('comment-edit-field')).toBeNull()
      expect(props.onClose).not.toHaveBeenCalled()
      await waitFor(() => expect(actions).toHaveFocus())
      // M6: the text Esc left is there when Edit opens again.
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
      expect(screen.getByTestId('comment-edit-field')).toHaveValue('Message 1 and more')
      // An explicit Cancel drops it, and focus goes back to … too.
      await user.click(screen.getByTestId('comment-edit-cancel'))
      await waitFor(() => expect(actions).toHaveFocus())
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
      expect(screen.getByTestId('comment-edit-field')).toHaveValue('Message 1')
      // With no step left open, Esc closes the window.
      await user.click(screen.getByTestId('comment-edit-cancel'))
      await user.keyboard('{Escape}')
      expect(props.onClose).toHaveBeenCalled()
    })

    it('M4 a saved edit returns focus to the … button', async () => {
      const user = userEvent.setup()
      setup()
      const actions = screen.getByTestId('comment-message-actions')
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
      await user.type(screen.getByTestId('comment-edit-field'), '!')
      await user.click(screen.getByTestId('comment-edit-save'))
      await waitFor(() => expect(actions).toHaveFocus())
    })

    it('M4 a cancelled delete, by button or by Esc, returns focus to the … button', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      const actions = screen.getByTestId('comment-message-actions')
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: COPY.delete }))
      await user.click(screen.getByTestId('comment-delete-cancel'))
      await waitFor(() => expect(actions).toHaveFocus())
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: COPY.delete }))
      await user.keyboard('{Escape}')
      expect(screen.queryByTestId('comment-delete-confirm')).toBeNull()
      expect(props.onClose).not.toHaveBeenCalled()
      await waitFor(() => expect(actions).toHaveFocus())
    })

    it('M4 Resolve hands focus to Re-open, and Re-open to the reply field', async () => {
      const user = userEvent.setup()
      const { props, rerender } = setup()
      await user.click(screen.getByTestId('comment-resolve'))
      rerender(<CommentWindow {...props} list={resolvedList} />)
      await waitFor(() => expect(screen.getByTestId('comment-reopen')).toHaveFocus())
      await user.click(screen.getByTestId('comment-reopen'))
      rerender(<CommentWindow {...props} list={ready([fileView({ threads: [thread(1)] })])} />)
      await waitFor(() => expect(screen.getByTestId('comment-reply-field')).toHaveFocus())
    })

    it('M4 a refused Resolve asks for no focus move later', async () => {
      const user = userEvent.setup()
      const { props, rerender } = setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_FILE_READ_ONLY }))
      })
      await user.click(screen.getByTestId('comment-resolve'))
      await screen.findByTestId('comment-save-error')
      rerender(<CommentWindow {...props} list={resolvedList} />)
      expect(screen.getByTestId('comment-reopen')).not.toHaveFocus()
    })

    it('M4 a refused Re-open asks for no focus move later', async () => {
      const user = userEvent.setup()
      const { props, rerender } = setup({
        list: resolvedList,
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_FILE_READ_ONLY }))
      })
      await user.click(screen.getByTestId('comment-reopen'))
      await screen.findByTestId('comment-save-error')
      rerender(<CommentWindow {...props} list={ready([fileView({ threads: [thread(1)] })])} />)
      expect(screen.getByTestId('comment-reply-field')).not.toHaveFocus()
    })

    it('M6 typed reply text survives the window closing and comes back', async () => {
      const user = userEvent.setup()
      const { unmount } = setup()
      await titleFocused()
      await user.type(screen.getByTestId('comment-reply-field'), 'Half a thought')
      unmount()
      setup()
      expect(screen.getByTestId('comment-reply-field')).toHaveValue('Half a thought')
    })

    it('L12 an empty reply puts focus back in the field with its error', async () => {
      const user = userEvent.setup()
      setup()
      await titleFocused()
      await user.click(screen.getByTestId('comment-reply'))
      const field = screen.getByTestId('comment-reply-field')
      expect(field).toHaveFocus()
      expect(field).toHaveAccessibleDescription(expect.stringContaining(COPY.emptyError))
      expect(screen.getByTestId('comment-reply')).toHaveAttribute(
        'aria-keyshortcuts',
        'Control+Enter'
      )
    })

    it('M5 Esc backs out of Delete block… first, focus back on it', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        request: threadsRequest({ threadKeys: [], blockKeys: ['b1'] }),
        list: ready([fileView({ damaged: [damaged(1)] })])
      })
      await user.click(screen.getByTestId('comment-delete-block'))
      await user.keyboard('{Escape}')
      expect(props.onClose).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.getByTestId('comment-delete-block')).toHaveFocus())
    })

    it('M7 a failed list read says so with Try again, instead of reading forever', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        request: threadsRequest({
          file: { fileKey: 'f1', displayPath: 'index.html', filePath: '/p/index.html', frame: false }
        }),
        list: { status: 'error', files: [], code: 'X' }
      })
      expect(screen.getByTestId('comment-window-read-error')).toHaveTextContent(
        "Couldn't read comments from index.html."
      )
      expect(screen.queryByText('Reading comments…')).toBeNull()
      await user.click(screen.getByTestId('comment-window-retry'))
      expect(props.onRefresh).toHaveBeenCalled()
    })

    it('M7 without a file name it still says what failed', () => {
      setup({ list: { status: 'error', files: [] } })
      expect(screen.getByTestId('comment-window-read-error')).toHaveTextContent(
        "Couldn't read comments from this file."
      )
    })

    it('M9 names and emails in attribute values carry tokens, never raw controls', () => {
      const rlo = String.fromCodePoint(0x202e)
      setup({
        list: ready([
          fileView({
            threads: [
              thread(1, {
                messages: [message(1, { by: { name: `Eve${rlo}`, email: `e${rlo}@x.io` } })]
              })
            ]
          })
        ])
      })
      const actions = screen.getByTestId('comment-message-actions')
      expect(actions.getAttribute('aria-label')).toContain('Eve\u27e8U+202E\u27e9')
      expect(actions.getAttribute('aria-label')).not.toContain(rlo)
      expect(screen.getByTestId('comment-thread').getAttribute('aria-label')).not.toContain(rlo)
      const author = screen.getByText('Eve', { exact: false, selector: 'bdi' })
      expect(author.getAttribute('title')).toBe('e\u27e8U+202E\u27e9@x.io')
    })
  })

  describe('R-017 bidi tokens in rendered text', () => {
    it('shows invisible controls in a message and an author as tokens, with dir="auto"', () => {
      const rlo = String.fromCodePoint(0x202e)
      setup({
        list: ready([
          fileView({
            threads: [
              thread(1, {
                messages: [message(1, { text: `pay${rlo}gnp.exe`, by: { name: `Eve${rlo}` } })]
              })
            ]
          })
        ])
      })
      expect(screen.getAllByTestId('comment-control-token')).toHaveLength(2)
      expect(screen.getByTestId('comment-message-text')).toHaveAttribute('dir', 'auto')
      expect(screen.getByTestId('comment-message-text')).toHaveTextContent('pay⟨U+202E⟩gnp.exe')
    })

    it('S-L-B a file name with controls shows them as tokens in every sentence that names it', async () => {
      const rlo = String.fromCodePoint(0x202e)
      const user = userEvent.setup()
      const name = `lmth.${rlo}index.html`
      const { unmount } = setup({
        list: ready([
          fileView({ displayPath: name, writable: false, readOnlyReason: 'encoding', threads: [thread(1, { attached: false })] })
        ])
      })
      const window1 = screen.getByTestId('comment-window')
      expect(window1.textContent).not.toContain(rlo)
      expect(window1.textContent).toContain('lmth.⟨U+202E⟩index.html')
      unmount()

      setup({
        request: threadsRequest({ threadKeys: [], blockKeys: ['b1'] }),
        list: ready([fileView({ displayPath: name, damaged: [damaged(1)] })])
      })
      await user.click(screen.getByTestId('comment-delete-block'))
      const confirm = screen.getByRole('group', { name: 'Confirm delete' })
      expect(confirm.textContent).not.toContain(rlo)
      expect(within(confirm).getByTestId('comment-control-token')).toHaveTextContent('⟨U+202E⟩')
      expect(screen.getByTestId('comment-window').textContent).not.toContain(rlo)
    })

    it('S-L-B a list that failed names the file with its controls as tokens', () => {
      const rlo = String.fromCodePoint(0x202e)
      const failed: CommentListState = { status: 'error', files: [], code: 'COMMENT_WRITE_FAILED', generation: 4 }
      setup({
        request: threadsRequest({ listAfter: 3, file: { displayPath: `a${rlo}b.html`, filePath: '/project/ab.html', frame: false, fileKey: 'f1' } }),
        list: failed
      })
      const error = screen.getByTestId('comment-window-read-error')
      expect(error.textContent).not.toContain(rlo)
      expect(within(error).getByTestId('comment-control-token')).toHaveTextContent('⟨U+202E⟩')
    })
  })

  describe('§19 Rev 4 owner test: open in source and button sizes', () => {
    /** Every text button in the window – the icon buttons (close, …, chevron) are a kind of their own. */
    const textButtons = (): HTMLElement[] =>
      within(screen.getByTestId('comment-window'))
        .getAllByRole('button')
        .filter(button => !button.classList.contains('erf-comment-icon-btn'))

    it('a thread view draws every text button as a Dialog.css button, Reply the one primary', () => {
      setup({
        request: threadsRequest({ threadKeys: ['t1', 't2'] }),
        list: ready([
          fileView({
            threads: [
              thread(1),
              thread(2, {
                status: 'resolved',
                resolved: { by: { name: 'Bo' }, at: new Date(2026, 9, 25, 8, 0).toISOString() }
              })
            ]
          })
        ])
      })
      const buttons = textButtons()
      // Resolve, Reply, Re-open, Open in source, Close – one size, no compact action among them.
      expect(buttons.map(b => b.textContent)).toEqual(
        expect.arrayContaining([COPY.resolve, COPY.reply, COPY.reopen, COPY.openInSource, COPY.close])
      )
      for (const button of buttons) {
        expect(button).toHaveClass('dialog-btn')
        expect(button).not.toHaveClass('erf-comment-action')
      }
      const primaries = buttons.filter(b => b.classList.contains('dialog-btn-primary'))
      expect(primaries.map(b => b.textContent)).toEqual([COPY.reply])
    })

    it('with several open threads no Reply is primary – one primary per view', () => {
      setup({
        request: threadsRequest({ threadKeys: ['t1', 't2'] }),
        list: ready([fileView({ threads: [thread(1), thread(2)] })])
      })
      const replies = screen.getAllByTestId('comment-reply')
      expect(replies).toHaveLength(2)
      for (const reply of replies) expect(reply).toHaveClass('dialog-btn', 'dialog-btn-secondary')
      expect(screen.getByTestId('comment-window').querySelector('.dialog-btn-primary')).toBeNull()
    })

    it('a damaged block\'s actions and the read error\'s Try again are Dialog.css secondaries', () => {
      const { unmount } = setup({
        request: threadsRequest({ threadKeys: [], blockKeys: ['b1'] }),
        list: ready([fileView({ damaged: [damaged(1)] })])
      })
      for (const button of textButtons()) expect(button).toHaveClass('dialog-btn', 'dialog-btn-secondary')
      unmount()
      setup({ list: { status: 'error', files: [] } })
      expect(screen.getByTestId('comment-window-retry')).toHaveClass('dialog-btn', 'dialog-btn-secondary')
    })

    it('the foot keeps Open in source leading and the closing actions in one group that wraps whole', () => {
      setup()
      expect(screen.getByTestId('comment-open-in-source').parentElement).toHaveClass(
        'erf-comment-window__foot-start'
      )
      // New comment, when offered, joins Close in this group (see "offers New comment" above).
      expect(screen.getByTestId('comment-close').parentElement).toHaveClass('erf-comment-window__foot-end')
    })

    it('a reply typed before Open in source is still there when the window opens again', async () => {
      const user = userEvent.setup()
      const first = setup()
      await titleFocused()
      await user.type(screen.getByTestId('comment-reply-field'), 'Half a thought')
      await user.click(screen.getByTestId('comment-open-in-source'))
      expect(first.props.onOpenInSource).toHaveBeenCalledWith('/project/index.html', 11)
      // The panel closes the window for Open in source (usePreviewComments): nothing is asked, nothing lost.
      first.unmount()
      setup()
      expect(screen.getByTestId('comment-reply-field')).toHaveValue('Half a thought')
    })
  })
})

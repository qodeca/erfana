// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – one message of a thread
 * (docs/designs/comments/html-preview-comments.md §7.7, §10.4; R-004, R-017;
 * docs/designs/comments/html-comments/window.html "A thread").
 *
 * - Every message has the same `…` menu – Edit, Delete… – because anyone may
 *   edit or delete any comment (decision 31). Nothing implies an author is
 *   verified: no badge, no avatar (threat S19).
 * - The author's name is shown; the email sits in the name's tooltip and the
 *   message's accessible description, and is printed in full only when two
 *   authors in the window share a name (§10.4).
 * - Deleting is an inline danger confirmation, destructive button on the
 *   right, focus on Cancel. Deleting the FIRST message deletes the thread.
 * - An edit takes focus in its field and keeps its text in `commentDrafts`;
 *   Esc backs out of an edit or a confirmation first (`useInnerStep`), and
 *   leaving either returns focus to the `…` button.
 *
 * Names and emails are untrusted: drawn through `VisibleText`, and through
 * `visibleString` in attribute values (SEC-19, R-017).
 *
 * @module HtmlPreviewPanel/comments/CommentMessage
 */
import { useEffect, useId, useRef, useState } from 'react'
import { renderIcon } from '../../../../utils/iconRegistry'
import type { CommentThreadView } from '../../../../../../shared/ipc/preview-comment-schema'
import { ContextMenu } from '../../../ContextMenu/ContextMenu'
import { commentDrafts } from '../../../../stores/usePreviewCommentStore'
import { COPY, deleteCommentText, deleteThreadText, fieldHint } from './commentCopy'
import { formatCommentTime, visibleString } from './commentFormat'
import { editDraftKey, useInnerStep } from './commentLive'
import { validateCommentText } from './commentSchemas'
import { CommentField, DialogButton, VisibleText } from './CommentParts'
import type { ThreadContext } from './CommentThread'
import { TEST_IDS } from '../../../../constants/testids'

type Message = CommentThreadView['messages'][number]

/** Props for {@link CommentMessageView}. */
export interface CommentMessageProps {
  readonly ctx: ThreadContext
  readonly thread: CommentThreadView
  readonly message: Message
  /** The first message: deleting it deletes the thread. */
  readonly first: boolean
}

/**
 * One message: meta line, text, and its `…` menu, edit and delete states.
 *
 * @param props - {@link CommentMessageProps}
 * @returns The message `<article>`.
 */
export function CommentMessageView({
  ctx,
  thread,
  message,
  first
}: CommentMessageProps): React.JSX.Element {
  const id = useId()
  const draftKey = editDraftKey(ctx.panelId, ctx.fileKey, thread.threadKey, message.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view')
  const [draft, setDraft] = useState(message.text)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  // Set when a step ends by the reader's hand: focus goes back to `…`.
  const focusMenu = useRef(false)
  const time = formatCommentTime(message.at, ctx.now, ctx.locale)
  const email = message.by.email
  const showEmail = email !== undefined && ctx.sharedNames.has(message.by.name)

  // Focus lands on Cancel when the confirmation opens (the destructive button
  // is never the default; Return twice cannot delete), in the field when an
  // edit opens, and back on `…` when either ends.
  useEffect(() => {
    if (mode === 'confirm') cancelRef.current?.focus()
    else if (mode === 'edit') editRef.current?.focus()
    else if (focusMenu.current) {
      focusMenu.current = false
      menuButton.current?.focus()
    }
  }, [mode])

  // Back to the message. The edit text stays in the drafts (Esc, outside
  // click); an explicit Cancel or a save clears it first.
  const backToView = (): void => {
    focusMenu.current = true
    setError(null)
    setMode('view')
  }
  useInnerStep(mode !== 'view', backToView)

  const replies = thread.messages.length - 1
  const confirmText = first && replies > 0 ? deleteThreadText(replies) : deleteCommentText(ctx.file)
  const target = {
    panelId: ctx.panelId,
    fileKey: ctx.fileKey,
    threadKey: thread.threadKey,
    rawHash: thread.rawHash
  }

  const saveEdit = async (): Promise<void> => {
    if (busy) return
    const result = validateCommentText(draft)
    if (!result.ok) {
      setError(result.error)
      editRef.current?.focus()
      return
    }
    setBusy(true)
    const ok = await ctx.run({
      ...target,
      op: 'editMessage',
      messageId: message.id,
      text: result.text
    })
    setBusy(false)
    if (ok) {
      commentDrafts.clear(draftKey)
      backToView()
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const ok = await ctx.run(
      first
        ? { ...target, op: 'deleteThread' }
        : { ...target, op: 'deleteMessage', messageId: message.id }
    )
    setBusy(false)
    if (!ok) backToView()
  }

  return (
    <article
      className="erf-comment-message"
      aria-labelledby={`${id}-a`}
      aria-describedby={email !== undefined ? `${id}-d` : undefined}
      data-testid={TEST_IDS.COMMENT_MESSAGE}
    >
      <div className="erf-comment-message__meta">
        <span className="erf-comment-message__meta-text" id={`${id}-a`}>
          <bdi
            className="erf-comment-message__author"
            title={email !== undefined ? visibleString(email) : undefined}
          >
            <VisibleText text={message.by.name} />
          </bdi>
          {showEmail && (
            <>
              {' ('}
              <bdi>
                <VisibleText text={email} />
              </bdi>
              {')'}
            </>
          )}
          {' · '}
          <time dateTime={message.at}>{time}</time>
          {message.edited !== undefined && ` · ${COPY.edited}`}
        </span>
        {!ctx.readOnly && (
          <button
            ref={menuButton}
            type="button"
            className="erf-comment-icon-btn"
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            aria-label={`Actions for the comment by ${visibleString(message.by.name)}, ${time}`}
            data-testid={TEST_IDS.COMMENT_MESSAGE_ACTIONS}
            onClick={() => {
              const box = menuButton.current?.getBoundingClientRect()
              setMenu({ x: (box?.right ?? 0) - 180, y: box?.bottom ?? 0 })
            }}
          >
            {renderIcon('ellipsis', { size: 16, 'aria-hidden': true })}
          </button>
        )}
      </div>
      {mode === 'edit' ? (
        <>
          <CommentField
            label="Edit comment"
            value={draft}
            onChange={value => {
              setDraft(value)
              commentDrafts.set(draftKey, value)
              setError(null)
            }}
            onSubmit={() => void saveEdit()}
            hint={fieldHint(ctx.file)}
            error={error}
            compact
            textareaRef={editRef}
            testId={TEST_IDS.COMMENT_EDIT_FIELD}
          />
          <div className="erf-comment-thread__actions">
            <DialogButton
              variant="secondary"
              testId={TEST_IDS.COMMENT_EDIT_CANCEL}
              onClick={() => {
                commentDrafts.clear(draftKey)
                backToView()
              }}
            >
              {COPY.cancel}
            </DialogButton>
            <DialogButton
              variant="primary"
              busy={busy}
              onClick={() => void saveEdit()}
              testId={TEST_IDS.COMMENT_EDIT_SAVE}
            >
              {busy ? COPY.saving : COPY.saveChanges}
            </DialogButton>
          </div>
        </>
      ) : (
        <p className="erf-comment-message__text" dir="auto" data-testid={TEST_IDS.COMMENT_MESSAGE_TEXT}>
          <VisibleText text={message.text} />
        </p>
      )}
      {mode === 'confirm' && (
        <div className="erf-comment-confirm" role="group" aria-label="Confirm delete">
          <p className="erf-comment-confirm__text">{confirmText}</p>
          <div className="erf-comment-confirm__actions">
            <DialogButton
              variant="secondary"
              buttonRef={cancelRef}
              onClick={backToView}
              testId={TEST_IDS.COMMENT_DELETE_CANCEL}
            >
              {COPY.cancel}
            </DialogButton>
            <DialogButton
              variant="danger"
              busy={busy}
              onClick={() => void confirmDelete()}
              testId={TEST_IDS.COMMENT_DELETE_CONFIRM}
            >
              {first && replies > 0 ? COPY.deleteThread : COPY.deleteComment}
            </DialogButton>
          </div>
        </div>
      )}
      {email !== undefined && (
        <span className="erf-comment-sr" id={`${id}-d`}>
          <VisibleText text={email} />
        </span>
      )}
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Comment actions"
          onClose={() => setMenu(null)}
          items={[
            {
              label: COPY.edit,
              action: () => {
                // A draft kept from an edit Esc backed out of comes back.
                const kept = commentDrafts.get(draftKey)
                setDraft(kept !== '' ? kept : message.text)
                setError(null)
                setMode('edit')
              }
            },
            { label: COPY.delete, danger: true, action: () => setMode('confirm') }
          ]}
        />
      )}
    </article>
  )
}

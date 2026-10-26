// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – one thread in the comment window
 * (docs/designs/html-preview-comments.md §7.7, §10.4; R-004, R-017;
 * docs/design-system/product/html-comments/window.html "A thread").
 *
 * - Replies one level deep; a resolved thread folds to one line.
 * - Each message – its `…` menu, edit and delete – is `CommentMessageView`
 *   (CommentMessage.tsx).
 * - A read-only file (§10.4 read-only state) shows no menu, no reply box and
 *   no Resolve.
 *
 * All text is untrusted and drawn through {@link VisibleText} (SEC-19); in an
 * attribute value (`title`, `aria-label`) through `visibleString`.
 *
 * Typed reply and edit text lives in `commentDrafts` (keyed per thread and per
 * message), so Esc, an outside click or a closed window never loses it. Esc
 * backs out of an open edit or delete confirmation first (`useInnerStep`).
 * Focus never drops to `<body>`: an edit takes focus in its field; leaving it,
 * or cancelling a delete, returns focus to the message's `…` button; Resolve
 * and Re-open move it to the control that replaces them (Re-open, or the
 * reply field).
 *
 * @module HtmlPreviewPanel/comments/CommentThread
 */
import { useEffect, useId, useRef, useState } from 'react'
import { renderIcon } from '../../../../utils/iconRegistry'
import type {
  CommentSaveRequest,
  CommentThreadView
} from '../../../../../../shared/ipc/preview-comment-schema'
import { commentDrafts } from '../../../../stores/usePreviewCommentStore'
import { COPY, fieldHint, saveShortcutAria, saveShortcutLabel } from './commentCopy'
import { formatCommentTime, visibleString } from './commentFormat'
import { replyDraftKey } from './commentLive'
import { CommentMessageView } from './CommentMessage'
import { validateCommentText } from './commentSchemas'
import { ActionButton, CommentField, DialogButton, VisibleText } from './CommentParts'
import { TEST_IDS } from '../../../../constants/testids'

/** A write the thread asks the window to make; resolves whether it was saved. */
export type RunCommentOp = (request: CommentSaveRequest) => Promise<boolean>

/**
 * Where focus goes once a status change has re-rendered the thread: the
 * resolved line's Re-open, or the open thread's reply field.
 */
export interface FocusAfter {
  readonly threadKey: string
  readonly target: 'reopen' | 'reply'
}

/** What every part of a thread needs from the window. */
export interface ThreadContext {
  readonly panelId: string
  readonly fileKey: string
  /** The file as the reader knows it, for "removed from {file}". */
  readonly file: string
  /** No reply, edit, delete or resolve. */
  readonly readOnly: boolean
  readonly now: Date
  readonly locale?: string
  /** Names carried by more than one email in this window – those print the email. */
  readonly sharedNames: ReadonlySet<string>
  readonly run: RunCommentOp
  /** The focus a status change asked for, until a control takes it. */
  readonly focusAfter: FocusAfter | null
  /** Ask for (or, with `null`, drop) the focus after a status change. */
  readonly setFocusAfter: (next: FocusAfter | null) => void
}

/** Props for {@link CommentThread}. */
export interface CommentThreadProps {
  readonly ctx: ThreadContext
  readonly thread: CommentThreadView
}

/** A reply box with Resolve: the open thread's foot. */
function ReplyBox({ ctx, thread }: CommentThreadProps): React.JSX.Element {
  const key = replyDraftKey(ctx.panelId, ctx.fileKey, thread.threadKey)
  const [text, setText] = useState(() => commentDrafts.get(key))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const { focusAfter, setFocusAfter } = ctx
  // Re-opened from the resolved line: the reply field replaces Re-open.
  useEffect(() => {
    if (focusAfter?.threadKey !== thread.threadKey || focusAfter.target !== 'reply') return
    fieldRef.current?.focus()
    setFocusAfter(null)
  }, [focusAfter, setFocusAfter, thread.threadKey])
  const target = {
    panelId: ctx.panelId,
    fileKey: ctx.fileKey,
    threadKey: thread.threadKey,
    rawHash: thread.rawHash
  }

  const reply = async (): Promise<void> => {
    if (busy) return
    const result = validateCommentText(text)
    if (!result.ok) {
      setError(result.error)
      fieldRef.current?.focus()
      return
    }
    setBusy(true)
    const ok = await ctx.run({ ...target, op: 'reply', text: result.text })
    setBusy(false)
    if (ok) {
      setText('')
      commentDrafts.clear(key)
    }
  }

  const resolve = async (): Promise<void> => {
    setFocusAfter({ threadKey: thread.threadKey, target: 'reopen' })
    const ok = await ctx.run({ ...target, op: 'setStatus', status: 'resolved' })
    if (!ok) setFocusAfter(null)
  }

  return (
    <div className="erf-comment-thread__reply">
      <CommentField
        label={COPY.reply}
        value={text}
        onChange={value => {
          setText(value)
          commentDrafts.set(key, value)
          setError(null)
        }}
        onSubmit={() => void reply()}
        hint={fieldHint(ctx.file)}
        error={error}
        compact
        textareaRef={fieldRef}
        testId={TEST_IDS.COMMENT_REPLY_FIELD}
      />
      <div className="erf-comment-thread__actions">
        <ActionButton onClick={() => void resolve()} testId={TEST_IDS.COMMENT_RESOLVE}>
          {COPY.resolve}
        </ActionButton>
        <DialogButton
          variant="primary"
          busy={busy}
          title={`${COPY.reply} (${saveShortcutLabel()})`}
          keyShortcut={saveShortcutAria()}
          onClick={() => void reply()}
          testId={TEST_IDS.COMMENT_REPLY}
        >
          {busy ? COPY.saving : COPY.reply}
        </DialogButton>
      </div>
    </div>
  )
}

/**
 * An open thread: its messages, its replies indented one level, and the
 * reply box with Resolve.
 *
 * @param props - {@link CommentThreadProps}
 * @returns The thread section.
 */
export function CommentThread({ ctx, thread }: CommentThreadProps): React.JSX.Element {
  const [first, ...replies] = thread.messages
  return (
    <section
      className="erf-comment-thread"
      aria-label={`Thread started by ${visibleString(first.by.name)}`}
      data-testid={TEST_IDS.COMMENT_THREAD}
    >
      <CommentMessageView ctx={ctx} thread={thread} message={first} first />
      {replies.length > 0 && (
        <div className="erf-comment-replies">
          {replies.map(message => (
            <CommentMessageView
              key={message.id}
              ctx={ctx}
              thread={thread}
              message={message}
              first={false}
            />
          ))}
        </div>
      )}
      {!ctx.readOnly && <ReplyBox ctx={ctx} thread={thread} />}
    </section>
  )
}

/**
 * A resolved thread, folded to one line: who resolved it and when, Re-open,
 * and a disclosure that shows the messages.
 *
 * @param props - {@link CommentThreadProps}
 * @returns The folded thread.
 */
export function ResolvedThread({ ctx, thread }: CommentThreadProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const reopenRef = useRef<HTMLButtonElement>(null)
  const { focusAfter, setFocusAfter } = ctx
  // Resolved from the open thread: Re-open replaces Resolve.
  useEffect(() => {
    if (focusAfter?.threadKey !== thread.threadKey || focusAfter.target !== 'reopen') return
    reopenRef.current?.focus()
    setFocusAfter(null)
  }, [focusAfter, setFocusAfter, thread.threadKey])
  const by = thread.resolved?.by.name
  const at = thread.resolved ? formatCommentTime(thread.resolved.at, ctx.now, ctx.locale) : null
  return (
    <div className="erf-comment-resolved" data-testid={TEST_IDS.COMMENT_RESOLVED_THREAD}>
      <span className="erf-comment-resolved__text">
        <span className="erf-comment-resolved__icon">
          {renderIcon('check', { size: 14, 'aria-hidden': true })}
        </span>
        <span>
          {by !== undefined && at !== null ? (
            <>
              {'Resolved by '}
              <bdi>
                <VisibleText text={by} />
              </bdi>
              {' · '}
              <time dateTime={thread.resolved?.at}>{at}</time>
            </>
          ) : (
            'Resolved'
          )}
        </span>
      </span>
      {!ctx.readOnly && (
        <ActionButton
          buttonRef={reopenRef}
          onClick={() => {
            setFocusAfter({ threadKey: thread.threadKey, target: 'reply' })
            void ctx
              .run({
                panelId: ctx.panelId,
                fileKey: ctx.fileKey,
                threadKey: thread.threadKey,
                rawHash: thread.rawHash,
                op: 'setStatus',
                status: 'open'
              })
              .then(ok => {
                if (!ok) setFocusAfter(null)
              })
          }}
          testId={TEST_IDS.COMMENT_REOPEN}
        >
          {COPY.reopen}
        </ActionButton>
      )}
      <button
        type="button"
        className="erf-comment-icon-btn"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label="Show the resolved thread"
        onClick={() => setOpen(!open)}
      >
        {open
          ? renderIcon('chevron-up', { size: 16, 'aria-hidden': true })
          : renderIcon('chevron-down', { size: 16, 'aria-hidden': true })}
      </button>
      <div className="erf-comment-resolved__body" id={bodyId} hidden={!open}>
        {open && (
          <section className="erf-comment-thread" aria-label="Resolved thread">
            {thread.messages.map((message, index) => (
              <CommentMessageView
                key={message.id}
                ctx={ctx}
                thread={thread}
                message={message}
                first={index === 0}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

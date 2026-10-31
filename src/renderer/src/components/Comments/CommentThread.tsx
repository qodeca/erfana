// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – one thread in the comment window
 * (docs/designs/comments/html-preview-comments.md §7.7, §10.4; R-004, R-017;
 * docs/designs/comments/html-comments/window.html "A thread").
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
 * While a write on the thread is still being written (`COMMENT_SAVE_PENDING`,
 * `commentPendingWrites`) the reply field is read-only and Reply says
 * "Saving…": a second reply of the same text cannot be sent. A pending reply
 * that lands empties the field; one that is refused leaves the text.
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
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { renderIcon } from '../../utils/iconRegistry'
import type {
  CommentSaveRequest,
  CommentThreadView
} from '../../../../shared/ipc/preview-comment-schema'
import { commentDrafts } from '../../stores/usePreviewCommentStore'
import { COPY, fieldHint, saveShortcutAria, saveShortcutLabel } from './commentCopy'
import { formatCommentTime, visibleString } from './commentFormat'
import { replyDraftKey } from './commentLive'
import { onCommentWriteSettled, useCommentWritePending } from './commentPendingWrites'
import { CommentMessageView } from './CommentMessage'
import { validateCommentText } from './commentSchemas'
import { CommentField, DialogButton, VisibleText } from './CommentParts'
import { WINDOW_COPY } from './commentWindowCopy'
import { TEST_IDS } from '../../constants/testids'

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
  /**
   * The view holds exactly one open thread, so its Reply is the view's one
   * primary action. With several, every Reply is secondary: a row of violet
   * buttons ranks nothing (§19 Rev 4 "open in source and button sizes").
   */
  readonly replyIsPrimary: boolean
  readonly run: RunCommentOp
  /** The focus a status change asked for, until a control takes it. */
  readonly focusAfter: FocusAfter | null
  /** Ask for (or, with `null`, drop) the focus after a status change. */
  readonly setFocusAfter: (next: FocusAfter | null) => void
  /**
   * The stepper is shown over one open thread (C-13, R-06): its Resolve is
   * the foot's "Resolve and next", so the thread offers none of its own.
   */
  readonly stepFoot?: boolean
  /** Message ids each thread had when the window first showed it (W-03 "New since you opened"). */
  readonly seen?: ReadonlyMap<string, ReadonlySet<string>>
  /** The file changed under the window (W-03): the divider is drawn. */
  readonly updated?: boolean
}

/** Props for {@link CommentThread}. */
export interface CommentThreadProps {
  readonly ctx: ThreadContext
  readonly thread: CommentThreadView
  /**
   * Resolve leads: primary, last, and focused when the window opens – the
   * states that usually mean the work was done (C-05, C-06: S-03 – S-05).
   */
  readonly resolveLeads?: boolean
  /** Takes the leading Resolve, for the window's first focus. */
  readonly resolveRef?: React.Ref<HTMLButtonElement>
}

/** A reply box with Resolve: the open thread's foot. */
function ReplyBox({ ctx, thread, resolveLeads = false, resolveRef }: CommentThreadProps): React.JSX.Element {
  const key = replyDraftKey(ctx.panelId, ctx.fileKey, thread.threadKey)
  const [text, setText] = useState(() => commentDrafts.get(key))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A write on this thread still being written: no second one (H1).
  const pending = useCommentWritePending(ctx.panelId, thread.threadKey)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const { focusAfter, setFocusAfter } = ctx
  // A reply answered "still saving" landed: its text is spent (the draft is cleared already).
  useEffect(
    () =>
      onCommentWriteSettled(({ event, request }) => {
        if (event.ok && request.op === 'reply' && request.panelId === ctx.panelId && request.threadKey === thread.threadKey) {
          setText('')
        }
      }),
    [ctx.panelId, thread.threadKey]
  )
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
    if (busy || pending) return
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
    if (pending) return
    setFocusAfter({ threadKey: thread.threadKey, target: 'reopen' })
    const ok = await ctx.run({ ...target, op: 'setStatus', status: 'resolved' })
    if (!ok) setFocusAfter(null)
  }

  // "Reply and resolve" (C-13): one write that adds the reply and resolves the thread.
  const replyAndResolve = async (): Promise<void> => {
    if (busy || pending) return
    const result = validateCommentText(text)
    if (!result.ok) {
      setError(result.error)
      fieldRef.current?.focus()
      return
    }
    setBusy(true)
    setFocusAfter({ threadKey: thread.threadKey, target: 'reopen' })
    const ok = await ctx.run({ ...target, op: 'reply', text: result.text, resolve: true })
    setBusy(false)
    if (ok) {
      setText('')
      commentDrafts.clear(key)
    } else setFocusAfter(null)
  }

  const hasText = text.trim() !== ''
  // C-21: an empty reply is blocked – dimmed, and it says what is missing.
  const replyBlocked = hasText ? null : WINDOW_COPY.writeReplyFirst
  const resolveButton = (
    <DialogButton
      variant={resolveLeads ? 'primary' : 'secondary'}
      buttonRef={resolveRef}
      onClick={() => void resolve()}
      testId={TEST_IDS.COMMENT_RESOLVE}
    >
      {COPY.resolve}
    </DialogButton>
  )
  const replyAndResolveButton = hasText ? (
    <DialogButton variant="secondary" busy={busy || pending} onClick={() => void replyAndResolve()} testId={TEST_IDS.COMMENT_REPLY_RESOLVE}>
      {WINDOW_COPY.replyAndResolve}
    </DialogButton>
  ) : null
  const replyButton = (
    <DialogButton
      variant={ctx.replyIsPrimary && !resolveLeads ? 'primary' : 'secondary'}
      busy={busy || pending}
      blocked={replyBlocked}
      title={`${COPY.reply} (${saveShortcutLabel()})`}
      keyShortcut={saveShortcutAria()}
      onClick={() => void reply()}
      testId={TEST_IDS.COMMENT_REPLY}
    >
      {busy || pending ? COPY.saving : COPY.reply}
    </DialogButton>
  )
  // One row, primary last: Resolve leads in S-03 – S-05; with the stepper it is the foot's (R-06).
  const actions = ctx.stepFoot ? (
    <>
      {replyAndResolveButton}
      {replyButton}
    </>
  ) : resolveLeads ? (
    <>
      {replyAndResolveButton}
      {replyButton}
      {resolveButton}
    </>
  ) : (
    <>
      {resolveButton}
      {replyAndResolveButton}
      {replyButton}
    </>
  )

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
        readOnly={pending && !busy}
        textareaRef={fieldRef}
        testId={TEST_IDS.COMMENT_REPLY_FIELD}
      />
      <div className="erf-comment-thread__actions">{actions}</div>
    </div>
  )
}

/** "New since you opened" above the first message the window had not seen, after the file changed (W-03). */
function isFirstNew(ctx: ThreadContext, thread: CommentThreadView, index: number): boolean {
  const seen = ctx.seen?.get(thread.threadKey)
  if (ctx.updated !== true || seen === undefined) return false
  const firstNew = thread.messages.findIndex(message => !seen.has(message.id))
  return firstNew > 0 && firstNew === index
}

/** The W-03 divider. */
function NewSince(): React.JSX.Element {
  return (
    <p className="erf-comment-divider" role="separator" data-testid={TEST_IDS.COMMENT_NEW_SINCE}>
      <span>{WINDOW_COPY.newSince}</span>
    </p>
  )
}

/**
 * An open thread: its messages, its replies indented one level, and the
 * reply box with Resolve.
 *
 * @param props - {@link CommentThreadProps}
 * @returns The thread section.
 */
export function CommentThread({ ctx, thread, resolveLeads, resolveRef }: CommentThreadProps): React.JSX.Element {
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
          {replies.map((message, i) => (
            <Fragment key={message.id}>
              {isFirstNew(ctx, thread, i + 1) && <NewSince />}
              <CommentMessageView ctx={ctx} thread={thread} message={message} first={false} />
            </Fragment>
          ))}
        </div>
      )}
      {!ctx.readOnly && <ReplyBox ctx={ctx} thread={thread} resolveLeads={resolveLeads} resolveRef={resolveRef} />}
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
        <DialogButton
          variant="secondary"
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
        </DialogButton>
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

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the comment window, in both previews
 * (docs/designs/comments/html-preview-comments.md decision 4, §10.4, §10.7; R-003 –
 * R-008, R-013, R-018, R-019, R-022; spec 024 state table § 3; comments-v2
 * C-05, C-06, C-13, C-14, C-18, C-19, C-21, OD-05;
 * docs/designs/comments/comments-v2/window.html).
 *
 * ERFANA'S OWN WINDOW. In the HTML Preview it is modal over a still image of
 * the page – the page cannot see it, style it or type into it; in the
 * Markdown Preview it is non-modal and docked beside its target (C-18). The
 * frame is `CommentWindowShell`.
 *
 * Its three views, in the one window (no stacked dialog, nothing lost):
 *
 * 1. **Before your first comment** – the identity step, shown on the first
 *    comment while the one-time privacy notice is unseen (also when the name
 *    is already set in Settings, then pre-filled – R-019), or when main says
 *    a name is needed.
 * 2. **New comment** – {@link NewCommentView}.
 * 3. **Comment(s) on {label}** / **Damaged comment** – {@link ThreadsView},
 *    with the stepper (‹ 3 of 12 ›, Alt+F9 / Alt+Shift+F9, Resolve and next –
 *    C-13) and what happened to the file while it was open (`useThreadSession`:
 *    updated, removed, all done – C-14, W-03, W-04, W-11).
 *
 * Focus: a new comment lands in the text field; a thread on the window title
 * (`tabindex="-1"`), so a screen reader starts at the top – or on Resolve when
 * the thread's state makes it the main action (S-03 – S-05); on close it goes
 * back to the opener.
 *
 * Esc and an outside click back out of the newest INNER step first – an
 * edit, a delete confirmation, the inline identity editor – keeping its typed
 * text; only with no step open do they close the window (M6). Failures are
 * spoken from an always-mounted assertive region INSIDE the window (H1); a
 * step is spoken from its polite one.
 *
 * A thread view closes itself when the threads it names are gone before it
 * showed them, or after a delete made here – on a list read after the one it
 * opened with (`listAfter`). Removed outside Erfana while shown, it stays,
 * read-only (W-04).
 *
 * A thread write answered "still saving" (`COMMENT_SAVE_PENDING`) is tracked
 * in `commentPendingWrites` until main says how it ended.
 *
 * @module HtmlPreviewPanel/comments/CommentWindow
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { renderIcon } from '../../utils/iconRegistry'
import type {
  CommentSaveRequest,
  CommentSaveResult,
  CommentThreadView
} from '../../../../shared/ipc/preview-comment-schema'
import type { CommentIdentitySettings } from '../../../../shared/ipc/global-settings-schema'
import { ErrorCode } from '../../../../shared/errors'
import type { AnchorSelection } from '../../../../shared/comments/anchorSel'
import type { CommentListState } from '../../stores/usePreviewCommentStore'
import { COPY, IDENTITY_COPY, readErrorText, type SaveFailureCopy } from './commentCopy'
import { useCommentWords } from './commentWords'
import { visibleString } from './commentFormat'
import { CommentStepsContext, replyDraftKey, useLiveText, type CommentSteps } from './commentLive'
import {
  isCommentWritePending,
  onCommentWriteSettled,
  trackCommentWrite,
  writeKeyOf
} from './commentPendingWrites'
import { DialogButton, VisibleText } from './CommentParts'
import type { Box } from './commentPlacement'
import type { IdentityFormData } from './commentSchemas'
import { CommentStepper, MoreActions, stepKeyOf } from './CommentStepper'
import { useDrawerFilter } from './commentDrawerFilter'
import { useWindowStepTarget } from './commentStepKeys'
import { WINDOW_COPY, editWordsNotice, windowRefusal } from './commentWindowCopy'
import { headingOf, newCommentFrom } from './commentWindowHeading'
import { resolveLeads, stepPosition, threadStateOf, withResolved } from './commentWindowStates'
import type { CommentWindowRequest, NounSource } from './commentWindowTypes'
import { CommentWindowShell, type CommentDock } from './CommentWindowShell'
import { IdentityStep } from './IdentityStep'
import { NewCommentView } from './NewCommentView'
import { ThreadsView } from './ThreadsView'
import { useThreadSession } from './useThreadSession'
import './CommentWindow.css'
import { TEST_IDS } from '../../constants/testids'

/** Props for {@link CommentWindow}. */
export interface CommentWindowProps {
  readonly request: CommentWindowRequest
  /** The tab's list (threads view). */
  readonly list: CommentListState
  readonly identity: CommentIdentitySettings | null
  /** Thread keys main reported as not rendered right now. */
  readonly notVisible: readonly string[]
  /** The page area's box: the window stays inside it. */
  readonly getArea: () => Box | null
  /** Injected clock (R-016); `new Date()` by default. */
  readonly now?: () => Date
  readonly locale?: string
  /**
   * Close, keeping any typed draft; the caller returns focus – unless
   * `returnFocus` is `false` ("Go to tab" moves focus to the editor itself).
   */
  readonly onClose: (returnFocus?: boolean) => void
  /** "New comment" in an icon's thread view: switch to a new comment on that target. */
  readonly onNewComment?: (request: Extract<CommentWindowRequest, { kind: 'new' }>) => void
  readonly onSaveIdentity: (identity: IdentityFormData) => Promise<boolean>
  /** Write; with a new comment, `sel` carries the chosen words (024-FR-004) – a preview that offers none ignores it. */
  readonly onSave: (request: CommentSaveRequest, sel?: AnchorSelection) => Promise<CommentSaveResult>
  /** A write landed: announce it and refresh the list. */
  readonly onWritten: (request: CommentSaveRequest, file: string) => void
  /** Refresh the list (a refusal that means the list is stale). */
  readonly onRefresh: () => void
  /** "Pick again" after a moved or expired draft (the text is carried to the next window – C-14.1). */
  readonly onPickAgain: () => void
  readonly onOpenInSource: (filePath: string, line: number) => void
  readonly onCopyRaw: (text: string) => void
  /** Comments are paused (Markdown, 024-FR-015): writes are off and this says why. */
  readonly pausedText?: string | null
  /**
   * Modal over a still page (the HTML Preview), or docked and non-modal (the
   * Markdown Preview, C-18). Defaults by the preview's words.
   */
  readonly modal?: boolean
  /** What a docked window follows and hands F6 to (C-18); `anchor` takes the thread shown, `null` for a new comment. */
  readonly dock?: Omit<CommentDock, 'anchor' | 'label'> & { readonly anchor: (threadKey: string | null) => HTMLElement | null }
  /** A step reached this thread (C-13): show its target. */
  readonly onReveal?: (threadKey: string) => void
  /** "Comment on the whole {parent}" after a render-check refusal (W-07): open the window on the parent. */
  readonly onRetarget?: (request: Extract<CommentWindowRequest, { kind: 'new' }>) => void
  /** The panel's drawer `id`: the stepper steps within that drawer's current filter (C-13); Open when absent or shut. */
  readonly drawerId?: string
}

/**
 * The comment window.
 *
 * @param props - {@link CommentWindowProps}
 * @returns The window.
 *
 * @example
 * ```tsx
 * {request && (
 *   <CommentWindow request={request} list={list} identity={identity} notVisible={[]}
 *     getArea={readArea} onClose={close} onSave={commentGateway.save} … />
 * )}
 * ```
 */
export function CommentWindow(props: CommentWindowProps): React.JSX.Element {
  const { request, list, identity } = props
  const titleId = useId()
  const noticeId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const leadRef = useRef<HTMLButtonElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const [identityAsked, setIdentityAsked] = useState(false)
  const [failure, setFailure] = useState<SaveFailureCopy | null>(null)
  const [alertText, alert] = useLiveText()
  const [politeText, announce] = useLiveText()
  // Open inner steps, newest last: Esc and an outside click cancel the top one.
  const steps = useRef<Array<() => void>>([])
  const register = useCallback((cancel: () => void) => {
    steps.current.push(cancel)
    return () => {
      steps.current = steps.current.filter(step => step !== cancel)
    }
  }, [])
  const stepsValue = useMemo<CommentSteps>(() => ({ register, alert }), [register, alert])
  const [now] = useState(() => (props.now ?? (() => new Date()))())

  const needsIdentity =
    request.kind === 'new' &&
    (identityAsked || identity === null || !identity.identityNoticeSeen || !identity.authorName)
  const view: 'identity' | 'new' | 'threads' = needsIdentity ? 'identity' : request.kind

  const stepFilter = useDrawerFilter(props.drawerId)
  const session = useThreadSession(request, list, stepFilter)
  const selection = request.kind === 'threads' ? session.selection : null
  const waiting = request.kind === 'threads' && session.waiting
  // Before any memoized callback: the compiler takes these calls as possible changes to `selection`.
  const words = useCommentWords()
  const modal = props.modal ?? words.preview === 'html'
  const heading = headingOf(request, selection, words)
  const newComment = props.onNewComment && !session.stepped ? newCommentFrom(request, selection) : null
  const notVisible = useMemo(() => new Set(props.notVisible), [props.notVisible])
  const shownThread = selection?.threads[0]

  const { onClose } = props
  const dismiss = useCallback(() => {
    const top = steps.current[steps.current.length - 1]
    if (top) top()
    else onClose()
  }, [onClose])
  // Gone before it was shown, or deleted from here: nothing left to show (M2).
  const { gone } = session
  useEffect(() => {
    if (gone) onClose()
  }, [gone, onClose])

  // Focus moves into the field when the identity step hands over.
  const previousView = useRef(view)
  useEffect(() => {
    if (previousView.current === 'identity' && view === 'new') textareaRef.current?.focus()
    previousView.current = view
  }, [view])

  const { onRefresh } = props
  // Shown in banners and alerts through `visibleString`: bidi and invisible characters as tokens (S-L-B).
  const displayPath = selection?.file.displayPath ?? ''
  const targetTag = shownThread
  /** A write that did not land – refused, or still being written: say why and what next (C-19). */
  const refused = useCallback(
    (code: string, reason?: string, op?: CommentSaveRequest['op']) => {
      const file = visibleString(displayPath)
      // W-05: the thread changed under a reply – it is updated above, and the reply is still there.
      const copy: SaveFailureCopy =
        code === ErrorCode.COMMENT_BLOCK_CHANGED && op === 'reply'
          ? { text: WINDOW_COPY.blockChangedReply(file), action: 'banner' }
          : windowRefusal(words, code, file, targetTag, reason)
      setFailure(copy)
      alert(copy.text)
      // The list is stale: read it again so the next try uses fresh hashes.
      if (code === ErrorCode.COMMENT_BLOCK_CHANGED || code === ErrorCode.COMMENT_KEY_INVALID) onRefresh()
    },
    [displayPath, alert, onRefresh, words, targetTag]
  )

  const { noteWrite, noteRefused } = session
  const run = useCallback(
    async (save: CommentSaveRequest): Promise<boolean> => {
      // Still being written: a second write on the thread would only collide with it.
      if (isCommentWritePending(save.panelId, writeKeyOf(save), true)) {
        refused(ErrorCode.COMMENT_SAVE_PENDING)
        return false
      }
      setFailure(null)
      noteWrite(save)
      const file = visibleString(displayPath)
      const draftKey = save.op === 'reply' ? replyDraftKey(save.panelId, save.fileKey, save.threadKey) : undefined
      const write = trackCommentWrite(save, { file, ...(draftKey === undefined ? {} : { draftKey }) })
      const result = await props.onSave(save)
      write.answered(result)
      if (result.ok) {
        props.onWritten(save, file)
        // C-07 (D-16): the edit landed without its words – the banner and the polite region say so.
        const kept = editWordsNotice(words, save, result, selection?.threads ?? [], file)
        if (kept !== null) setFailure(kept)
        if (kept !== null) announce(kept.text)
        return true
      }
      noteRefused(save)
      refused(result.code, result.reason, save.op)
      return false
    },
    [props, displayPath, refused, noteWrite, noteRefused, words, selection, announce]
  )

  // A write answered "still saving" settled: landed clears the banner (the
  // panel announces it and main re-lists); refused says why.
  const shownKeys = request.kind === 'threads' ? (selection?.threads.map(t => t.threadKey) ?? []).join('\n') : ''
  useEffect(() => {
    if (shownKeys === '') return undefined
    const keys = new Set(shownKeys.split('\n'))
    return onCommentWriteSettled(({ event, request: save }) => {
      if (save.panelId !== request.panelId || !keys.has(writeKeyOf(save))) return
      if (event.ok) setFailure(current => (current?.action === 'pending' ? null : current))
      else refused(event.code ?? ErrorCode.COMMENT_WRITE_FAILED)
    })
  }, [shownKeys, request.panelId, refused])

  // ---- stepping (C-13) ----
  const [stepped, setStepped] = useState(0)
  const { goTo } = session
  const { onReveal } = props
  const stepTo = useCallback(
    (threadKey: string, resolved?: string) => {
      const file = selection?.file
      const target = file?.threads.find(t => t.threadKey === threadKey)
      const at = file === undefined ? null : stepPosition(withResolved(file, resolved), [threadKey], stepFilter)
      goTo(threadKey)
      setFailure(null)
      setStepped(n => n + 1)
      onReveal?.(threadKey)
      if (target !== undefined && at !== null) {
        announce(WINDOW_COPY.stepAnnounce(at.at, at.of, words.noun(target), target.line))
      }
    },
    [selection, goTo, onReveal, announce, words, stepFilter]
  )
  // A step lands on the new thread's title, so a screen reader starts at the top again.
  useEffect(() => {
    if (stepped > 0) titleRef.current?.focus()
  }, [stepped])
  // W-11: Close takes focus once every comment is resolved.
  useEffect(() => {
    if (session.allDone) leadRef.current?.focus()
  }, [session.allDone])

  const resolveAndNext = useCallback(
    (thread: CommentThreadView) => {
      const next = session.step?.next ?? null
      const save: CommentSaveRequest = {
        panelId: request.panelId,
        fileKey: selection?.file.fileKey ?? '',
        threadKey: thread.threadKey,
        rawHash: thread.rawHash,
        op: 'setStatus',
        status: 'resolved'
      }
      void run(save).then(ok => {
        if (ok && next !== null) stepTo(next, thread.threadKey) // counted as resolved: the file view lists it open until the re-list
      })
    },
    [session.step, request.panelId, selection, run, stepTo]
  )
  const { step } = session
  // C-13: Alt+F9 / Alt+Shift+F9 from the preview step this window too (not modal) – only a threads view, and only when it stepped.
  const stepFromPreview = useCallback(
    (key: 'next' | 'previous') => {
      const target = (key === 'next' ? step?.next : step?.previous) ?? null
      if (target !== null) stepTo(target)
      return target !== null
    },
    [step, stepTo]
  )
  useWindowStepTarget(props.drawerId ?? request.panelId, request.kind === 'threads' ? shownThread?.threadKey : undefined, view === 'threads' ? stepFromPreview : undefined)
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const key = stepKeyOf(event.nativeEvent)
    if (key === null || step === null) return
    const target = key === 'next' ? step.next : step.previous
    if (target === null) return
    event.preventDefault()
    stepTo(target)
  }

  // The thread whose Resolve leads takes the first focus (S-03 – S-05).
  const leads = selection?.threads.some(t => t.status === 'open' && resolveLeads(threadStateOf(t, notVisible))) === true
  const initialFocusRef = view === 'threads' ? (leads ? leadRef : titleRef) : view === 'new' ? textareaRef : undefined
  const dock = useDock(props, request.kind === 'threads' ? (shownThread?.threadKey ?? null) : null, shownThread ?? (request.kind === 'new' ? request.target : ''), shownThread?.line ?? (request.kind === 'new' ? request.target.line : 1), words.noun)
  const moreActions = [
    ...(newComment !== null && !props.pausedText ? [{ label: COPY.newComment, action: () => props.onNewComment?.(newComment), testId: TEST_IDS.COMMENT_NEW_ON_ELEMENT }] : []),
    { label: COPY.openInSource, action: () => props.onOpenInSource(selection?.file.filePath ?? '', shownThread?.line ?? 1), testId: TEST_IDS.COMMENT_OPEN_IN_SOURCE }
  ]

  return (
    <CommentWindowShell
      modal={modal}
      titleId={titleId}
      describedBy={view === 'identity' ? noticeId : undefined}
      initialFocusRef={initialFocusRef}
      onDismiss={dismiss}
      windowRef={windowRef}
      getArea={props.getArea}
      point={request.point}
      placeKey={`${view}:${stepped}`}
      dock={modal ? undefined : dock}
      onKeyDown={onKeyDown}
      view={view}
    >
      <CommentStepsContext.Provider value={stepsValue}>
        {/* Always mounted, empty until a failure: see the module comment. */}
        <p className="erf-comment-sr" aria-live="assertive" data-testid={TEST_IDS.COMMENT_WINDOW_ALERT}>
          {alertText}
        </p>
        <p className="erf-comment-sr" aria-live="polite" data-testid={TEST_IDS.COMMENT_WINDOW_POLITE}>
          {politeText}
        </p>
        <div className="erf-comment-window__head">
          <div className="erf-comment-window__heading">
            <h2 className="erf-comment-window__title" id={titleId} tabIndex={-1} ref={titleRef} data-testid={TEST_IDS.COMMENT_WINDOW_TITLE}>
              {view === 'identity' ? IDENTITY_COPY.title : <VisibleText text={heading.title} />}
            </h2>
            {heading.context !== null && (
              <p className="erf-comment-window__context">
                {/* The label and the path come from the page: tokens, not controls (M9). */}
                <bdi dir="ltr">
                  <VisibleText text={heading.context} />
                </bdi>
              </p>
            )}
            {heading.note !== null && view !== 'identity' && (
              <p className="erf-comment-note">
                <VisibleText text={heading.note} />
              </p>
            )}
          </div>
          {view === 'threads' && step !== null && (
            <>
              <CommentStepper step={step} onStep={stepTo} />
              <MoreActions items={moreActions} />
            </>
          )}
          <button type="button" className="erf-comment-icon-btn" aria-label={COPY.close} onClick={() => props.onClose()} data-testid={TEST_IDS.COMMENT_WINDOW_CLOSE}>
            {renderIcon('x', { size: 16, 'aria-hidden': true })}
          </button>
        </div>
        {view === 'identity' && (
          <IdentityStep
            noticeId={noticeId}
            initialName={identity?.authorName ?? ''}
            initialEmail={identity?.authorEmail ?? ''}
            onCancel={() => props.onClose()}
            onSubmit={async data => {
              const ok = await props.onSaveIdentity(data)
              if (ok) setIdentityAsked(false)
              return ok
            }}
          />
        )}
        {view === 'new' && request.kind === 'new' && (
          <NewCommentView
            request={request}
            authorName={identity?.authorName ?? ''}
            authorEmail={identity?.authorEmail ?? ''}
            textareaRef={textareaRef}
            onSave={(text, sel) => {
              const add = { panelId: request.panelId, op: 'add' as const, draftToken: request.draftToken, text }
              // A comment on the whole target sends the shipped one-argument call.
              return sel === undefined ? props.onSave(add) : props.onSave(add, sel)
            }}
            onSaveIdentity={props.onSaveIdentity}
            onIdentityRequired={() => setIdentityAsked(true)}
            onSaved={() =>
              props.onWritten({ panelId: request.panelId, op: 'add', draftToken: request.draftToken, text: '' }, request.file.displayPath)
            }
            onCancel={() => props.onClose()}
            onLeave={() => props.onClose(false)}
            onPickAgain={props.onPickAgain}
            onRetarget={props.onRetarget === undefined ? undefined : () => props.onRetarget?.(request)}
            onRefresh={props.onRefresh}
          />
        )}
        {view === 'threads' && selection !== null && !waiting && (
          <ThreadsView
            selection={selection}
            panelId={request.panelId}
            notVisible={notVisible}
            now={now}
            locale={props.locale}
            run={run}
            failure={failure}
            onCopy={props.onCopyRaw}
            onOpenInSource={line => props.onOpenInSource(selection.file.filePath, line)}
            onClose={() => props.onClose()}
            onNewComment={newComment !== null && !props.pausedText ? () => props.onNewComment?.(newComment) : undefined}
            pausedText={props.pausedText ?? null}
            session={session}
            onResolveAndNext={resolveAndNext}
            leadRef={leadRef}
          />
        )}
        {view === 'threads' && waiting && list.status === 'error' && (
          <div className="erf-comment-window__body">
            {/* M7: a list that failed is said, with the way on – never an endless "Reading". */}
            <p className="erf-comment-note" data-testid={TEST_IDS.COMMENT_WINDOW_READ_ERROR}>
              <VisibleText text={readErrorText(request.file?.displayPath ?? COPY.thisFile)} />
            </p>
            <div className="erf-comment-thread__actions">
              <DialogButton variant="secondary" onClick={props.onRefresh} testId={TEST_IDS.COMMENT_WINDOW_RETRY}>
                {COPY.tryAgain}
              </DialogButton>
            </div>
          </div>
        )}
        {view === 'threads' && waiting && list.status !== 'error' && (
          <div className="erf-comment-window__body">
            <p className="erf-comment-note" role="status">
              Reading comments…
            </p>
          </div>
        )}
      </CommentStepsContext.Provider>
    </CommentWindowShell>
  )
}

/** The docked window's dock for the thread shown now (C-18), memoized so placement does not re-run every render. */
function useDock(
  props: CommentWindowProps,
  threadKey: string | null,
  target: NounSource,
  line: number,
  noun: (target: NounSource) => string
): CommentDock | undefined {
  const { dock } = props
  const name = noun(target)
  return useMemo(
    () =>
      dock === undefined
        ? undefined
        : {
            anchor: () => dock.anchor(threadKey),
            ...(dock.column === undefined ? {} : { column: dock.column }),
            ...(dock.preview === undefined ? {} : { preview: dock.preview }),
            label: { noun: name, line }
          },
    [dock, threadKey, name, line]
  )
}

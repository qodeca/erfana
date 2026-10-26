// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the comment window
 * (docs/designs/html-preview-comments.md decision 4, §10.4, §10.7; R-003 –
 * R-008, R-013, R-018, R-019, R-022; docs/design-system/product/html-comments/
 * window.html and identity.html, status="proposed").
 *
 * ERFANA'S OWN WINDOW, over a still image of the page: the page cannot see it,
 * style it or type into it. It composes on `BaseDialog` (the Dialog
 * framework's rule), so it is on the dialog stack, `role="dialog"` +
 * `aria-modal="true"` with a real focus trap, takes Escape first, returns
 * focus to its opener, and registers the `dialog` occluder that freezes the
 * native page to its still while it is open.
 *
 * Its three views, in the one window (no stacked dialog, nothing lost):
 *
 * 1. **Before your first comment** – the identity step, shown on the first
 *    comment while the one-time privacy notice is unseen (also when the name
 *    is already set in Settings, then pre-filled – R-019), or when main says
 *    a name is needed.
 * 2. **New comment** – {@link NewCommentView}.
 * 3. **Comment(s) on {label}** / **Damaged comment** – {@link ThreadsView}.
 *
 * Focus: a new comment lands in the text field; a thread on the window title
 * (`tabindex="-1"`), so a screen reader starts at the top; on close it goes
 * back to the opener – the drawer row, or natively into the page (the
 * caller's `onClose`).
 *
 * Esc and an outside click back out of the newest INNER step first – an
 * edit, a delete confirmation, the inline identity editor – keeping its typed
 * text; only with no step open do they close the window (M6). Failures are
 * spoken from an always-mounted assertive region INSIDE the window: the
 * panel's regions sit outside the `aria-modal` subtree, where a screen reader
 * does not look while the dialog is open (H1).
 *
 * @module HtmlPreviewPanel/comments/CommentWindow
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderIcon } from '../../../../utils/iconRegistry'
import type {
  CommentSaveRequest,
  CommentSaveResult
} from '../../../../../../shared/ipc/preview-comment-schema'
import type { CommentIdentitySettings } from '../../../../../../shared/ipc/global-settings-schema'
import { ErrorCode } from '../../../../../../shared/errors'
import { BaseDialog } from '../../../Dialog/BaseDialog'
import { readZIndexToken } from '../../../../utils/overlayStack'
import type { CommentListState } from '../../../../stores/usePreviewCommentStore'
import {
  COPY,
  IDENTITY_COPY,
  frameFileText,
  readErrorText,
  saveFailureCopy,
  scriptBuiltText,
  threadsTitle,
  type SaveFailureCopy
} from './commentCopy'
import { ancestorTag, elementLabel } from './commentFormat'
import { CommentStepsContext, useLiveText, type CommentSteps } from './commentLive'
import { ActionButton, VisibleText } from './CommentParts'
import { placeCommentWindow, type Box, type WindowPlacement } from './commentPlacement'
import type { IdentityFormData } from './commentSchemas'
import type { CommentWindowRequest } from './commentWindowTypes'
import { IdentityStep } from './IdentityStep'
import { NewCommentView } from './NewCommentView'
import { ThreadsView, selectThreads } from './ThreadsView'
import './CommentWindow.css'
import { TEST_IDS } from '../../../../constants/testids'

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
  /** "New comment" in a pin's thread view: switch to a new comment on that element. */
  readonly onNewComment?: (request: Extract<CommentWindowRequest, { kind: 'new' }>) => void
  readonly onSaveIdentity: (identity: IdentityFormData) => Promise<boolean>
  readonly onSave: (request: CommentSaveRequest) => Promise<CommentSaveResult>
  /** A write landed: announce it and refresh the list. */
  readonly onWritten: (request: CommentSaveRequest, file: string) => void
  /** Refresh the list (a refusal that means the list is stale). */
  readonly onRefresh: () => void
  /** "Pick again" after an expired draft. */
  readonly onPickAgain: () => void
  readonly onOpenInSource: (filePath: string, line: number) => void
  readonly onCopyRaw: (text: string) => void
}

/** The window's heading for each view. */
interface Heading {
  readonly title: string
  readonly context: string | null
  readonly note: string | null
}

/**
 * The comment window.
 *
 * @param props - {@link CommentWindowProps}
 * @returns The dialog.
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
  const windowRef = useRef<HTMLDivElement>(null)
  const [identityAsked, setIdentityAsked] = useState(false)
  const [failure, setFailure] = useState<SaveFailureCopy | null>(null)
  const [placement, setPlacement] = useState<WindowPlacement | null>(null)
  const [alertText, alert] = useLiveText()
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
  // The dialog rung, read from the stylesheet: the Layering card forbids
  // mirroring a z-index token into TypeScript.
  const [zIndex] = useState(() => readZIndexToken('--z-dialog'))

  const needsIdentity =
    request.kind === 'new' &&
    (identityAsked || identity === null || !identity.identityNoticeSeen || !identity.authorName)
  const view: 'identity' | 'new' | 'threads' = needsIdentity ? 'identity' : request.kind

  const selection =
    request.kind === 'threads'
      ? selectThreads(list.files, request.fileKey, request.threadKeys, request.blockKeys)
      : null
  const selectionEmpty =
    selection !== null &&
    selection.threads.length + selection.damaged.length + selection.newer.length === 0

  // A thread deleted from here, or a file gone: nothing left to show.
  const { onClose } = props
  const dismiss = useCallback(() => {
    const top = steps.current[steps.current.length - 1]
    if (top) top()
    else onClose()
  }, [onClose])
  useEffect(() => {
    if (request.kind !== 'threads' || list.status !== 'ready') return
    if (selection === null || selectionEmpty) onClose()
  }, [request.kind, list.status, selection, selectionEmpty, onClose])

  // Focus moves into the field when the identity step hands over.
  const previousView = useRef(view)
  useEffect(() => {
    if (previousView.current === 'identity' && view === 'new') textareaRef.current?.focus()
    previousView.current = view
  }, [view])

  // Placement: measure the natural size, then place; again on a resize.
  const { getArea } = props
  const point = request.point
  const place = useCallback(() => {
    const element = windowRef.current
    const area = getArea()
    if (!element || !area) return
    setPlacement(
      placeCommentWindow(
        point,
        { width: element.offsetWidth, height: element.offsetHeight },
        area,
        window.innerHeight
      )
    )
  }, [getArea, point])
  useLayoutEffect(() => {
    place()
  }, [place, view])

  // Tag BaseDialog's overlay so CommentWindow.css can make it transparent
  // (see the stylesheet: BaseDialog takes no overlay class). React never
  // rewrites the overlay's className, whose prop is a constant.
  useLayoutEffect(() => {
    const overlay = windowRef.current?.closest('.dialog-overlay')
    overlay?.classList.add('erf-comment-layer')
  }, [])
  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])

  const run = useCallback(
    async (save: CommentSaveRequest): Promise<boolean> => {
      setFailure(null)
      const result = await props.onSave(save)
      const file = selection?.file.displayPath ?? ''
      if (result.ok) {
        props.onWritten(save, file)
        return true
      }
      const copy = saveFailureCopy(result.code, file)
      setFailure(copy)
      alert(copy.text)
      // The list is stale: read it again so the next try uses fresh hashes.
      if (
        result.code === ErrorCode.COMMENT_BLOCK_CHANGED ||
        result.code === ErrorCode.COMMENT_KEY_INVALID
      ) {
        props.onRefresh()
      }
      return false
    },
    [props, selection, alert]
  )

  const heading = headingOf(request, selection)
  const newComment = props.onNewComment ? newCommentFrom(request, selection) : null
  const style: React.CSSProperties =
    placement === null
      ? { visibility: 'hidden', left: 0, top: 0 }
      : placement.kind === 'sheet'
        ? {
            left: placement.left,
            width: placement.width,
            bottom: placement.bottom,
            maxHeight: placement.maxHeight
          }
        : {
            left: placement.left,
            top: placement.top,
            maxWidth: placement.maxWidth,
            maxHeight: placement.maxHeight
          }

  const initialFocusRef = view === 'threads' ? titleRef : view === 'new' ? textareaRef : undefined

  return (
    <BaseDialog
      isOpen
      onClose={dismiss}
      zIndex={zIndex}
      className="erf-comment-shell"
      ariaLabelledBy={titleId}
      ariaDescribedBy={view === 'identity' ? noticeId : undefined}
      initialFocusRef={initialFocusRef}
    >
      <div
        ref={windowRef}
        className={`erf-comment-window${placement?.kind === 'sheet' ? ' erf-comment-window--sheet' : ''}`}
        style={style}
        data-testid={TEST_IDS.COMMENT_WINDOW}
        data-view={view}
      >
        <CommentStepsContext.Provider value={stepsValue}>
        {/* Always mounted, empty until a failure: see the module comment. */}
        <p className="erf-comment-sr" aria-live="assertive" data-testid={TEST_IDS.COMMENT_WINDOW_ALERT}>
          {alertText}
        </p>
        <div className="erf-comment-window__head">
          <div className="erf-comment-window__heading">
            <h2
              className="erf-comment-window__title"
              id={titleId}
              tabIndex={-1}
              ref={titleRef}
              data-testid={TEST_IDS.COMMENT_WINDOW_TITLE}
            >
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
              <p className="erf-comment-note">{heading.note}</p>
            )}
          </div>
          <button
            type="button"
            className="erf-comment-icon-btn"
            aria-label={COPY.close}
            onClick={() => props.onClose()}
            data-testid={TEST_IDS.COMMENT_WINDOW_CLOSE}
          >
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
            onSave={text =>
              props.onSave({
                panelId: request.panelId,
                op: 'add',
                draftToken: request.draftToken,
                text
              })
            }
            onSaveIdentity={props.onSaveIdentity}
            onIdentityRequired={() => setIdentityAsked(true)}
            onSaved={() =>
              props.onWritten(
                { panelId: request.panelId, op: 'add', draftToken: request.draftToken, text: '' },
                request.file.displayPath
              )
            }
            onCancel={() => props.onClose()}
            onLeave={() => props.onClose(false)}
            onPickAgain={props.onPickAgain}
          />
        )}
        {view === 'threads' && selection !== null && (
          <ThreadsView
            selection={selection}
            panelId={request.panelId}
            notVisible={new Set(props.notVisible)}
            now={now}
            locale={props.locale}
            run={run}
            failure={failure}
            onCopy={props.onCopyRaw}
            onOpenInSource={line => props.onOpenInSource(selection.file.filePath, line)}
            onClose={() => props.onClose()}
            onNewComment={newComment !== null ? () => props.onNewComment?.(newComment) : undefined}
          />
        )}
        {view === 'threads' && selection === null && list.status === 'error' && (
          <div className="erf-comment-window__body">
            {/* M7: a list that failed is said, with the way on – never an endless "Reading". */}
            <p className="erf-comment-note" data-testid={TEST_IDS.COMMENT_WINDOW_READ_ERROR}>
              {readErrorText(request.file?.displayPath ?? COPY.thisFile)}
            </p>
            <div className="erf-comment-thread__actions">
              <ActionButton onClick={props.onRefresh} testId={TEST_IDS.COMMENT_WINDOW_RETRY}>
                {COPY.tryAgain}
              </ActionButton>
            </div>
          </div>
        )}
        {view === 'threads' && selection === null && list.status !== 'error' && (
          <div className="erf-comment-window__body">
            <p className="erf-comment-note" role="status">
              Reading comments…
            </p>
          </div>
        )}
        </CommentStepsContext.Provider>
      </div>
    </BaseDialog>
  )
}

/**
 * The new-comment request "New comment" in a pin's thread view opens: a new
 * thread on the element the pin stands for, with the draft and the target
 * main sent with the pin – the target is main's description of the element
 * as it is in the file now, so the context line names it exactly as a
 * right-click would. `null` when there is no such draft (a drawer row, or
 * main sent none) or the file is read-only.
 *
 * @param request - The window's request.
 * @param selection - What the list holds for it.
 * @returns The request, or `null`.
 */
export function newCommentFrom(
  request: CommentWindowRequest,
  selection: ReturnType<typeof selectThreads>
): Extract<CommentWindowRequest, { kind: 'new' }> | null {
  if (request.kind !== 'threads') return null
  const { draftToken, file, target } = request
  if (draftToken === undefined || file === undefined || target === undefined) return null
  if (selection === null || !selection.file.writable) return null
  return {
    kind: 'new',
    panelId: request.panelId,
    draftToken,
    target,
    file,
    point: request.point,
    opener: request.opener
  }
}

/** The title, context line and note for a request (§10.10 "Window titles", "Context line"). */
function headingOf(
  request: CommentWindowRequest,
  selection: ReturnType<typeof selectThreads>
): Heading {
  if (request.kind === 'new') {
    const { target, file } = request
    const label = target.runtime ? target.runtime.tag : elementLabel(target)
    const note = target.runtime
      ? scriptBuiltText(ancestorTag(target))
      : file.frame
        ? frameFileText(file.displayPath)
        : null
    return {
      title: COPY.newComment,
      context: `${label} · ${file.displayPath}, line ${target.line}`,
      note
    }
  }
  if (selection === null) return { title: 'Comments', context: null, note: null }
  const file = selection.file.displayPath
  const first = selection.threads[0]
  if (first === undefined) {
    const line = selection.damaged[0]?.line ?? selection.newer[0]?.line ?? 1
    return { title: COPY.damagedComment, context: `${file}, line ${line}`, note: null }
  }
  const label = first.runtime ? first.runtime.tag : elementLabel(first)
  return {
    title: threadsTitle(label, selection.threads.length),
    context: `${label} · ${file}, line ${first.line}`,
    note: selection.file.frame ? frameFileText(file) : null
  }
}

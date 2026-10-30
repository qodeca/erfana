// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the comment window's view of existing comments, in both previews
 * (docs/designs/comments/html-preview-comments.md §7.7, §10.4, decisions 8,
 * 12, 30, 31; spec 024 state table S-01 – S-09, W-03 – W-05, W-11;
 * comments-v2 C-05, C-06, C-13, C-14, R-06, R-21;
 * docs/designs/comments/comments-v2/window.html).
 *
 * Opened by an icon (any mode) or a drawer row. Main sent opaque keys only;
 * the content comes from the list, read from disk – text and emails never
 * cross into the page (§4.1 B5).
 *
 * - Threads in file order; resolved ones folded.
 * - **Every open thread keeps Reply and Resolve** (C-05), whatever its state.
 *   Not found, Changed and Words changed say so above it (`ThreadStatus`), and
 *   Resolve leads there – primary and focused (S-03 – S-05).
 * - **Damaged** blocks are read-only and never overwritten (decision 12,
 *   `DamagedBlockView`, with Rebuild from data… – OD-05); **newer format**
 *   blocks are shown, never changed.
 * - **Not visible now** (decision 30) is a banner, the thread still usable.
 * - A **read-only file** or **paused** comments state their reason up front
 *   and offer no writes.
 * - **Updated from the file** (W-03): an info strip, and a "New since you
 *   opened" divider above messages that arrived meanwhile.
 * - **Removed while open** (W-04): the last thread shown stays, read-only,
 *   with Copy text and New comment on this {kind}.
 * - **Stepper foot** (C-13, R-06): with the stepper and one open thread the
 *   foot is Close, then Resolve and next; with several open threads Close
 *   only, each thread keeping its own Resolve (R-21). Open in source and New
 *   comment are then in the head's More actions (the window draws the head).
 * - **All done** (W-11): "All open comments are resolved", Close focused.
 *
 * @module HtmlPreviewPanel/comments/ThreadsView
 */
import { useMemo, useState } from 'react'
import type {
  CommentFileView,
  CommentThreadView
} from '../../../../shared/ipc/preview-comment-schema'
import { commentDrafts } from '../../stores/usePreviewCommentStore'
import { COPY, type SaveFailureCopy } from './commentCopy'
import { useCommentWords } from './commentWords'
import { visibleString } from './commentFormat'
import { replyDraftKey } from './commentLive'
import { CommentBanner, DialogButton } from './CommentParts'
import {
  CommentThread,
  ResolvedThread,
  type FocusAfter,
  type RunCommentOp,
  type ThreadContext
} from './CommentThread'
import { DamagedBlockView } from './DamagedBlockView'
import { ThreadStatus } from './ThreadStatus'
import { WINDOW_COPY } from './commentWindowCopy'
import { resolveLeads, threadStateOf, type StepPosition } from './commentWindowStates'
import { TEST_IDS } from '../../constants/testids'

type DamagedBlock = CommentFileView['damaged'][number]
type NewerBlock = CommentFileView['newer'][number]

/** What the window found in the list for its keys. */
export interface ThreadsSelection {
  readonly file: CommentFileView
  readonly threads: readonly CommentThreadView[]
  readonly damaged: readonly DamagedBlock[]
  readonly newer: readonly NewerBlock[]
}

/**
 * Finds the comments an icon or a row named.
 *
 * @param files - The list's files.
 * @param fileKey - The file the keys belong to.
 * @param threadKeys - Thread keys.
 * @param blockKeys - Damaged or newer block keys.
 * @returns The selection, or `null` when the file is not in the list (any more).
 */
export function selectThreads(
  files: readonly CommentFileView[],
  fileKey: string,
  threadKeys: readonly string[],
  blockKeys: readonly string[]
): ThreadsSelection | null {
  const file = files.find(f => f.fileKey === fileKey)
  if (!file) return null
  const wanted = new Set(threadKeys)
  const blocks = new Set(blockKeys)
  return {
    file,
    // File order is the list's order.
    threads: file.threads.filter(t => wanted.has(t.threadKey)),
    damaged: file.damaged.filter(b => blocks.has(b.blockKey)),
    newer: file.newer.filter(b => blocks.has(b.blockKey))
  }
}

/** What the window tells the view about its session (C-13, C-14). */
export interface ThreadsSessionView {
  /** The stepper is shown (C-13). */
  readonly step: StepPosition | null
  /** W-11. */
  readonly allDone: boolean
  /** W-03. */
  readonly updated: boolean
  /** W-04: the shown threads were removed outside Erfana. */
  readonly removed: boolean
  readonly seen: ReadonlyMap<string, ReadonlySet<string>>
}

/** Props for {@link ThreadsView}. */
export interface ThreadsViewProps {
  readonly selection: ThreadsSelection
  readonly panelId: string
  readonly notVisible: ReadonlySet<string>
  readonly now: Date
  readonly locale?: string
  readonly run: RunCommentOp
  /** The last refused write, shown above the threads. */
  readonly failure: SaveFailureCopy | null
  readonly onCopy: (text: string) => void
  readonly onOpenInSource: (line: number) => void
  readonly onClose: () => void
  /** An icon's draft is there: "New comment" adds a thread on the same target. */
  readonly onNewComment?: () => void
  /**
   * Comments are paused (Markdown, unsaved editor edits – 024-FR-015, F-02):
   * every write is off, as for a read-only file, and this sentence says why.
   */
  readonly pausedText?: string | null
  /** The window's session; absent – the shipped single view. */
  readonly session?: ThreadsSessionView
  /** "Resolve and next" (C-13): the window resolves the thread and steps on. */
  readonly onResolveAndNext?: (thread: CommentThreadView) => void
  /** Takes the control the window focuses first: the leading Resolve, or Close when all is done. */
  readonly leadRef?: React.Ref<HTMLButtonElement>
}

/** The newer-format block: shown, never changed (S-09). */
function NewerBlockView({ block, onOpenInSource }: { readonly block: NewerBlock; readonly onOpenInSource: (line: number) => void }): React.JSX.Element {
  return (
    <section className="erf-comment-thread" aria-label={COPY.newerTag} data-testid={TEST_IDS.COMMENT_NEWER}>
      <CommentBanner kind="info" title={COPY.newerTag}>
        {COPY.newerText}
      </CommentBanner>
      <div className="erf-comment-thread__actions">
        <DialogButton variant="secondary" onClick={() => onOpenInSource(block.line)}>
          {COPY.openInSource}
        </DialogButton>
      </div>
    </section>
  )
}

/** The text W-04's Copy text puts on the clipboard: the typed reply, else the thread's messages. */
function removedText(panelId: string, file: CommentFileView, threads: readonly CommentThreadView[]): string {
  const replies = threads.map(t => commentDrafts.get(replyDraftKey(panelId, file.fileKey, t.threadKey))).filter(text => text !== '')
  if (replies.length > 0) return replies.join('\n\n')
  return threads.flatMap(t => t.messages.map(m => m.text)).join('\n\n')
}

/**
 * The body and foot of the threads view.
 *
 * @param props - {@link ThreadsViewProps}
 * @returns The threads, blocks and banners.
 */
export function ThreadsView(props: ThreadsViewProps): React.JSX.Element {
  const { selection, panelId, notVisible, now, locale, run, failure, onCopy, onOpenInSource, onClose, onNewComment, session } = props
  const pausedText = props.pausedText ?? null
  const words = useCommentWords()
  const { file, threads, damaged, newer } = selection
  // A file name is the page author's: every sentence built from it shows its
  // bidi and invisible characters as `⟨U+202E⟩` tokens (S-L-B).
  const fileName = visibleString(file.displayPath)
  const sharedNames = useMemo(() => {
    const emailsByName = new Map<string, Set<string>>()
    for (const thread of threads) {
      for (const message of thread.messages) {
        const set = emailsByName.get(message.by.name) ?? new Set<string>()
        set.add(message.by.email ?? '')
        emailsByName.set(message.by.name, set)
      }
    }
    return new Set([...emailsByName].filter(([, emails]) => emails.size > 1).map(([name]) => name))
  }, [threads])

  const removed = session?.removed === true
  const open = threads.filter(t => t.status !== 'resolved')
  const step = removed ? null : (session?.step ?? null)
  // R-06: the stepper over one open thread moves its Resolve to the foot; R-21: several keep their own.
  const stepFoot = step !== null && open.length === 1
  const [focusAfter, setFocusAfter] = useState<FocusAfter | null>(null)
  const ctx: ThreadContext = {
    panelId,
    fileKey: file.fileKey,
    file: fileName,
    readOnly: !file.writable || pausedText !== null || removed,
    now,
    locale,
    sharedNames,
    replyIsPrimary: open.length === 1,
    run,
    focusAfter,
    setFocusAfter,
    stepFoot,
    seen: session?.seen,
    updated: session?.updated
  }
  const firstLine = threads[0]?.line ?? damaged[0]?.line ?? newer[0]?.line ?? 1
  const states = threads.map(t => threadStateOf(t, notVisible))
  // The first thread whose Resolve leads takes the window's first focus (S-03 – S-05).
  const leadAt = states.findIndex(resolveLeads)
  const anyNotVisible = states.some(state => state === 'not-visible')
  const single = open[0]
  const singleLeads = single !== undefined && resolveLeads(threadStateOf(single, notVisible))

  return (
    <>
      <div className="erf-comment-window__body">
        {failure !== null && (
          <CommentBanner kind={failure.action === 'pending' || failure.action === 'notice' ? 'info' : 'error'} testId={TEST_IDS.COMMENT_SAVE_ERROR}>
            {failure.text}
          </CommentBanner>
        )}
        {removed && (
          <CommentBanner kind="info" testId={TEST_IDS.COMMENT_REMOVED}>
            {WINDOW_COPY.removed(fileName)}
          </CommentBanner>
        )}
        {!removed && (!file.writable || pausedText !== null) && (
          <CommentBanner kind="info" testId={TEST_IDS.COMMENT_READ_ONLY}>
            {pausedText ?? words.readOnlyReasonText(file.readOnlyReason, fileName)}
          </CommentBanner>
        )}
        {session?.updated === true && !removed && (
          <div role="status" data-testid={TEST_IDS.COMMENT_UPDATED}>
            <CommentBanner kind="info">{WINDOW_COPY.updated(fileName)}</CommentBanner>
          </div>
        )}
        {anyNotVisible && (
          <CommentBanner kind="info" testId={TEST_IDS.COMMENT_NOT_VISIBLE}>
            {words.notVisibleText(threads[states.indexOf('not-visible')] ?? '')}
          </CommentBanner>
        )}
        {threads.map((thread, i) => (
          <div key={thread.threadKey}>
            <ThreadStatus
              thread={thread}
              state={states[i]}
              fileName={fileName}
              hidden={thread.notVisible || notVisible.has(thread.threadKey)}
            />
            {thread.status === 'resolved' ? (
              <ResolvedThread ctx={ctx} thread={thread} />
            ) : (
              <CommentThread
                ctx={ctx}
                thread={thread}
                resolveLeads={resolveLeads(states[i])}
                resolveRef={i === leadAt && !stepFoot ? props.leadRef : undefined}
              />
            )}
          </div>
        ))}
        {damaged.map(block => (
          <DamagedBlockView key={block.blockKey} block={block} file={file} panelId={panelId} run={run} onCopy={onCopy} onOpenInSource={onOpenInSource} />
        ))}
        {newer.map(block => (
          <NewerBlockView key={block.blockKey} block={block} onOpenInSource={onOpenInSource} />
        ))}
        {session?.allDone === true && (
          <p className="erf-comment-done" role="status" data-testid={TEST_IDS.COMMENT_ALL_DONE}>
            {WINDOW_COPY.allDone}
          </p>
        )}
      </div>
      <div className="erf-comment-window__foot">
        {removed ? (
          <span className="erf-comment-window__foot-end">
            <DialogButton variant="secondary" onClick={() => onCopy(removedText(panelId, file, threads))} testId={TEST_IDS.COMMENT_COPY_TEXT}>
              {WINDOW_COPY.copyText}
            </DialogButton>
            {onNewComment !== undefined && (
              <DialogButton variant="secondary" onClick={onNewComment} testId={TEST_IDS.COMMENT_NEW_ON_ELEMENT}>
                {WINDOW_COPY.newCommentOn(words.noun(threads[0] ?? ''))}
              </DialogButton>
            )}
            <DialogButton variant="secondary" onClick={onClose} testId={TEST_IDS.COMMENT_CLOSE}>
              {COPY.close}
            </DialogButton>
          </span>
        ) : step !== null ? (
          <span className="erf-comment-window__foot-end">
            <DialogButton variant="secondary" onClick={onClose} testId={TEST_IDS.COMMENT_CLOSE}>
              {COPY.close}
            </DialogButton>
            {stepFoot && !ctx.readOnly && single !== undefined && props.onResolveAndNext !== undefined && (
              <DialogButton
                variant={singleLeads ? 'primary' : 'secondary'}
                buttonRef={singleLeads ? props.leadRef : undefined}
                onClick={() => props.onResolveAndNext?.(single)}
                testId={TEST_IDS.COMMENT_RESOLVE_NEXT}
              >
                {WINDOW_COPY.resolveAndNext}
              </DialogButton>
            )}
          </span>
        ) : (
          <>
            <span className="erf-comment-window__foot-start">
              <DialogButton variant="secondary" onClick={() => onOpenInSource(firstLine)} testId={TEST_IDS.COMMENT_OPEN_IN_SOURCE}>
                {COPY.openInSource}
              </DialogButton>
            </span>
            {/* One group, so a narrow window wraps it whole onto a second row rather than strand Close alone. */}
            <span className="erf-comment-window__foot-end">
              {onNewComment !== undefined && session?.allDone !== true && (
                <DialogButton variant="secondary" onClick={onNewComment} testId={TEST_IDS.COMMENT_NEW_ON_ELEMENT}>
                  {COPY.newComment}
                </DialogButton>
              )}
              <DialogButton
                variant="secondary"
                buttonRef={session?.allDone === true ? props.leadRef : undefined}
                onClick={onClose}
                testId={TEST_IDS.COMMENT_CLOSE}
              >
                {COPY.close}
              </DialogButton>
            </span>
          </>
        )}
      </div>
    </>
  )
}

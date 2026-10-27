// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the comment window's view of existing comments
 * (docs/designs/html-preview-comments.md §7.7, §10.4, decisions 8, 12, 30,
 * 31; R-004, R-005, R-006; docs/design-system/product/html-comments/window.html
 * "A thread" and "When the comment cannot be used normally").
 *
 * Opened by a pin (any mode) or a drawer row. Main sent opaque keys only; the
 * content comes from the list (`preview:commentList`), read from disk – text
 * and emails never cross into the page (§4.1 B5).
 *
 * - Threads in file order; resolved ones folded.
 * - **Damaged** blocks are read-only and never overwritten (decision 12):
 *   the raw text in a read-only well, Copy raw text, Open in source, and
 *   Delete block… where main allows it (a terminated block in a writable
 *   file); conflict markers get their own wording.
 * - **Newer format** blocks are shown, never changed.
 * - **Not found** (the element left the file) and **not visible now** (a
 *   hidden slide, decision 30) are banners, the thread itself still usable.
 * - A **read-only file** states its reason up front and offers no writes.
 *
 * @module HtmlPreviewPanel/comments/ThreadsView
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  CommentFileView,
  CommentThreadView
} from '../../../../../../shared/ipc/preview-comment-schema'
import {
  COPY,
  deleteBlockText,
  notFoundText,
  readOnlyReasonText,
  type SaveFailureCopy
} from './commentCopy'
import { visibleString } from './commentFormat'
import { ActionButton, CommentBanner, DialogButton, VisibleText } from './CommentParts'
import {
  CommentThread,
  ResolvedThread,
  type FocusAfter,
  type RunCommentOp,
  type ThreadContext
} from './CommentThread'
import { useInnerStep } from './commentLive'
import { TEST_IDS } from '../../../../constants/testids'

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
 * Finds the comments a pin or a row named.
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

/**
 * What a lost element said, struck through: shown under "Erfana can't find
 * this element any more" when the block stored a quote
 * (docs/designs/html-preview-comments.md §10.10 "It was attached to:").
 * Plain React text.
 *
 * @param props - The thread.
 * @returns The quote, or nothing when the thread has none.
 */
function QuoteOf({ thread }: { readonly thread: CommentThreadView }): React.JSX.Element | null {
  const { quote } = thread
  if (quote === undefined || quote.trim() === '') return null
  return (
    <>
      <span className="erf-comment-quote-label">{COPY.attachedTo}</span>
      <s className="erf-comment-quote" dir="auto" data-testid={TEST_IDS.COMMENT_NOT_FOUND_QUOTE}>
        <VisibleText text={quote} />
      </s>
    </>
  )
}

/** Props for {@link DamagedBlockView}. */
interface DamagedBlockProps {
  readonly block: DamagedBlock
  readonly file: CommentFileView
  readonly panelId: string
  readonly run: RunCommentOp
  readonly onCopy: (text: string) => void
  readonly onOpenInSource: (line: number) => void
}

/** One damaged block: why, the raw text, and what may be done with it. */
function DamagedBlockView({
  block,
  file,
  panelId,
  run,
  onCopy,
  onOpenInSource
}: DamagedBlockProps): React.JSX.Element {
  const labelId = useId()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  // Set when the confirmation is left by hand: focus goes back to "Delete block…".
  const focusDelete = useRef(false)
  const conflict = block.reason === 'conflict-marker'
  // Main deletes a damaged block only when it is terminated and the file is
  // writable (§7.6 step 6); an unterminated block or a conflict is fixed in source.
  const deletable = file.writable && !conflict && block.reason !== 'unterminated'
  useEffect(() => {
    if (confirm) cancelRef.current?.focus()
    else if (focusDelete.current) {
      focusDelete.current = false
      deleteRef.current?.focus()
    }
  }, [confirm])
  const leaveConfirm = (): void => {
    focusDelete.current = true
    setConfirm(false)
  }
  // Esc backs out of the confirmation before it closes the window.
  useInnerStep(confirm, leaveConfirm)

  return (
    <section
      className="erf-comment-thread"
      aria-label={`Damaged comment, line ${block.line}`}
      data-testid={TEST_IDS.COMMENT_DAMAGED}
    >
      <CommentBanner kind="warning">
        {conflict ? COPY.conflictText : COPY.damagedText}
      </CommentBanner>
      <span className="erf-comment-raw-label" id={labelId}>
        {COPY.rawLabel}
      </span>
      {/* Focusable because it scrolls. Plain text: React escapes it. */}
      <pre
        className="erf-comment-raw"
        tabIndex={0}
        aria-labelledby={labelId}
        data-testid={TEST_IDS.COMMENT_DAMAGED_RAW}
      >
        {block.raw}
      </pre>
      {confirm ? (
        <div className="erf-comment-confirm" role="group" aria-label="Confirm delete">
          <p className="erf-comment-confirm__text">
            <VisibleText text={deleteBlockText(file.displayPath)} />
          </p>
          <div className="erf-comment-confirm__actions">
            <DialogButton
              variant="secondary"
              buttonRef={cancelRef}
              onClick={leaveConfirm}
            >
              {COPY.cancel}
            </DialogButton>
            <DialogButton
              variant="danger"
              busy={busy}
              testId={TEST_IDS.COMMENT_DELETE_BLOCK_CONFIRM}
              onClick={() => {
                if (busy) return
                setBusy(true)
                void run({
                  panelId,
                  op: 'deleteBlock',
                  fileKey: file.fileKey,
                  blockKey: block.blockKey,
                  rawHash: block.rawHash
                }).then(() => {
                  setBusy(false)
                  leaveConfirm()
                })
              }}
            >
              {COPY.deleteBlock}
            </DialogButton>
          </div>
        </div>
      ) : (
        <div className="erf-comment-thread__actions">
          <ActionButton onClick={() => onCopy(block.raw)}>{COPY.copyRaw}</ActionButton>
          <ActionButton onClick={() => onOpenInSource(block.line)}>
            {COPY.openInSource}
          </ActionButton>
          {deletable && (
            <ActionButton
              buttonRef={deleteRef}
              onClick={() => setConfirm(true)}
              testId={TEST_IDS.COMMENT_DELETE_BLOCK}
            >
              {COPY.deleteBlockAction}
            </ActionButton>
          )}
        </div>
      )}
    </section>
  )
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
  /** A pin's draft is there: "New comment" adds a thread on the same element. */
  readonly onNewComment?: () => void
}

/**
 * The body and foot of the threads view.
 *
 * @param props - {@link ThreadsViewProps}
 * @returns The threads, blocks and banners.
 */
export function ThreadsView({
  selection,
  panelId,
  notVisible,
  now,
  locale,
  run,
  failure,
  onCopy,
  onOpenInSource,
  onClose,
  onNewComment
}: ThreadsViewProps): React.JSX.Element {
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

  const [focusAfter, setFocusAfter] = useState<FocusAfter | null>(null)
  const ctx: ThreadContext = {
    panelId,
    fileKey: file.fileKey,
    file: fileName,
    readOnly: !file.writable,
    now,
    locale,
    sharedNames,
    run,
    focusAfter,
    setFocusAfter
  }
  const firstLine = threads[0]?.line ?? damaged[0]?.line ?? newer[0]?.line ?? 1
  const anyNotVisible = threads.some(
    t => t.attached && (t.notVisible || notVisible.has(t.threadKey))
  )

  return (
    <>
      <div className="erf-comment-window__body">
        {failure !== null && (
          <CommentBanner
            kind={failure.action === 'pending' ? 'info' : 'error'}
            testId={TEST_IDS.COMMENT_SAVE_ERROR}
          >
            {failure.text}
          </CommentBanner>
        )}
        {!file.writable && (
          <CommentBanner kind="info" testId={TEST_IDS.COMMENT_READ_ONLY}>
            {readOnlyReasonText(file.readOnlyReason, fileName)}
          </CommentBanner>
        )}
        {anyNotVisible && (
          <CommentBanner kind="info" testId={TEST_IDS.COMMENT_NOT_VISIBLE}>
            {COPY.notVisibleText}
          </CommentBanner>
        )}
        {threads.map(thread => (
          <div key={thread.threadKey}>
            {!thread.attached && (
              <CommentBanner kind="warning" testId={TEST_IDS.COMMENT_NOT_FOUND}>
                {notFoundText(fileName, thread.line)}
                <QuoteOf thread={thread} />
              </CommentBanner>
            )}
            {thread.status === 'resolved' ? (
              <ResolvedThread ctx={ctx} thread={thread} />
            ) : (
              <CommentThread ctx={ctx} thread={thread} />
            )}
          </div>
        ))}
        {damaged.map(block => (
          <DamagedBlockView
            key={block.blockKey}
            block={block}
            file={file}
            panelId={panelId}
            run={run}
            onCopy={onCopy}
            onOpenInSource={onOpenInSource}
          />
        ))}
        {newer.map(block => (
          <section
            key={block.blockKey}
            className="erf-comment-thread"
            aria-label={COPY.newerTag}
            data-testid={TEST_IDS.COMMENT_NEWER}
          >
            <CommentBanner kind="info" title={COPY.newerTag}>
              {COPY.newerText}
            </CommentBanner>
            <div className="erf-comment-thread__actions">
              <ActionButton onClick={() => onOpenInSource(block.line)}>
                {COPY.openInSource}
              </ActionButton>
            </div>
          </section>
        ))}
      </div>
      <div className="erf-comment-window__foot">
        <span className="erf-comment-window__foot-start">
          <ActionButton onClick={() => onOpenInSource(firstLine)} testId={TEST_IDS.COMMENT_OPEN_IN_SOURCE}>
            {COPY.openInSource}
          </ActionButton>
        </span>
        {onNewComment !== undefined && (
          <DialogButton variant="secondary" onClick={onNewComment} testId={TEST_IDS.COMMENT_NEW_ON_ELEMENT}>
            {COPY.newComment}
          </DialogButton>
        )}
        <DialogButton variant="secondary" onClick={onClose} testId={TEST_IDS.COMMENT_CLOSE}>
          {COPY.close}
        </DialogButton>
      </div>
    </>
  )
}

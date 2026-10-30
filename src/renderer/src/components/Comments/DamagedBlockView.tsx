// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – one damaged comment in the comment window
 * (docs/designs/comments/html-preview-comments.md decision 12; spec 024 state
 * table S-07, S-08; comments-v2 OD-05 § 4.1).
 *
 * Read-only and never overwritten without a user action (024-FR-014): why,
 * the raw text in a read-only well, Copy raw text, Open in source, and Delete
 * damaged comment… where main allows it (a terminated block in a writable
 * file). Conflict markers get their own wording and no delete.
 *
 * **Rebuild from data…** (OD-05) is offered only when main says the block's
 * `@data` is valid and only its readable lines or header id disagree with it
 * (`readable-mismatch`, `id-mismatch`). It opens an inline confirmation
 * listing each differing line – "The file says" / "The data says". When only
 * the `status:` line differs there are two choices instead: Mark resolved
 * (writes the status the line claims) and Keep open (re-renders the line from
 * `@data`); both are secondary and focus starts on Cancel (R-08). `@data`
 * itself is never changed by a rebuild.
 *
 * @module components/Comments/DamagedBlockView
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { CommentFileView } from '../../../../shared/ipc/comment-common-schema'
import { TEST_IDS } from '../../constants/testids'
import { COPY } from './commentCopy'
import { useInnerStep } from './commentLive'
import { CommentBanner, DialogButton, VisibleText } from './CommentParts'
import type { RunCommentOp } from './CommentThread'
import { WINDOW_COPY } from './commentWindowCopy'
import { useCommentWords } from './commentWords'

type DamagedBlock = CommentFileView['damaged'][number]

/** Props for {@link DamagedBlockView}. */
export interface DamagedBlockProps {
  readonly block: DamagedBlock
  readonly file: CommentFileView
  readonly panelId: string
  readonly run: RunCommentOp
  readonly onCopy: (text: string) => void
  readonly onOpenInSource: (line: number) => void
}

/** The inline step a damaged block has open. */
type Step = 'none' | 'delete' | 'rebuild'

/** The OD-05 confirmation: the lines that differ, and the choices. */
function RebuildConfirm({
  block,
  busy,
  cancelRef,
  onCancel,
  onRebuild
}: {
  readonly block: DamagedBlock
  readonly busy: boolean
  readonly cancelRef: React.RefObject<HTMLButtonElement>
  readonly onCancel: () => void
  readonly onRebuild: (status?: 'open' | 'resolved') => void
}): React.JSX.Element | null {
  const introId = useId()
  const rebuild = block.rebuild
  if (rebuild === undefined) return null
  const statusOnly = rebuild.claims !== undefined
  return (
    <div className="erf-comment-confirm erf-comment-rebuild" role="group" aria-labelledby={introId} data-testid={TEST_IDS.COMMENT_REBUILD_CONFIRM}>
      <p className="erf-comment-confirm__text" id={introId}>
        {WINDOW_COPY.rebuildIntro}
      </p>
      <dl className="erf-comment-rebuild__lines">
        {rebuild.lines.map((line, i) => (
          <div key={i} className="erf-comment-rebuild__pair">
            <dt>{WINDOW_COPY.fileSays}</dt>
            <dd dir="auto">
              <VisibleText text={line.file} />
            </dd>
            <dt>{WINDOW_COPY.dataSays}</dt>
            <dd dir="auto">
              <VisibleText text={line.data} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="erf-comment-confirm__actions">
        <DialogButton variant="secondary" buttonRef={cancelRef} onClick={onCancel}>
          {COPY.cancel}
        </DialogButton>
        {statusOnly ? (
          <>
            <DialogButton variant="secondary" busy={busy} onClick={() => onRebuild('open')} testId={TEST_IDS.COMMENT_REBUILD_KEEP_OPEN}>
              {WINDOW_COPY.keepOpen}
            </DialogButton>
            <DialogButton variant="secondary" busy={busy} onClick={() => onRebuild('resolved')} testId={TEST_IDS.COMMENT_REBUILD_MARK_RESOLVED}>
              {WINDOW_COPY.markResolved}
            </DialogButton>
          </>
        ) : (
          <DialogButton variant="primary" busy={busy} onClick={() => onRebuild()} testId={TEST_IDS.COMMENT_REBUILD_RUN}>
            {WINDOW_COPY.rebuild}
          </DialogButton>
        )}
      </div>
    </div>
  )
}

/**
 * One damaged block: why, the raw text, and what may be done with it.
 *
 * @param props - {@link DamagedBlockProps}
 * @returns The block's section.
 */
export function DamagedBlockView({ block, file, panelId, run, onCopy, onOpenInSource }: DamagedBlockProps): React.JSX.Element {
  const words = useCommentWords()
  const labelId = useId()
  const [step, setStep] = useState<Step>('none')
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const rebuildRef = useRef<HTMLButtonElement>(null)
  // Set when a step is left by hand: focus goes back to the button that opened it.
  const focusBack = useRef<Step>('none')
  const conflict = block.reason === 'conflict-marker'
  // Main deletes a damaged block only when it is terminated and the file is
  // writable (§7.6 step 6); an unterminated block or a conflict is fixed in source.
  const deletable = file.writable && !conflict && block.reason !== 'unterminated'
  // OD-05: only when main found valid @data the readable lines disagree with.
  const rebuildable = file.writable && block.rebuild !== undefined
  useEffect(() => {
    if (step !== 'none') cancelRef.current?.focus()
    else if (focusBack.current !== 'none') {
      const back = focusBack.current === 'delete' ? deleteRef : rebuildRef
      focusBack.current = 'none'
      back.current?.focus()
    }
  }, [step])
  const leave = (): void => {
    focusBack.current = step
    setStep('none')
  }
  // Esc backs out of a confirmation before it closes the window.
  useInnerStep(step !== 'none', leave)

  const send = (write: () => Promise<boolean>): void => {
    if (busy) return
    setBusy(true)
    void write().then(() => {
      setBusy(false)
      leave()
    })
  }
  const target = { panelId, fileKey: file.fileKey, blockKey: block.blockKey, rawHash: block.rawHash }

  return (
    <section className="erf-comment-thread" aria-label={`Damaged comment, line ${block.line}`} data-testid={TEST_IDS.COMMENT_DAMAGED}>
      <CommentBanner
        kind="warning"
        actions={
          rebuildable && step === 'none' ? (
            <DialogButton variant="secondary" buttonRef={rebuildRef} onClick={() => setStep('rebuild')} testId={TEST_IDS.COMMENT_REBUILD}>
              {WINDOW_COPY.rebuildAction}
            </DialogButton>
          ) : undefined
        }
      >
        {conflict ? words.conflictText : words.damagedText}
      </CommentBanner>
      <span className="erf-comment-raw-label" id={labelId}>
        {COPY.rawLabel}
      </span>
      {/* Focusable because it scrolls. Plain text: React escapes it. */}
      <pre className="erf-comment-raw" tabIndex={0} aria-labelledby={labelId} data-testid={TEST_IDS.COMMENT_DAMAGED_RAW}>
        {block.raw}
      </pre>
      {step === 'rebuild' && (
        <RebuildConfirm
          block={block}
          busy={busy}
          cancelRef={cancelRef}
          onCancel={leave}
          onRebuild={status => send(() => run({ ...target, op: 'rebuildBlock', ...(status === undefined ? {} : { status }) }))}
        />
      )}
      {step === 'delete' && (
        <div className="erf-comment-confirm" role="group" aria-label="Confirm delete">
          <p className="erf-comment-confirm__text">
            <VisibleText text={words.deleteBlockText(file.displayPath)} />
          </p>
          <div className="erf-comment-confirm__actions">
            <DialogButton variant="secondary" buttonRef={cancelRef} onClick={leave}>
              {COPY.cancel}
            </DialogButton>
            <DialogButton
              variant="danger"
              busy={busy}
              testId={TEST_IDS.COMMENT_DELETE_BLOCK_CONFIRM}
              onClick={() => send(() => run({ ...target, op: 'deleteBlock' }))}
            >
              {words.deleteBlock}
            </DialogButton>
          </div>
        </div>
      )}
      {step === 'none' && (
        <div className="erf-comment-thread__actions">
          <DialogButton variant="secondary" onClick={() => onCopy(block.raw)}>
            {COPY.copyRaw}
          </DialogButton>
          <DialogButton variant="secondary" onClick={() => onOpenInSource(block.line)}>
            {COPY.openInSource}
          </DialogButton>
          {deletable && (
            <DialogButton variant="secondary" buttonRef={deleteRef} onClick={() => setStep('delete')} testId={TEST_IDS.COMMENT_DELETE_BLOCK}>
              {words.deleteBlockAction}
            </DialogButton>
          )}
        </div>
      )}
    </section>
  )
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The drawer's note about comments removed outside Erfana (comments-v2 OD-06,
 * § 4.2; spec 024 state table § 2 "Drawer note"): an info banner above the
 * list, "{n} open comments were removed from {file} outside Erfana.", with
 * Show (main) and Dismiss. Show unfolds a read-only list – each removed
 * comment's text, author and target – with Copy text. Session only; nothing
 * is written to the file.
 *
 * @module components/Comments/CommentRemovedNote
 */
import { useId, useState } from 'react'
import { COMMENT_LIST_COPY } from './commentCopyWords'
import { visibleString } from './commentFormat'
import { ActionButton, CommentBanner, VisibleText } from './CommentParts'
import type { RemovedComment } from './commentRemovedOutside'
import { TEST_IDS } from '../../constants/testids'

/** Props for {@link CommentRemovedNote}. */
export interface CommentRemovedNoteProps {
  readonly removed: readonly RemovedComment[]
  /** The file as the reader knows it. */
  readonly file: string
  readonly onDismiss: () => void
  /** Copy one removed comment's text. */
  readonly onCopy: (text: string) => void
}

/**
 * The note; nothing when no comment was removed.
 *
 * @param props - {@link CommentRemovedNoteProps}
 * @returns The note, or `null`.
 */
export function CommentRemovedNote({ removed, file, onDismiss, onCopy }: CommentRemovedNoteProps): React.JSX.Element | null {
  const [shown, setShown] = useState(false)
  const listId = `${useId().replace(/[^\w-]/g, '')}-removed`
  if (removed.length === 0) return null
  return (
    <div className="erf-comment-drawer__note">
      <CommentBanner
        kind="info"
        testId={TEST_IDS.COMMENT_DRAWER_REMOVED}
        actions={
          <>
            <button
              type="button"
              className="erf-comment-action"
              aria-expanded={shown}
              aria-controls={shown ? listId : undefined}
              onClick={() => setShown(open => !open)}
              data-testid={TEST_IDS.COMMENT_DRAWER_REMOVED_SHOW}
            >
              {shown ? COMMENT_LIST_COPY.removedHide : COMMENT_LIST_COPY.removedShow}
            </button>
            <ActionButton onClick={onDismiss} testId={TEST_IDS.COMMENT_DRAWER_REMOVED_DISMISS}>
              {COMMENT_LIST_COPY.removedDismiss}
            </ActionButton>
          </>
        }
      >
        {COMMENT_LIST_COPY.removed(removed.length, file)}
      </CommentBanner>
      {shown && (
        <ul className="erf-comment-removed" id={listId} aria-label={COMMENT_LIST_COPY.removedList}>
          {removed.map(comment => (
            <li key={comment.threadKey} className="erf-comment-removed__item">
              <p className="erf-comment-row__excerpt" dir="auto">
                <VisibleText text={comment.text} />
              </p>
              <p className="erf-comment-row__meta">
                <bdi>
                  <VisibleText text={comment.author} />
                </bdi>
                {' · '}
                <span dir="ltr">
                  <VisibleText text={comment.label} />
                </span>
              </p>
              <ActionButton
                onClick={() => onCopy(comment.text)}
                // One name per row: the visible "Copy text" first, then whose (WCAG 2.5.3).
                ariaLabel={`${COMMENT_LIST_COPY.copyText}, ${visibleString(comment.author)}`}
                testId={TEST_IDS.COMMENT_DRAWER_REMOVED_COPY}
              >
                {COMMENT_LIST_COPY.copyText}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

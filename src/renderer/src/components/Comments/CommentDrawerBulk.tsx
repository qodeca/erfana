// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The drawer's bulk actions as drawn, in both previews (spec 024 024-FR-028,
 * state table § 2): the bar above the list, and the review that takes the
 * list's place. The destructive and the safe answer sit as in every inline
 * confirmation (Dialog card, `#inline-confirm`): Cancel first and focused, the
 * action on the right, so a second Enter cannot run it.
 *
 * Comment text is untrusted: drawn through `VisibleText`.
 *
 * @module components/Comments/CommentDrawerBulk
 */
import { useId } from 'react'
import { TEST_IDS } from '../../constants/testids'
import { BULK_COPY } from './commentBulk'
import { COPY, IDENTITY_COPY } from './commentCopy'
import { ActionButton, CommentBanner, DialogButton, VisibleText } from './CommentParts'
import { IdentityStep } from './IdentityStep'
import { QuoteBox } from './ThreadStatus'
import { WINDOW_COPY } from './commentWindowCopy'
import type { BulkItem } from './commentBulk'
import type { DrawerBulk } from './useDrawerBulk'

/**
 * The action this filter offers, its held-back reason, and how the last run ended.
 *
 * @param props - The drawer's {@link DrawerBulk}.
 * @returns The bar, or nothing when there is nothing to say.
 */
export function CommentDrawerBulkBar({ bulk }: { readonly bulk: DrawerBulk }): React.JSX.Element | null {
  const { offered, paused, outcome, review } = bulk
  if (review !== null) return null
  return (
    <>
      {offered !== null && (
        <div className="erf-comment-drawer__bulk">
          {paused === null ? (
            <ActionButton buttonRef={bulk.actionRef} onClick={() => bulk.open(offered)} testId={TEST_IDS.COMMENT_BULK_ACTION}>
              {BULK_COPY[offered].action}
            </ActionButton>
          ) : (
            <p className="erf-comment-drawer__help" data-testid={TEST_IDS.COMMENT_BULK_PAUSED}>
              {paused}
            </p>
          )}
        </div>
      )}
      {/* Always mounted while there is news, so a reader hears how it ended. */}
      {outcome !== null && (
        <div className="erf-comment-drawer__note" role="status">
          <CommentBanner kind={outcome.ok ? 'info' : 'warning'} testId={TEST_IDS.COMMENT_BULK_OUTCOME}>
            {outcome.text}
          </CommentBanner>
        </div>
      )}
    </>
  )
}

function ReviewRow({ item }: { readonly item: BulkItem }): React.JSX.Element {
  const { change } = item
  return (
    <li className="erf-comment-bulk__item" data-testid={TEST_IDS.COMMENT_BULK_ITEM}>
      <p className="erf-comment-bulk__label">
        <VisibleText text={item.label} />
      </p>
      <p className="erf-comment-bulk__excerpt" dir="auto">
        <VisibleText text={item.excerpt} />
      </p>
      {change !== undefined && change.now !== undefined && change.was !== change.now && (
        <div className="erf-comment-wasnow">
          {change.was !== '' && <QuoteBox label={WINDOW_COPY.was} text={change.was} was />}
          <QuoteBox label={WINDOW_COPY.now} text={change.now} was={false} />
        </div>
      )}
      {change !== undefined && change.now === undefined && change.was !== '' && (
        <div className="erf-comment-wasnow">
          <QuoteBox label={WINDOW_COPY.was} text={change.was} was />
        </div>
      )}
    </li>
  )
}

/**
 * The review: what the action will change, Cancel, and the action itself – or,
 * for a reader with no name yet, the identity step.
 *
 * @param props - The drawer's {@link DrawerBulk}; `review` is set.
 * @returns The review.
 */
export function CommentDrawerBulkReview({ bulk }: { readonly bulk: DrawerBulk }): React.JSX.Element | null {
  const noticeId = useId()
  const { review } = bulk
  if (review === null) return null
  const { change, items } = review
  const copy = BULK_COPY[change]
  const backOut = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    bulk.cancel()
  }
  if (review.askName) {
    return (
      <section className="erf-comment-bulk" aria-label={IDENTITY_COPY.title} onKeyDown={backOut}>
        <IdentityStep
          noticeId={noticeId}
          initialName={bulk.identity?.authorName ?? ''}
          initialEmail={bulk.identity?.authorEmail ?? ''}
          onSubmit={bulk.saveIdentity}
          onCancel={bulk.cancel}
        />
      </section>
    )
  }
  const danger = change === 'deleteResolved'
  return (
    <section className="erf-comment-bulk" aria-labelledby={`${noticeId}-t`} onKeyDown={backOut} data-testid={TEST_IDS.COMMENT_BULK_REVIEW}>
      <h3 className="erf-comment-bulk__title" id={`${noticeId}-t`}>
        {copy.title(items.length)}
      </h3>
      <p className="erf-comment-bulk__note">{copy.note}</p>
      <ul className="erf-comment-bulk__list">
        {items.map(item => (
          <ReviewRow key={item.threadKey} item={item} />
        ))}
      </ul>
      <div className="erf-comment-confirm__actions">
        <DialogButton variant="secondary" buttonRef={bulk.cancelRef} onClick={bulk.cancel} testId={TEST_IDS.COMMENT_BULK_CANCEL}>
          {COPY.cancel}
        </DialogButton>
        <DialogButton variant={danger ? 'danger' : 'primary'} busy={bulk.busy} onClick={bulk.confirm} testId={TEST_IDS.COMMENT_BULK_CONFIRM}>
          {copy.confirm(items.length)}
        </DialogButton>
      </div>
    </section>
  )
}

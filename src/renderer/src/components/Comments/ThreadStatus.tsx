// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – what the comment window says above a thread whose target is not
 * as the comment left it (spec 024 state table S-03 – S-05; comments-v2 C-05,
 * C-06; docs/designs/comments/comments-v2/window.html "Not found", "Changed
 * since comment, and words changed").
 *
 * - **Not found** (S-05, C-05): read as a possible success, not an error – the
 *   Feedback card's info banner, the stored text struck through under "It was
 *   attached to:", then where the comment itself is. Reply and Resolve stay.
 * - **Changed** (S-03) and **Words changed** (S-04), C-06: the info banner,
 *   then a Was box (the stored text, struck through) and a Now box (the text
 *   there now, first 200 characters) in the C-21 quote style – the preview's
 *   serif in Markdown. Words with no prefix…suffix pair left: Was only, and
 *   "The words this comment is about are gone from this {kind}." When the
 *   target is also hidden, the hidden sentence follows the boxes (§ 4 rule 8).
 *
 * Every text here comes from the file: React text nodes through
 * {@link VisibleText}, never HTML.
 *
 * @module components/Comments/ThreadStatus
 */
import type { CommentThreadView } from '../../../../shared/ipc/comment-common-schema'
import { TEST_IDS } from '../../constants/testids'
import { COPY } from './commentCopy'
import { CommentBanner, VisibleText } from './CommentParts'
import { WINDOW_COPY } from './commentWindowCopy'
import type { ThreadState } from './commentWindowStates'
import { useCommentWords } from './commentWords'

/** Props for {@link ThreadStatus}. */
export interface ThreadStatusProps {
  readonly thread: CommentThreadView
  readonly state: ThreadState
  /** The file's name with its controls as tokens. */
  readonly fileName: string
  /** The target is also not rendered right now. */
  readonly hidden: boolean
}

/** One quote box in the C-21 quote style, labelled Was or Now. */
function QuoteBox({ label, text, was }: { readonly label: string; readonly text: string; readonly was: boolean }): React.JSX.Element {
  const markdown = useCommentWords().preview === 'markdown'
  return (
    <div className="erf-comment-wasnow__item" data-testid={was ? TEST_IDS.COMMENT_WAS : TEST_IDS.COMMENT_NOW}>
      <p className="erf-comment-wasnow__label">{label}</p>
      <div className={`erf-comment-words${markdown ? ' erf-comment-words--md' : ''}`}>
        {was ? (
          <s className="erf-comment-words__text erf-comment-wasnow__was" dir="auto">
            <VisibleText text={text} />
          </s>
        ) : (
          <span className="erf-comment-words__text" dir="auto">
            <VisibleText text={text} />
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The note above one thread, for the states that have one.
 *
 * @param props - {@link ThreadStatusProps}
 * @returns The banner (and boxes), or nothing for an open, resolved or only hidden thread.
 */
export function ThreadStatus({ thread, state, fileName, hidden }: ThreadStatusProps): React.JSX.Element | null {
  const words = useCommentWords()
  const noun = words.noun(thread.tag)
  if (state === 'not-found') {
    const quote = thread.quote
    return (
      <>
        <CommentBanner kind="info" testId={TEST_IDS.COMMENT_NOT_FOUND}>
          {WINDOW_COPY.notFound(noun, fileName)}
          {quote !== undefined && quote.trim() !== '' && (
            <>
              <span className="erf-comment-quote-label">{COPY.attachedTo}</span>
              <s className="erf-comment-quote" dir="auto" data-testid={TEST_IDS.COMMENT_NOT_FOUND_QUOTE}>
                <VisibleText text={quote} />
              </s>
            </>
          )}
        </CommentBanner>
        <p className="erf-comment-note erf-comment-status-line" data-testid={TEST_IDS.COMMENT_COMMENT_LINE}>
          {WINDOW_COPY.commentLine(thread.line, fileName)}
        </p>
      </>
    )
  }
  if (state !== 'changed' && state !== 'words') return null
  const change = thread.change
  const was = change?.was ?? thread.quote ?? ''
  const now = change?.now
  const gone = state === 'words' && now === undefined
  return (
    <div className="erf-comment-status" data-testid={TEST_IDS.COMMENT_CHANGED}>
      <CommentBanner kind="info">{gone ? WINDOW_COPY.wordsGone(noun) : WINDOW_COPY.changed}</CommentBanner>
      <div className="erf-comment-wasnow">
        {was !== '' && <QuoteBox label={WINDOW_COPY.was} text={was} was />}
        {now !== undefined && <QuoteBox label={WINDOW_COPY.now} text={now} was={false} />}
      </div>
      {hidden && <p className="erf-comment-note erf-comment-status-line">{words.notVisibleText(thread.tag)}</p>}
    </div>
  )
}

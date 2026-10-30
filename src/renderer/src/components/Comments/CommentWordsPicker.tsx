// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words part of a new comment (spec 024 024-FR-004; comments-v2 C-07,
 * C-21; docs/designs/comments/comments-v2/window.html "Narrow to words").
 *
 * - **The quote** – "Comment on: “…”" – is clamped to three lines with a
 *   Show all text button (C-21). The 200-character notice sits outside it
 *   and is always visible while the words were cut (024-FR-004).
 * - **Narrow to words** is a disclosure, folded by default (R-05). Open, it
 *   is a read-only field holding the target's text; selecting in it with
 *   Shift+arrow (by character) or Ctrl+Shift+arrow / Option+Shift+arrow (by
 *   word) chooses the words – the guaranteed keyboard route (C-07). A polite
 *   line says what the comment will be on, with a Whole {kind} button.
 * - **Notices**: the selection ran past the target and was cut to it; the
 *   words appear twice with the same context (a tie – Save waits, and the
 *   window offers the whole {kind}); only spaces are selected (refused).
 *
 * The field is hidden for a target with no text (an image, a divider).
 * Nothing here is stored: the parent derives the choice from the range.
 *
 * @module components/Comments/CommentWordsPicker
 */
import { useEffect, useId, useRef, useState } from 'react'
import { SEL_EXACT_MAX_CHARS } from '../../../../shared/comments/anchorSel'
import type { WordsChoice } from '../../../../shared/comments/selectionWords'
import { TEST_IDS } from '../../constants/testids'
import { useLatestRef } from '../../hooks/useLatestRef'
import { SELECTION_COPY } from './commentCopyWords'
import { VisibleText } from './CommentParts'
import type { NewCommentWords } from './commentWindowTypes'

/** Characters from which the quote may need its Show all button (the clamp is three lines). */
const QUOTE_LONG_CHARS = 120

/** A range in the target's text. */
export interface WordsSpan {
  readonly start: number
  readonly end: number
}

/** Props for {@link CommentWordsPicker}. */
export interface CommentWordsPickerProps {
  readonly words: NewCommentWords
  /** The current range; `start === end` is the whole target. */
  readonly span: WordsSpan
  readonly choice: WordsChoice
  /** The range is still the one the window opened with (the "ran past" notice shows only then). */
  readonly untouched: boolean
  /** The preview's noun for the target ("element", "paragraph"). */
  readonly noun: string
  readonly line: number
  readonly onSpan: (span: WordsSpan) => void
  /** Ids the comment field adds to its description: the quote, when it shows. */
  readonly quoteId: string
}

/**
 * The quote, the notices and the Narrow to words field.
 *
 * @param props - {@link CommentWordsPickerProps}
 */
export function CommentWordsPicker(props: CommentWordsPickerProps): React.JSX.Element | null {
  const { words, span, choice, untouched, noun, line, onSpan, quoteId } = props
  const [open, setOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const fieldId = useId()
  const labelId = useId()
  const regionId = useId()
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  // Opened: the field shows the current range selected (a mouse selection's, R-05).
  // Only on opening: later ranges come from the field itself.
  const spanRef = useLatestRef(span)
  useEffect(() => {
    if (open) fieldRef.current?.setSelectionRange(spanRef.current.start, spanRef.current.end)
  }, [open, spanRef])

  if (words.text === '') return null
  const whole = (): void => {
    fieldRef.current?.setSelectionRange(0, 0)
    onSpan({ start: 0, end: 0 })
  }
  const exact = choice.kind === 'words' ? choice.sel.exact : null

  return (
    <div className="erf-comment-words-area">
      {exact !== null && (
        <div
          id={quoteId}
          className={`erf-comment-words${quoteOpen ? ' erf-comment-words--open' : ''}`}
          data-testid={TEST_IDS.COMMENT_WORDS}
        >
          <span className="erf-comment-words__text">
            <VisibleText text={SELECTION_COPY.result(exact)} />
          </span>
          {exact.length > QUOTE_LONG_CHARS && (
            <button type="button" className="erf-comment-link" aria-expanded={quoteOpen} onClick={() => setQuoteOpen(o => !o)}>
              {quoteOpen ? SELECTION_COPY.showLess : SELECTION_COPY.showAll}
            </button>
          )}
        </div>
      )}
      {choice.kind === 'words' && choice.cut && (
        <p className="erf-comment-note" data-testid={TEST_IDS.COMMENT_WORDS_NOTICE}>
          {SELECTION_COPY.cut(SEL_EXACT_MAX_CHARS)}
        </p>
      )}
      {words.cut && untouched && choice.kind !== 'whole' && (
        <p className="erf-comment-note" data-testid={TEST_IDS.COMMENT_WORDS_NOTICE}>
          {SELECTION_COPY.crossed(noun)}
        </p>
      )}
      {choice.kind === 'blank' && (
        <p className="erf-comment-note" data-testid={TEST_IDS.COMMENT_WORDS_NOTICE}>
          {SELECTION_COPY.blank(noun)}
        </p>
      )}
      {choice.kind === 'tie' && (
        <p className="erf-comment-note" data-testid={TEST_IDS.COMMENT_WORDS_NOTICE}>
          {SELECTION_COPY.tie(noun)}{' '}
          <button type="button" className="erf-comment-link" onClick={whole} data-testid={TEST_IDS.COMMENT_WORDS_WHOLE}>
            {SELECTION_COPY.commentOnWhole(noun)}
          </button>
        </p>
      )}
      <button
        type="button"
        className="erf-comment-link erf-comment-disclosure"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen(o => !o)}
        data-testid={TEST_IDS.COMMENT_NARROW_TOGGLE}
      >
        {SELECTION_COPY.narrow}
      </button>
      <div id={regionId} className="erf-comment-narrow" hidden={!open}>
        {open && (
          <>
            <label className="erf-comment-narrow__label" id={labelId} htmlFor={fieldId}>
              {SELECTION_COPY.narrowLabel(noun, line)}
            </label>
            <textarea
              ref={fieldRef}
              id={fieldId}
              className="erf-comment-narrow__field"
              readOnly
              rows={4}
              value={words.text}
              onSelect={event => {
                const el = event.currentTarget
                onSpan({ start: el.selectionStart, end: el.selectionEnd })
              }}
              data-testid={TEST_IDS.COMMENT_NARROW_FIELD}
            />
            <p className="erf-comment-narrow__result" aria-live="polite" data-testid={TEST_IDS.COMMENT_NARROW_RESULT}>
              {exact !== null && (
                <>
                  <span>
                    <VisibleText text={SELECTION_COPY.result(exact)} />
                  </span>{' '}
                  <button type="button" className="erf-comment-link" onClick={whole} data-testid={TEST_IDS.COMMENT_NARROW_WHOLE}>
                    {SELECTION_COPY.whole(noun)}
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

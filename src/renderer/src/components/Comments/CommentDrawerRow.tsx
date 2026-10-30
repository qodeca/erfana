// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One row of the comments drawer (`CommentDrawer.tsx`; decided Rows card;
 * comments-v2 C-10, C-15, R-11).
 *
 * A stretched main button behind the content, and Open. The main button is
 * named by the first message's excerpt – what the comment says – and
 * described by what it is on, the "was → now" words line, the reply count,
 * who and when, the tags and what Enter does (C-10: "on Button, line 42 · 2
 * replies · Marcin Obel, Today 14:32"). A damaged or newer-format row has no
 * message, so its label names it. A damaged tag is the ▲ attention counter's
 * shape (C-15); every other tag is the neutral outline chip.
 *
 * @module components/Comments/CommentDrawerRow
 */
import { COPY } from './commentCopy'
import { COMMENT_LIST_COPY } from './commentCopyWords'
import { plural, visibleString } from './commentFormat'
import { VisibleText } from './CommentParts'
import type { DrawerRow } from './commentRows'
import { useCommentWords } from './commentWords'
import { TEST_IDS } from '../../constants/testids'

/** Where a windowed row sits, and how it reports its height. */
export interface RowPlacement {
  /** Offset from the top of the list, in CSS px. */
  readonly top: number
  /** The whole list's length: a screen reader hears "row 412 of 1,000". */
  readonly setSize: number
  /** The virtualizer's measuring ref (reads `data-index`). */
  readonly measure: (element: Element | null) => void
}

/** Props for {@link DrawerRowView}. */
export interface DrawerRowViewProps {
  readonly row: DrawerRow
  /** Makes the row's element ids unique to this drawer. */
  readonly idPrefix: string
  /** The row's index in the filtered list. */
  readonly index: number
  readonly active: boolean
  /** Present only in a windowed list. */
  readonly place?: RowPlacement
  readonly time: string
  readonly onMain: () => void
  readonly onOpen: () => void
}

/**
 * One drawer row.
 *
 * @param props - {@link DrawerRowViewProps}
 * @returns The `<li>`.
 */
export function DrawerRowView({
  row,
  idPrefix,
  index,
  active,
  place,
  time,
  onMain,
  onOpen
}: DrawerRowViewProps): React.JSX.Element {
  const words = useCommentWords()
  const mainLabel = row.main === 'source' ? COPY.openInSource : words.showInPreview
  const base = `${idPrefix}-row-${row.id.replace(/[^\w-]/g, '_')}`
  const named = row.excerpt !== ''
  // `title` alone is not read once `aria-describedby` is set, so everything is in the description.
  const describedBy = [
    named ? `${base}-on` : null,
    row.words !== '' ? `${base}-w` : null,
    row.replies > 0 ? `${base}-r` : null,
    `${base}-m`,
    `${base}-t`,
    `${base}-a`
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <li
      ref={place?.measure}
      className={`erf-comment-row${active ? ' erf-comment-row--active' : ''}`}
      // Positioning a windowed row is per-row geometry, not styling.
      style={place ? { transform: `translateY(${place.top}px)` } : undefined}
      data-index={place ? index : undefined}
      aria-setsize={place?.setSize}
      aria-posinset={place ? index + 1 : undefined}
      data-testid={TEST_IDS.COMMENT_DRAWER_ROW}
    >
      <button
        type="button"
        className="erf-comment-row__main"
        tabIndex={active ? 0 : -1}
        data-row-index={index}
        aria-labelledby={named ? `${base}-x` : `${base}-l`}
        aria-describedby={describedBy}
        title={mainLabel}
        data-row-main
        data-testid={TEST_IDS.COMMENT_DRAWER_ROW_MAIN}
        onClick={onMain}
      />
      <div className="erf-comment-row__line">
        <span className="erf-comment-row__label" id={`${base}-l`} dir="ltr">
          <VisibleText text={row.label} />
        </span>
        {named && (
          <span className="erf-comment-sr" id={`${base}-on`}>
            {COMMENT_LIST_COPY.rowOn(visibleString(row.label))}
          </span>
        )}
        <span className="erf-comment-sr" id={`${base}-a`}>
          {mainLabel}
        </span>
        {row.replies > 0 && (
          <span className="erf-comment-row__count" id={`${base}-r`}>
            {plural(row.replies, 'reply', 'replies')}
          </span>
        )}
        <span id={`${base}-t`}>
          {row.tags.map(tag => (
            <span
              key={tag.text}
              className={tag.attention ? 'erf-counter erf-counter--attention' : 'erf-comment-tag'}
              data-testid={TEST_IDS.COMMENT_DRAWER_TAG}
            >
              {tag.text}
            </span>
          ))}
        </span>
      </div>
      <p className="erf-comment-row__excerpt" id={`${base}-x`} dir="auto">
        <VisibleText text={row.excerpt} />
      </p>
      {row.words !== '' && (
        <p className="erf-comment-row__words" id={`${base}-w`} dir="auto">
          <VisibleText text={row.words} />
        </p>
      )}
      <p className="erf-comment-row__meta" id={`${base}-m`}>
        {row.author !== '' && (
          <>
            <bdi>
              <VisibleText text={row.author} />
            </bdi>
            {` · ${time}`}
          </>
        )}
      </p>
      <button
        type="button"
        className="erf-comment-action erf-comment-row__open"
        tabIndex={active ? 0 : -1}
        aria-label={`Open comments on ${visibleString(row.label)}`}
        data-testid={TEST_IDS.COMMENT_DRAWER_ROW_OPEN}
        onClick={onOpen}
      >
        {COPY.open}
      </button>
    </li>
  )
}

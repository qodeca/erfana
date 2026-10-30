// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the comments drawer, in both previews (docs/designs/comments/html-preview-comments.md
 * decision 8, §10.6, §10.8; R-009, R-020; docs/designs/comments/html-comments/drawer.html).
 * Its words come from the preview's `CommentWordsContext` (spec 024, C-03).
 *
 * The list of every comment in the file, and the GUARANTEED KEYBOARD ROUTE to every
 * thread: icons are not in the Tab order, and a hidden, resolved or lost comment has none.
 *
 * Keyboard (decided Rows card, plus the Welcome list's one exception):
 * Tab reaches Close, then the filter (one stop – arrows move the selection),
 * the checkbox, then the list ONCE. In the list ↑ ↓ Home End move; Enter or a
 * click is "Show on page" with focus staying in the list ("Open in source" on
 * a not-found, damaged or newer row); Tab once more reaches that row's Open.
 *
 * Above {@link VIRTUALISE_ABOVE} rows the list is windowed (§10.6 "Rows
 * virtualised above ~200 items"): only the rows in and around the viewport
 * are in the DOM, positioned inside a sizer as tall as the whole list, with
 * each row's real height measured. The active row is always kept mounted, so
 * the one Tab stop – and focus on it – survives scrolling it out of view, and
 * a keyboard move to a row that is not mounted scrolls it in, then focuses it.
 *
 * Layout: a flow sibling of the page placeholder (CommentDrawer.css), so the
 * native page shrinks beside it rather than covering it. Under a 640px panel
 * it takes the whole width, "Show on page" closes it first, and Esc closes it
 * (it then covers everything, like a sheet).
 *
 * Focus return: the `<aside>` is a `data-focus-return` region, so a comment window opened from a
 * row that has since gone hands focus back into the drawer, not `<body>` (`resolveFocusReturnTarget`).
 *
 * @module HtmlPreviewPanel/comments/CommentDrawer
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { renderIcon } from '../../utils/iconRegistry'
import type { CommentListState } from '../../stores/usePreviewCommentStore'
import { COPY, DRAWER_COPY, readErrorText, unreadFilesText } from './commentCopy'
import { formatCommentTime, plural, visibleString } from './commentFormat'
import { drawerRows, type DrawerFilter, type DrawerRow } from './commentRows'
import { ActionButton, CommentBanner, VisibleText } from './CommentParts'
import { useCommentWords } from './commentWords'
import './CommentWindow.css'
import './CommentDrawer.css'
import { TEST_IDS } from '../../constants/testids'

/** A list longer than this is windowed (§10.6 "Rows virtualised above ~200 items"). */
export const VIRTUALISE_ABOVE = 200

/**
 * A row's height before it is measured: label line, two clamped excerpt
 * lines and the meta line. Only a first guess – every mounted row is measured.
 */
export const DRAWER_ROW_ESTIMATE_PX = 76

/** Rows mounted beyond each edge of the viewport, so a fast scroll shows no gap. */
const OVERSCAN_ROWS = 8

/** Each filter option's test id. */
const FILTER_TEST_IDS: Readonly<Record<DrawerFilter, string>> = {
  open: TEST_IDS.COMMENT_FILTER_OPEN,
  resolved: TEST_IDS.COMMENT_FILTER_RESOLVED,
  attention: TEST_IDS.COMMENT_FILTER_ATTENTION
}

const FILTERS: ReadonlyArray<{ key: DrawerFilter; label: string; empty: string }> = [
  { key: 'open', label: 'Open', empty: DRAWER_COPY.emptyOpen },
  { key: 'resolved', label: 'Resolved', empty: DRAWER_COPY.emptyResolved },
  { key: 'attention', label: 'Needs attention', empty: DRAWER_COPY.emptyAttention }
]

/** Props for {@link CommentDrawer}. */
export interface CommentDrawerProps {
  /** The element id the toolbar's list button `aria-controls`. */
  readonly id: string
  readonly list: CommentListState
  readonly notVisible: readonly string[]
  readonly showIcons: boolean
  /** Under a 640px panel: the whole width. */
  readonly full: boolean
  /** The page's file, for the read-error sentence. */
  readonly pageFile: string
  readonly now?: () => Date
  readonly locale?: string
  readonly onClose: () => void
  readonly onShowIconsChange: (show: boolean) => void
  /** Enter / click on a row whose element is on the page. */
  readonly onReveal: (row: DrawerRow) => void
  /** Enter / click on a row with nothing to show. */
  readonly onOpenInSource: (row: DrawerRow) => void
  /** The row's Open: the comment window. */
  readonly onOpen: (row: DrawerRow) => void
  readonly onRetry: () => void
}

/**
 * The comments drawer.
 *
 * @param props - {@link CommentDrawerProps}
 * @returns The `<aside>`.
 *
 * @example
 * ```tsx
 * <CommentDrawer id={drawerId} list={state.list} notVisible={state.notVisible}
 *   showIcons={state.showIcons} full={narrow} pageFile="index.html" … />
 * ```
 */
export function CommentDrawer(props: CommentDrawerProps): React.JSX.Element {
  const { list } = props
  const [filter, setFilter] = useState<DrawerFilter>('open')
  const [active, setActive] = useState(0)
  const [now] = useState(() => (props.now ?? (() => new Date()))())
  // Row ids are per drawer: two tabs' drawers may list the same file (L15).
  const idPrefix = `d${useId().replace(/[^\w-]/g, '')}`
  const listRef = useRef<HTMLUListElement>(null)
  const filterRefs = useRef<Record<DrawerFilter, HTMLButtonElement | null>>({
    open: null,
    resolved: null,
    attention: null
  })
  const closeRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const notVisible = useMemo(() => new Set(props.notVisible), [props.notVisible])
  const words = useCommentWords()
  const rows = useMemo(() => drawerRows(list.files, notVisible, words), [list.files, notVisible, words])
  const visible = rows[filter]
  const current = Math.min(active, Math.max(0, visible.length - 1))
  const windowed = list.status === 'ready' && visible.length > VIRTUALISE_ABOVE

  // Opening the drawer from the toolbar puts focus on its first control.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // The list starts below the file label inside the scroll container.
  const [listOffset, setListOffset] = useState(0)
  useLayoutEffect(() => {
    if (windowed) setListOffset(listRef.current?.offsetTop ?? 0)
  }, [windowed, filter])

  // The active row is the list's one Tab stop: keep it mounted wherever the
  // viewport is, so focus on it survives scrolling it out of view.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (current < range.count && !indexes.includes(current)) indexes.push(current)
      return indexes.sort((a, b) => a - b)
    },
    [current]
  )

  // Under the threshold the count is 0 and every row renders as plain flow.
  // The rule warns that React Compiler skips this component; the app does not
  // build with the compiler, and the virtualizer is only read during render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: windowed ? visible.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DRAWER_ROW_ESTIMATE_PX,
    getItemKey: index => visible[index]?.id ?? index,
    overscan: OVERSCAN_ROWS,
    scrollMargin: listOffset,
    rangeExtractor
  })

  // A keyboard move parks the row index here; it is focused once that row is
  // mounted – at once when it already is, after the scroll-in render when not.
  const pendingFocus = useRef<number | null>(null)
  const focusPending = useCallback((): void => {
    const index = pendingFocus.current
    if (index === null) return
    // Never pull focus back from outside the drawer.
    const focused = document.activeElement
    if (focused !== null && focused !== document.body && !asideRef.current?.contains(focused)) {
      pendingFocus.current = null
      return
    }
    const button = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-row-main][data-row-index="${index}"]`
    )
    if (!button) return
    pendingFocus.current = null
    button.focus({ preventScroll: windowed })
  }, [windowed])
  useLayoutEffect(focusPending)

  const focusRow = (index: number): void => {
    setActive(index)
    pendingFocus.current = index
    if (windowed) virtualizer.scrollToIndex(index, { align: 'auto' })
    focusPending()
  }

  const chooseFilter = (next: DrawerFilter): void => {
    setFilter(next)
    setActive(0)
    filterRefs.current[next]?.focus()
  }

  const onFilterKeyDown = (event: React.KeyboardEvent): void => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    if (!(event.key in step)) return
    event.preventDefault()
    const at = FILTERS.findIndex(f => f.key === filter)
    chooseFilter(FILTERS[(at + step[event.key] + FILTERS.length) % FILTERS.length].key)
  }

  const onListKeyDown = (event: React.KeyboardEvent): void => {
    const last = visible.length - 1
    const target: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: last
    }
    if (!(event.key in target)) return
    event.preventDefault()
    focusRow(Math.max(0, Math.min(last, target[event.key])))
  }

  const activate = (row: DrawerRow, index: number): void => {
    setActive(index)
    if (row.main === 'source') props.onOpenInSource(row)
    else props.onReveal(row)
  }

  let body: React.JSX.Element
  if (list.status === 'loading' || list.status === 'idle') {
    body = (
      <div className="erf-comment-drawer__status" role="status">
        {DRAWER_COPY.loading}
      </div>
    )
  } else if (list.status === 'error') {
    body = (
      <div className="erf-comment-drawer__status" data-testid={TEST_IDS.COMMENT_DRAWER_ERROR}>
        <span className="erf-comment-drawer__status-line">
          {renderIcon('circle-x', { size: 14, 'aria-hidden': true })}
          <span>{readErrorText(props.pageFile)}</span>
        </span>
        <ActionButton onClick={props.onRetry}>{COPY.tryAgain}</ActionButton>
      </div>
    )
  } else if (rows.none) {
    body = <p className="erf-comment-drawer__empty">{words.drawerNone}</p>
  } else if (visible.length === 0) {
    body = <p className="erf-comment-drawer__empty">{FILTERS.find(f => f.key === filter)?.empty}</p>
  } else {
    const rowView = (row: DrawerRow, index: number, place?: RowPlacement): React.JSX.Element => (
      <DrawerRowView
        key={row.id}
        row={row}
        idPrefix={idPrefix}
        index={index}
        active={index === current}
        place={place}
        time={row.at ? formatCommentTime(row.at, now, props.locale) : ''}
        onMain={() => activate(row, index)}
        onOpen={() => {
          setActive(index)
          props.onOpen(row)
        }}
      />
    )
    body = (
      <ul
        ref={listRef}
        className={`erf-comment-list${windowed ? ' erf-comment-list--windowed' : ''}`}
        // The sizer: as tall as every row together, so the scrollbar is true.
        style={windowed ? { blockSize: virtualizer.getTotalSize() } : undefined}
        aria-label={`${FILTERS.find(f => f.key === filter)?.label} comments`}
        onKeyDown={onListKeyDown}
        data-testid={TEST_IDS.COMMENT_DRAWER_LIST}
      >
        {windowed
          ? virtualizer.getVirtualItems().map(item =>
              rowView(visible[item.index], item.index, {
                top: item.start - listOffset,
                setSize: visible.length,
                measure: virtualizer.measureElement
              })
            )
          : visible.map((row, index) => rowView(row, index))}
      </ul>
    )
  }

  return (
    <aside
      ref={asideRef}
      id={props.id}
      className={`erf-comment-drawer${props.full ? ' erf-comment-drawer--full' : ''}`}
      aria-labelledby={`${props.id}-title`}
      data-focus-return
      data-testid={TEST_IDS.COMMENT_DRAWER}
      onKeyDown={event => {
        // Full width, the drawer covers the page like a sheet: Esc closes it.
        if (props.full && event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          props.onClose()
        }
      }}
    >
      <div className="erf-comment-drawer__head">
        <h2 className="erf-comment-drawer__title" id={`${props.id}-title`}>
          {DRAWER_COPY.title}
        </h2>
        <button
          ref={closeRef}
          type="button"
          className="erf-comment-icon-btn"
          aria-label={DRAWER_COPY.close}
          onClick={props.onClose}
          data-testid={TEST_IDS.COMMENT_DRAWER_CLOSE}
        >
          {renderIcon('x', { size: 16, 'aria-hidden': true })}
        </button>
      </div>
      <div className="erf-comment-drawer__controls">
        <div
          className="erf-comment-filter"
          role="radiogroup"
          aria-labelledby={`${props.id}-show`}
          onKeyDown={onFilterKeyDown}
        >
          <span className="erf-comment-filter__label" id={`${props.id}-show`}>
            {DRAWER_COPY.show}
          </span>
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              ref={node => {
                filterRefs.current[key] = node
              }}
              type="button"
              role="radio"
              className="erf-comment-filter__option"
              aria-checked={filter === key}
              tabIndex={filter === key ? 0 : -1}
              data-testid={FILTER_TEST_IDS[key]}
              onClick={() => chooseFilter(key)}
            >
              {`${label} `}
              <span className="erf-comment-filter__count">{rows[key].length}</span>
            </button>
          ))}
        </div>
        <label className="erf-comment-drawer__check">
          <input
            className="erf-comment-check"
            type="checkbox"
            checked={props.showIcons}
            onChange={event => props.onShowIconsChange(event.target.checked)}
            data-testid={TEST_IDS.COMMENT_DRAWER_SHOW_ICONS}
          />
          {DRAWER_COPY.showIcons}
        </label>
      </div>
      {list.status === 'ready' && list.unread !== undefined && (
        <div className="erf-comment-drawer__note">
          <CommentBanner kind="info" testId={TEST_IDS.COMMENT_DRAWER_UNREAD}>{unreadFilesText(list.unread)}</CommentBanner>
        </div>
      )}
      <div className="erf-comment-drawer__scroll" ref={scrollRef}>
        {list.status === 'ready' && visible.length > 0 && (
          // A file name is the page author's: bidi and invisible characters drawn as tokens (S-L-B).
          <p className="erf-comment-drawer__file"><VisibleText text={rows[filter][0].displayPath} /></p>
        )}
        {body}
      </div>
    </aside>
  )
}

/** Where a windowed row sits, and how it reports its height. */
interface RowPlacement {
  /** Offset from the top of the list, in CSS px. */
  readonly top: number
  /** The whole list's length: a screen reader hears "row 412 of 1,000". */
  readonly setSize: number
  /** The virtualizer's measuring ref (reads `data-index`). */
  readonly measure: (element: Element | null) => void
}

/** Props for {@link DrawerRowView}. */
interface DrawerRowViewProps {
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

/** One row: a stretched main button behind the content, and Open. */
function DrawerRowView({
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
  // The row's description: what Enter does, the excerpt, the reply count,
  // who and when, and the tags (M8) – `title` alone is not read once
  // `aria-describedby` is set.
  const describedBy = [
    `${base}-a`,
    `${base}-x`,
    row.replies > 0 ? `${base}-r` : null,
    `${base}-m`,
    `${base}-t`
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
        aria-labelledby={`${base}-l`}
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
              className={`erf-comment-tag${tag.attention ? ' erf-comment-tag--attention' : ''}`}
              data-testid={TEST_IDS.COMMENT_DRAWER_TAG}
            >
              {tag.attention && renderIcon('alert-triangle', { size: 12, 'aria-hidden': true })}
              {tag.text}
            </span>
          ))}
        </span>
      </div>
      <p className="erf-comment-row__excerpt" id={`${base}-x`} dir="auto">
        <VisibleText text={row.excerpt} />
      </p>
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

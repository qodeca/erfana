// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the two toolbar tools after Find, in both previews
 * (docs/designs/comments/html-preview-comments.md §10.1, §10.10; R-010, R-021;
 * comments-v2 C-15, C-20, OD-04, R-14, R-19; spec 024 state table § 1
 * "Toolbar"; docs/designs/comments/html-comments/toolbar.html, decided D-2).
 *
 * | Tool | Pattern | Accessible name |
 * |---|---|---|
 * | Comment mode | toggle, `aria-pressed` | "Comment mode" – never changes |
 * | Comments count | disclosure, `aria-expanded` + `aria-controls` | "7 comments, 4 changed, 1 damaged" |
 *
 * C-20, the quieter toolbar: "Show comment icons" left the row at every tier
 * – it is the drawer's checkbox now. Preview toolbars are icons only, so the
 * list tool is the icon and the number, at every width, with the ▲ attention
 * counter for damaged comments beside it (C-15, the Badges card's
 * `.erf-counter--attention`; the ▲ is generated content with empty alternative
 * text, so the words are in the tool's name). The number alone does not say
 * what it counts, so the count's `title` repeats its name. In the HTML Preview a
 * "2 not found" hint sits beside it (P-F22): those comments have no icon there. While the drawer is open the count wears the pressed signature, like every on/off
 * tool in the row (R-19) – it stays a disclosure.
 *
 * Unavailable is `aria-disabled`, never `disabled`: the tool keeps focus and
 * its tooltip, which says why (the Permission band card's rule). The count
 * stays usable when the page cannot take comments but its comments can still
 * be read; it takes the same state only when nothing can be read.
 *
 * There is deliberately no "Send to agent" control (decision 9, R-011).
 *
 * @module components/Comments/CommentToolbarTools
 */
import { renderIcon } from '../../utils/iconRegistry'
import type { CommentUnavailableReason } from '../../../../shared/ipc/preview-comment-schema'
import type { CommentCounts } from '../../stores/usePreviewCommentStore'
import { COPY, TOOL_COPY, commentModeAriaShortcut } from './commentCopy'
import { COMMENT_LIST_COPY } from './commentCopyWords'
import { useCommentWords } from './commentWords'
import { TEST_IDS } from '../../constants/testids'
import './CommentToolbarTools.css'

/** Reasons that leave nothing readable: the count goes `aria-disabled` too. */
const UNREADABLE: ReadonlySet<CommentUnavailableReason> = new Set([
  'disabled',
  'too-large',
  'encoding',
  'prepare-failed'
])

/** Props for {@link CommentToolbarTools}. */
export interface CommentToolbarToolsProps {
  readonly mode: boolean
  /** @deprecated C-20: the icons toggle is the drawer's checkbox now; ignored here. */
  readonly showIcons?: boolean
  readonly drawerOpen: boolean
  /** The drawer's element id (`aria-controls`). */
  readonly drawerId: string
  /**
   * The count (OD-04): `open` is every open comment, found or not (S-01 –
   * S-05); `attention` is the damaged comments only (S-07, S-08), the ▲
   * badge. Newer-format comments count in neither.
   */
  readonly counts: CommentCounts | null
  /** Open comments that are Changed or Words changed (C-06): the name adds ", {n} changed". */
  readonly changed?: number
  /**
   * Open comments whose target is gone (S-05), where the preview has nowhere to
   * show them (D-12, P-F22): a hint beside the count, with no place. Markdown
   * leaves it out: its ghost icon stands at the comment's own place.
   */
  readonly notFound?: number
  /** A saved comment's icon is on its way (P-F17): the count says so, words only (the States card: the wait can't be estimated). */
  readonly saving?: boolean
  /** The page has loaded (comment mode needs a live page). */
  readonly ready: boolean
  readonly unavailable: CommentUnavailableReason | null
  /** `byKeyboard`: a keyboard activation (`detail === 0`), which moves focus into the page. */
  readonly onToggleMode: (byKeyboard: boolean) => void
  readonly onToggleDrawer: () => void
  /** @deprecated C-20: the icons toggle is the drawer's checkbox now; ignored here. */
  readonly onToggleIcons?: () => void
  readonly modeRef?: React.Ref<HTMLButtonElement>
  readonly listRef?: React.Ref<HTMLButtonElement>
  /**
   * The row the tools sit in (differences table D-28): the HTML Preview's
   * permission band (default), or the Markdown toolbar's 32 × 28 tools.
   */
  readonly variant?: 'band' | 'toolbar'
  /**
   * Why no new comment can be written now (C-19.1, menu matrix § 2): the mode
   * toggle goes `aria-disabled` with this sentence as its tooltip. The count
   * stays usable – existing comments remain readable.
   */
  readonly modeUnavailableText?: string | null
}

/** Each tool's class, per row. */
const TOOL_CLASS = {
  band: {
    mode: 'erf-band__tool erf-band__tool--toggle erf-band__tool--comment erf-band__tool--comment-first',
    list: 'erf-band__tool erf-band__tool--toggle erf-band__tool--comment erf-band__tool--count erf-comment-count'
  },
  toolbar: {
    mode: 'toolbar-btn erf-md-comment-tool',
    list: 'toolbar-btn erf-md-comment-tool erf-md-comment-tool--count erf-comment-count'
  }
} as const

/**
 * The comment tools, as one fragment for the band's leading slot.
 *
 * @param props - {@link CommentToolbarToolsProps}
 * @returns Two tools: Comment mode and the count.
 *
 * @example
 * ```tsx
 * <PreviewFindTool onFind={openSearch} />
 * <CommentToolbarTools {...comments.toolbar} />
 * ```
 */
export function CommentToolbarTools({
  mode,
  drawerOpen,
  drawerId,
  counts,
  changed = 0,
  notFound = 0,
  saving = false,
  ready,
  unavailable,
  onToggleMode,
  onToggleDrawer,
  modeRef,
  listRef,
  variant = 'band',
  modeUnavailableText = null
}: CommentToolbarToolsProps): React.JSX.Element {
  const words = useCommentWords()
  const classes = TOOL_CLASS[variant]
  const modeBlocked = !ready || unavailable !== null || modeUnavailableText !== null
  const modeTitle =
    modeUnavailableText !== null
      ? modeUnavailableText
      : unavailable !== null
        ? words.unavailableText(unavailable)
        : !ready
          ? TOOL_COPY.modeNotReady
          : words.modeTooltip(mode)
  const readBlocked = unavailable !== null && UNREADABLE.has(unavailable)
  const open = counts?.open ?? 0
  const damaged = counts?.attention ?? 0
  const listName = COMMENT_LIST_COPY.countName(open, changed, damaged, notFound)

  return (
    <>
      <button
        ref={modeRef}
        type="button"
        className={classes.mode}
        aria-label={TOOL_COPY.mode}
        aria-pressed={mode}
        aria-keyshortcuts={commentModeAriaShortcut()}
        aria-disabled={modeBlocked ? 'true' : undefined}
        title={modeTitle}
        data-testid={TEST_IDS.COMMENT_TOOL_MODE}
        onClick={event => {
          // aria-disabled stops nothing by itself; turning OFF stays possible.
          if (modeBlocked && !mode) return
          onToggleMode(event.detail === 0)
        }}
      >
        {renderIcon('message-square-plus', { size: 16, 'aria-hidden': true })}
      </button>
      <button
        ref={listRef}
        type="button"
        className={classes.list}
        aria-label={listName}
        aria-expanded={drawerOpen}
        aria-controls={drawerOpen ? drawerId : undefined}
        aria-disabled={readBlocked ? 'true' : undefined}
        aria-busy={saving ? 'true' : undefined}
        // Icons only: the tooltip says what the count is, or why it is unavailable.
        title={readBlocked && unavailable !== null ? words.unavailableText(unavailable) : listName}
        data-testid={TEST_IDS.COMMENT_TOOL_LIST}
        onClick={() => {
          if (readBlocked && !drawerOpen) return
          onToggleDrawer()
        }}
      >
        <span className="erf-comment-count__icon" aria-hidden="true">
          {renderIcon('messages-square', { size: 16, 'aria-hidden': true })}
        </span>
        {open > 0 && <span className="erf-comment-count__number">{open}</span>}
        {saving && <span className="erf-counter">{COPY.saving}</span>}
        {notFound > 0 && <span className="erf-counter">{COMMENT_LIST_COPY.notFoundCount(notFound)}</span>}
        {damaged > 0 && <span className="erf-counter erf-counter--attention">{damaged}</span>}
      </button>
    </>
  )
}

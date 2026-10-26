// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the three toolbar tools after Find
 * (docs/designs/html-preview-comments.md §10.1, §10.10; R-010, R-021;
 * docs/design-system/product/html-comments/toolbar.html, proposed).
 *
 * | Tool | Pattern | Accessible name |
 * |---|---|---|
 * | Comment mode | toggle, `aria-pressed` | "Comment mode" – never changes |
 * | Comments | disclosure, `aria-expanded` + `aria-controls`, open count, `· !n` | "Comments, 3 open, 1 need attention" |
 * | Show comment icons | toggle, `aria-pressed`, default on, per tab | "Show comment icons" |
 *
 * Unavailable is `aria-disabled`, never `disabled`: the tool keeps focus and
 * its tooltip, which says why (the Permission band card's rule). Designer
 * call: the list and the pins tool stay usable when the page cannot take
 * comments but its comments can still be read (the overlay keeps being
 * removed, the page is over the element cap) – they take the same state only
 * when nothing can be read.
 *
 * There is deliberately no "Send to agent" control (decision 9, R-011).
 *
 * @module HtmlPreviewPanel/comments/CommentToolbarTools
 */
import { renderIcon } from '../../../../utils/iconRegistry'
import type { CommentUnavailableReason } from '../../../../../../shared/ipc/preview-comment-schema'
import type { CommentCounts } from '../../../../stores/usePreviewCommentStore'
import {
  TOOL_COPY,
  commentModeAriaShortcut,
  listButtonName,
  modeTooltip,
  unavailableTooltip
} from './commentCopy'
import { TEST_IDS } from '../../../../constants/testids'

/** Reasons that leave nothing readable: list and pins go `aria-disabled` too. */
const UNREADABLE: ReadonlySet<CommentUnavailableReason> = new Set([
  'disabled',
  'too-large',
  'encoding',
  'prepare-failed'
])

/** Props for {@link CommentToolbarTools}. */
export interface CommentToolbarToolsProps {
  readonly mode: boolean
  readonly showIcons: boolean
  readonly drawerOpen: boolean
  /** The drawer's element id (`aria-controls`). */
  readonly drawerId: string
  readonly counts: CommentCounts | null
  /** The page has loaded (comment mode needs a live page). */
  readonly ready: boolean
  readonly unavailable: CommentUnavailableReason | null
  /** `byKeyboard`: a keyboard activation (`detail === 0`), which moves focus into the page. */
  readonly onToggleMode: (byKeyboard: boolean) => void
  readonly onToggleDrawer: () => void
  readonly onToggleIcons: () => void
  readonly modeRef?: React.Ref<HTMLButtonElement>
  readonly listRef?: React.Ref<HTMLButtonElement>
}

/**
 * The comment tools, as one fragment for the band's leading slot.
 *
 * @param props - {@link CommentToolbarToolsProps}
 * @returns Three band tools.
 *
 * @example
 * ```tsx
 * <PreviewFindTool onFind={openSearch} />
 * <CommentToolbarTools {...comments.toolbar} />
 * ```
 */
export function CommentToolbarTools({
  mode,
  showIcons,
  drawerOpen,
  drawerId,
  counts,
  ready,
  unavailable,
  onToggleMode,
  onToggleDrawer,
  onToggleIcons,
  modeRef,
  listRef
}: CommentToolbarToolsProps): React.JSX.Element {
  const modeBlocked = !ready || unavailable !== null
  const modeTitle =
    unavailable !== null
      ? unavailableTooltip(unavailable)
      : !ready
        ? TOOL_COPY.modeNotReady
        : modeTooltip(mode)
  const readBlocked = unavailable !== null && UNREADABLE.has(unavailable)
  const open = counts?.open ?? 0
  const attention = counts?.attention ?? 0
  const listName = listButtonName(open, attention, counts?.resolved ?? 0)

  return (
    <>
      <button
        ref={modeRef}
        type="button"
        className="erf-band__tool erf-band__tool--toggle erf-band__tool--comment erf-band__tool--comment-first"
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
        className="erf-band__tool erf-band__tool--toggle erf-band__tool--comment erf-band__tool--count"
        aria-label={listName}
        aria-expanded={drawerOpen}
        aria-controls={drawerOpen ? drawerId : undefined}
        aria-disabled={readBlocked ? 'true' : undefined}
        title={readBlocked && unavailable !== null ? unavailableTooltip(unavailable) : listName}
        data-testid={TEST_IDS.COMMENT_TOOL_LIST}
        onClick={() => {
          if (readBlocked && !drawerOpen) return
          onToggleDrawer()
        }}
      >
        {renderIcon('messages-square', { size: 16, 'aria-hidden': true })}
        {open > 0 && <span>{open}</span>}
        {attention > 0 && <span className="erf-band__tool-attention">{`· !${attention}`}</span>}
      </button>
      <button
        type="button"
        className="erf-band__tool erf-band__tool--toggle erf-band__tool--comment"
        aria-label={TOOL_COPY.pins}
        aria-pressed={showIcons}
        aria-disabled={readBlocked ? 'true' : undefined}
        title={showIcons ? TOOL_COPY.pinsOn : TOOL_COPY.pinsOff}
        data-testid={TEST_IDS.COMMENT_TOOL_ICONS}
        onClick={() => {
          if (!readBlocked) onToggleIcons()
        }}
      >
        {showIcons
          ? renderIcon('message-square', { size: 16, 'aria-hidden': true })
          : renderIcon('message-square-off', { size: 16, 'aria-hidden': true })}
      </button>
    </>
  )
}

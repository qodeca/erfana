// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – what one tab draws over its frozen page: the
 * element menu, the comment window, and the always-mounted live regions
 * (docs/designs/comments/html-preview-comments.md §10.3, §10.4, §10.8; R-001, R-002,
 * R-013).
 *
 * The menu is the shared `ContextMenu` – its `useOccluder('menu', true)`
 * swaps the native page for a still while it is open – with the comment items
 * of the menu matrix (spec 024 `design/menu-matrix.md`, shared with the
 * Markdown Preview through `hostMenu.ts`): "Add comment" in comment mode
 * (M-03), "Comment on element" outside it (M-01, OD-01), and on a selection
 * "Comment on selection" then "Comment on the whole element" (M-02, M-04).
 * When main minted no draft, or comments are unavailable for the page, the
 * same items stay – disabled, each with its reason line (M-05, M-06, M-08,
 * M-10; C-19). The window is {@link CommentWindow}.
 *
 * The live regions are mounted for the tab's whole life and empty until they
 * speak: a region created together with its text is not announced. Polite:
 * mode changes and "Comment saved to {file}."; assertive: errors.
 *
 * @module HtmlPreviewPanel/comments/PreviewCommentsLayer
 */
import { useRef } from 'react'
import type { AnchorSelection } from '../../../../../../shared/comments/anchorSel'
import { HTML_WORDS, menuReasonText } from '../../../Comments/commentCopyWords'
import { hostMenuItems, hostMenuLabel } from '../../../Comments/overlay/hostMenu'
import type { ContextMenuItem } from '../../../ContextMenu/ContextMenu'
import type { DraftScope } from './previewCommentRequests'
import { renderIcon } from '../../../../utils/iconRegistry'
import type {
  CommentSaveRequest,
  CommentSaveResult,
  CommentUnavailableReason
} from '../../../../../../shared/ipc/preview-comment-schema'
import type { CommentIdentitySettings } from '../../../../../../shared/ipc/global-settings-schema'
import type { CommentListState } from '../../../../stores/usePreviewCommentStore'
import { ContextMenu } from '../../../ContextMenu/ContextMenu'
import { unavailableTooltip } from '../../../Comments/commentCopy'
import type { Box } from '../../../Comments/commentPlacement'
import type { IdentityFormData } from '../../../Comments/commentSchemas'
import { CommentWindow } from '../../../Comments/CommentWindow'
import type { CommentWindowRequest, ElementDraft } from '../../../Comments/commentWindowTypes'


/** Props for {@link PreviewCommentsLayer}. */
export interface PreviewCommentsLayerProps {
  readonly menu: ElementDraft | null
  /** Comment mode is on: the menu without a selection says "Add comment", else "Comment on element" (default on). */
  readonly mode?: boolean
  /** Why comments are unavailable for the page (M-10): every item is disabled with that sentence. */
  readonly unavailable?: CommentUnavailableReason | null
  readonly request: CommentWindowRequest | null
  readonly list: CommentListState
  readonly identity: CommentIdentitySettings | null
  readonly notVisible: readonly string[]
  readonly polite: string
  readonly assertive: string
  readonly getArea: () => Box | null
  /** `chosen`: an item ran (focus goes on with it); else focus returns to the page. */
  readonly onMenuClose: (chosen: boolean) => void
  /** An item ran: open the window on the selected words, or on the whole element (the default). */
  readonly onAddComment: (draft: ElementDraft, scope?: DraftScope) => void
  /** `returnFocus: false` when the caller moves focus itself ("Go to tab"). */
  readonly onCloseWindow: (returnFocus?: boolean) => void
  /** A pin's thread view chose "New comment": show the new-comment view instead. */
  readonly onNewComment: (request: Extract<CommentWindowRequest, { kind: 'new' }>) => void
  readonly onSaveIdentity: (identity: IdentityFormData) => Promise<boolean>
  /** Write; a new comment's chosen words ride along as `sel` (024-FR-004). */
  readonly onSave: (request: CommentSaveRequest, sel?: AnchorSelection) => Promise<CommentSaveResult>
  readonly onWritten: (request: CommentSaveRequest, file: string) => void
  readonly onRefresh: () => void
  readonly onPickAgain: () => void
  readonly onOpenInSource: (filePath: string, line: number) => void
  readonly onCopyRaw: (text: string) => void
  /** A step in the window reached this thread (C-13): show its element on the page. */
  readonly onReveal?: (threadKey: string) => void
  /** The panel's drawer `id`: the window's stepper steps within that drawer's filter (C-13). */
  readonly drawerId?: string
  /** Injected clock for the window's times (tests). */
  readonly now?: () => Date
}

/**
 * The tab's comment layer.
 *
 * @param props - {@link PreviewCommentsLayerProps}
 * @returns The live regions, plus the menu or the window when open.
 */
export function PreviewCommentsLayer(props: PreviewCommentsLayerProps): React.JSX.Element {
  const { menu, request } = props
  const canComment =
    menu !== null && menu.draftToken !== undefined && menu.draftKey !== undefined && menu.target !== undefined
  // Set by the item's action, read by the close that ContextMenu runs right after it.
  const chosen = useRef(false)
  const closeMenu = (): void => {
    props.onMenuClose(chosen.current)
    chosen.current = false
  }
  const selection = menu?.selection === true
  // M-10 first – nothing could be read, so nothing else is known – then main's refusal for this pick (M-05, M-06, M-08).
  const unavailable = props.unavailable ?? null
  const blocked =
    menu === null
      ? null
      : unavailable !== null
        ? unavailableTooltip(unavailable)
        : canComment
          ? null
          : menuReasonText(menu.reason, menu.displayPath)
  // The matrix gives labels, order and each item's action, and keeps each item, disabled with its reason line,
  // when it cannot be used. The ref is written only on click; ContextMenu never runs a disabled item.
  const items: ContextMenuItem[] =
    menu === null
      ? []
      : hostMenuItems(
          { mode: props.mode ?? true, tag: menu.target?.tag ?? '', blocked, refused: null, words: HTML_WORDS, selection },
          { open: () => props.onAddComment(menu), openWords: () => props.onAddComment(menu, 'words') }
        ).map(item => ({
          ...item,
          icon: renderIcon('message-square-plus', { size: 16, 'aria-hidden': true }),
          action: () => {
            chosen.current = true
            item.action()
          }
        }))
  return (
    <>
      <div
        className="erf-band__announce"
        role="status"
        aria-live="polite"
        data-testid="comment-announce"
      >
        {props.polite}
      </div>
      <div className="erf-band__announce" aria-live="assertive" data-testid="comment-alert">
        {props.assertive}
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.point.x}
          y={menu.point.y}
          ariaLabel={hostMenuLabel({ tag: menu.target?.tag ?? '', words: HTML_WORDS, selection })}
          containerTestId="comment-context-menu"
          onClose={closeMenu}
          items={items}
        />
      )}
      {request !== null && (
        <CommentWindow
          // A new request is a new window: no state carries over.
          key={
            request.kind === 'new'
              ? request.draftToken
              : `${request.fileKey}:${request.threadKeys.join(',')}:${request.blockKeys.join(',')}`
          }
          request={request}
          list={props.list}
          identity={props.identity}
          notVisible={props.notVisible}
          getArea={props.getArea}
          now={props.now}
          onClose={props.onCloseWindow}
          onNewComment={props.onNewComment}
          onSaveIdentity={props.onSaveIdentity}
          onSave={props.onSave}
          onWritten={props.onWritten}
          onRefresh={props.onRefresh}
          onPickAgain={props.onPickAgain}
          onOpenInSource={props.onOpenInSource}
          onCopyRaw={props.onCopyRaw}
          onReveal={props.onReveal}
          drawerId={props.drawerId}
        />
      )}
    </>
  )
}

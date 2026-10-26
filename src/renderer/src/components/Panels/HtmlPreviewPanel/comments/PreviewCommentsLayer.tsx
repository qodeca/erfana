// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – what one tab draws over its frozen page: the
 * element menu, the comment window, and the always-mounted live regions
 * (docs/designs/html-preview-comments.md §10.3, §10.4, §10.8; R-001, R-002,
 * R-013).
 *
 * The menu is the shared `ContextMenu` – its `useOccluder('menu', true)`
 * swaps the native page for a still while it is open – with ONE item, "Add
 * comment", or a disabled "Can't comment here" when main minted no draft
 * (decision 14: no other menu item in v1). The window is
 * {@link CommentWindow}.
 *
 * The live regions are mounted for the tab's whole life and empty until they
 * speak: a region created together with its text is not announced. Polite:
 * mode changes and "Comment saved to {file}."; assertive: errors.
 *
 * @module HtmlPreviewPanel/comments/PreviewCommentsLayer
 */
import { useRef } from 'react'
import { renderIcon } from '../../../../utils/iconRegistry'
import type {
  CommentSaveRequest,
  CommentSaveResult
} from '../../../../../../shared/ipc/preview-comment-schema'
import type { CommentIdentitySettings } from '../../../../../../shared/ipc/global-settings-schema'
import type { CommentListState } from '../../../../stores/usePreviewCommentStore'
import { ContextMenu } from '../../../ContextMenu/ContextMenu'
import { COPY } from './commentCopy'
import type { Box } from './commentPlacement'
import type { IdentityFormData } from './commentSchemas'
import { CommentWindow } from './CommentWindow'
import type { CommentWindowRequest, ElementDraft } from './commentWindowTypes'

/** Props for {@link PreviewCommentsLayer}. */
export interface PreviewCommentsLayerProps {
  readonly menu: ElementDraft | null
  readonly request: CommentWindowRequest | null
  readonly list: CommentListState
  readonly identity: CommentIdentitySettings | null
  readonly notVisible: readonly string[]
  readonly polite: string
  readonly assertive: string
  readonly getArea: () => Box | null
  /** `chosen`: an item ran (focus goes on with it); else focus returns to the page. */
  readonly onMenuClose: (chosen: boolean) => void
  readonly onAddComment: (draft: ElementDraft) => void
  /** `returnFocus: false` when the caller moves focus itself ("Go to tab"). */
  readonly onCloseWindow: (returnFocus?: boolean) => void
  /** A pin's thread view chose "New comment": show the new-comment view instead. */
  readonly onNewComment: (request: Extract<CommentWindowRequest, { kind: 'new' }>) => void
  readonly onSaveIdentity: (identity: IdentityFormData) => Promise<boolean>
  readonly onSave: (request: CommentSaveRequest) => Promise<CommentSaveResult>
  readonly onWritten: (request: CommentSaveRequest, file: string) => void
  readonly onRefresh: () => void
  readonly onPickAgain: () => void
  readonly onOpenInSource: (filePath: string, line: number) => void
  readonly onCopyRaw: (text: string) => void
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
  const canComment = menu !== null && menu.draftToken !== undefined && menu.target !== undefined
  // Set by the item's action, read by the close that ContextMenu runs right after it.
  const chosen = useRef(false)
  const closeMenu = (): void => {
    props.onMenuClose(chosen.current)
    chosen.current = false
  }
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
          ariaLabel={COPY.menuLabel}
          containerTestId="comment-context-menu"
          onClose={closeMenu}
          items={[
            canComment
              ? {
                  label: COPY.addComment,
                  icon: renderIcon('message-square-plus', { size: 16, 'aria-hidden': true }),
                  testId: 'comment-menu-add',
                  action: () => {
                    chosen.current = true
                    props.onAddComment(menu)
                  }
                }
              : {
                  label: COPY.cantCommentHere,
                  disabled: true,
                  testId: 'comment-menu-disabled',
                  // ContextMenu never runs a disabled item; were it to, closing
                  // the menu is the only thing this item could mean.
                  action: closeMenu
                }
          ]}
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
        />
      )}
    </>
  )
}

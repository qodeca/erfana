// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Everything the Markdown Preview draws for comments inside its pane (spec
 * 024 024-FR-003, 024-FR-005): the shared overlay layer, the drawer docked at
 * the pane's right edge, the target menu and the comment window – all in the
 * Markdown words (`CommentWordsContext`, C-03).
 *
 * Rendered by `EditorContentLayout` in the preview-only view only, as a
 * sibling of the preview's scroller: nothing here is inside the content an
 * export reads, a copy takes or Find walks (024-FR-024). Its hidden marker
 * hands the pane to the host, which reads pointer and keys from the scroller
 * beside it.
 *
 * @module Editor/markdownComments/MarkdownCommentsOverlay
 */
import { CommentDrawer } from '../../Comments/CommentDrawer'
import { MARKDOWN_WORDS } from '../../Comments/commentCopyWords'
import { CommentWindow } from '../../Comments/CommentWindow'
import { CommentWordsContext } from '../../Comments/commentWords'
import { useLiveText } from '../../Comments/commentLive'
import { useHostStepKeys } from '../../Comments/overlay/useHostStepKeys'
import { CommentOverlayLayer } from '../../Comments/overlay/CommentOverlayLayer'
import type { PreviewCommentAdapter } from '../../Comments/overlay/previewAdapter'
import type { CommentOverlayHost } from '../../Comments/overlay/useCommentOverlayHost'
import { ContextMenu } from '../../ContextMenu/ContextMenu'
import { PreviewContextMenu } from '../../ContextMenu/PreviewContextMenu'
import { TEST_IDS } from '../../../constants/testids'

/** Props for {@link MarkdownCommentsOverlay}. */
export interface MarkdownCommentsOverlayProps {
  readonly host: CommentOverlayHost
  readonly adapter: PreviewCommentAdapter
  readonly filePath: string
  /** The Markdown text, for the prompt items of the menu (their "full document"). */
  readonly content: string
  /** A stable callback ref for the hidden marker: its parent is the pane, `null` when the overlay unmounts. */
  readonly bindPane: (marker: HTMLElement | null) => void
  readonly area: HTMLElement | null
  readonly scroller: HTMLElement | null
}

/** The window's key: a new request is a new window, so no state carries over. */
function windowKey(host: CommentOverlayHost): string {
  const request = host.window?.request
  if (request === undefined) return ''
  return request.kind === 'new'
    ? request.draftToken
    : `${request.fileKey}:${request.threadKeys.join(',')}:${request.blockKeys.join(',')}`
}

/**
 * The Markdown Preview's comment surfaces.
 *
 * @param props - {@link MarkdownCommentsOverlayProps}
 * @returns The layer, the drawer, the menu and the window, as they apply.
 */
export function MarkdownCommentsOverlay(props: MarkdownCommentsOverlayProps): React.JSX.Element {
  const { host, adapter, scroller, area, filePath, content: markdown, bindPane } = props
  const menu = host.menu
  const content = scroller?.querySelector<HTMLElement>('.markdown-preview-content') ?? null
  // C-13: Alt+F9 / Alt+Shift+F9 with focus in the preview; where a step landed is said here.
  const [stepSaid, sayStep] = useLiveText()
  useHostStepKeys({
    live: host.shown,
    scroller,
    adapter,
    file: host.file,
    placements: host.placements,
    drawerId: host.toolbar.drawerId,
    openThreads: host.openThreads,
    announce: sayStep
  })
  return (
    <CommentWordsContext.Provider value={MARKDOWN_WORDS}>
      <span hidden ref={bindPane} />
      <p className="erf-comment-sr" aria-live="polite" data-testid={TEST_IDS.COMMENT_STEP_LIVE}>
        {stepSaid}
      </p>
      {host.shown && (
        <CommentOverlayLayer
          adapter={adapter}
          area={area}
          content={content}
          mode={host.mode}
          showIcons={host.showIcons}
          outlined={host.outlined}
          placements={host.placements}
          file={host.file}
          scrollTick={host.scrollTick}
          polite={host.polite}
          assertive={host.assertive}
          onOpenThreads={host.openThreads}
          selectionButton={host.selectionButton}
          onSelectionButton={host.onSelectionButton}
          markOwner={host.markOwner}
          activeThreads={host.activeThreads}
        />
      )}
      {host.drawer !== null && (
        <div className="erf-comment-host__drawer">
          <CommentDrawer {...host.drawer} />
        </div>
      )}
      {menu !== null &&
        (menu.mode || menu.target === null ? (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            ariaLabel={menu.label}
            containerTestId={TEST_IDS.COMMENT_CONTEXT_MENU}
            onClose={host.closeMenu}
          />
        ) : (
          <PreviewContextMenu
            x={menu.x}
            y={menu.y}
            selectedText={menu.selectedText ?? menu.target.textContent ?? ''}
            filePath={filePath}
            fullDocument={markdown}
            startLine={adapter.lineOf(menu.target)}
            endLine={Number.parseInt(menu.target.dataset.lineEnd ?? '', 10) || adapter.lineOf(menu.target)}
            leadingItems={menu.items}
            // Copy selection only when the menu is about a selection (M-11 vs M-12).
            hideCopy={menu.selectedText === undefined}
            ariaLabel={menu.label}
            onClose={host.closeMenu}
          />
        ))}
      {/* C-13: the window steps within the drawer's current filter. */}
      {host.window !== null && <CommentWindow key={windowKey(host)} {...host.window} drawerId={host.toolbar.drawerId} />}
    </CommentWordsContext.Provider>
  )
}

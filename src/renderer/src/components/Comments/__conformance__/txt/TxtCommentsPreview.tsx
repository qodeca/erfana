// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The test-only `.txt` preview with comments (spec 024 024-FR-002,
 * 024-AC-002; architecture note 001 § 3): a scroller of `<p data-line-start>`
 * paragraphs – the `.txt` kind's own paragraphs, so the renderer and main
 * agree on every line – plus the shared overlay host and the shared comment
 * surfaces: toolbar tools, overlay layer, drawer and window. The target
 * menu is left out: the `.txt` tests do not open it, and drawing it would
 * add a context-menu dependant to the design-system claims ledger.
 *
 * What the preview supplies is the adapter (`txtAdapter.ts`) and this
 * composition; everything it draws for comments comes from the shared
 * renderer base, unchanged. TEST-ONLY.
 */
import { useMemo, useState } from 'react'
import { txtKind, type TxtParagraph } from '../../../../../../shared/comments/__conformance__/txt/txtKind'
import { CommentDrawer } from '../../CommentDrawer'
import { CommentToolbarTools } from '../../CommentToolbarTools'
import { MARKDOWN_WORDS } from '../../commentCopyWords'
import { CommentWindow } from '../../CommentWindow'
import { CommentWordsContext } from '../../commentWords'
import { CommentOverlayLayer } from '../../overlay/CommentOverlayLayer'
import { useCommentOverlayHost, type RendererCommentSource } from '../../overlay/useCommentOverlayHost'
import { createTxtAdapter } from './txtAdapter'

export const TXT_PANEL_ID = 'editor-notes-txt'
export const TXT_FILE_PATH = '/project/notes.txt'

/** Props for {@link TxtCommentsPreview}. */
export interface TxtCommentsPreviewProps {
  /** The file's text, as the preview shows it. */
  readonly text: string
  /** The file's comments: a mock of `fileCommentGateway` bound to the panel and file. */
  readonly source: RendererCommentSource
}

/** The `.txt` kind's paragraphs of `text`, with their first lines. */
function paragraphsOf(text: string): ReadonlyArray<{ readonly line: number; readonly text: string }> {
  const { index } = txtKind.parse(text, text.startsWith(String.fromCharCode(0xfeff)) ? 1 : 0)
  return (index.elements as readonly TxtParagraph[]).map(el => ({ line: el.line, text: index.visibleText.slice(el.textStart, el.textEnd) }))
}

/**
 * The `.txt` preview.
 *
 * @param props - {@link TxtCommentsPreviewProps}
 * @returns The toolbar tools, then the pane with the scroller and the comment surfaces.
 */
export function TxtCommentsPreview({ text, source }: TxtCommentsPreviewProps): React.JSX.Element {
  const [area, setArea] = useState<HTMLElement | null>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [content, setContent] = useState<HTMLElement | null>(null)
  const adapter = useMemo(() => createTxtAdapter(() => content), [content])
  const paragraphs = useMemo(() => paragraphsOf(text), [text])
  const host = useCommentOverlayHost({
    panelId: TXT_PANEL_ID,
    filePath: TXT_FILE_PATH,
    enabled: true,
    shown: true,
    activePanel: true,
    adapter,
    source,
    scroller,
    area,
    scrollerLabel: 'notes.txt preview',
    paused: null,
    onOpenInSource: () => {}
  })
  return (
    <CommentWordsContext.Provider value={MARKDOWN_WORDS}>
      <div role="toolbar" aria-label="Text tools">
        <CommentToolbarTools {...host.toolbar} />
      </div>
      <div className="txt-preview-pane" ref={setArea}>
        <div className="txt-preview" ref={setScroller}>
          <div className="txt-preview-content" ref={setContent}>
            {paragraphs.map(p => (
              <p key={p.line} data-line-start={p.line} data-line-end={p.line}>
                {p.text}
              </p>
            ))}
          </div>
        </div>
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
        {host.drawer !== null && <CommentDrawer {...host.drawer} />}
        {host.window !== null && <CommentWindow {...host.window} />}
      </div>
    </CommentWordsContext.Provider>
  )
}

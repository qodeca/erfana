// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments – the composition root for one editor panel
 * (spec 024 commit 13; 024-FR-003, 024-FR-005, 024-FR-015, 024-FR-022).
 *
 * The panel stays glue: this hook binds the shared overlay host to the
 * Markdown adapter and to `fileCommentGateway` for this panel and file, and
 * hands back three ready nodes – the toolbar tools, the paused band and the
 * pane overlay. The host's state lives here, above the view modes, so a
 * draft, the drawer and the list outlive a switch to the editor or a split
 * view and come back with the preview-only view (024-AC-006).
 *
 * - **Where:** `.md` and `.markdown` files, while "Comments in Markdown
 *   preview" is on and the window has the bridge. Comment UI shows in the
 *   preview-only view only (OD-03); the editor and split views show the raw
 *   blocks and nothing else.
 * - **Paused:** while any editor tab of this window holds unsaved edits to
 *   the file (`useCommentDirtyGuard`), comments are read-only and the band
 *   offers Save {file} – or Go to editor when the file also changed on disk.
 *   The list is then read from the editor's text, for display only (C-09) –
 *   unless that text is past the Markdown file limit, which main refuses to
 *   take: then it reads the file on disk.
 * - **Breaks:** nothing about `editor.preserveLineBreaks` is sent; main reads
 *   the setting for its render check.
 *
 * @module Editor/markdownComments/useMarkdownComments
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { utf8Length } from '../../../../../shared/comments/encoding'
import {
  FILE_COMMENT_BUFFER_MAX_CHARS,
  type FileCommentListResult,
  type FileCommentSaveRequest,
  type FileCommentSaveResult
} from '../../../../../shared/ipc/file-comment-schema'
import { isMarkdownPreviewCommentsEnabled } from '../../../../../shared/ipc/global-settings-schema'
import { fileCommentGateway } from '../../../services/comments/fileCommentGateway'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import { useProjectStore } from '../../../stores/useProjectStore'
import { useCommentDirtyGuard } from '../../../hooks/useCommentDirtyGuard'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { getBasename, isMarkdownFile } from '../../../utils/fileUtils'
import { CommentToolbarTools } from '../../Comments/CommentToolbarTools'
import { MARKDOWN_WORDS, MD_SURFACE_COPY } from '../../Comments/commentCopyWords'
import { CommentWordsContext } from '../../Comments/commentWords'
import { awaitSavedPin, noteCommentSaveStart } from '../../Comments/overlay/commentTiming'
import { useCommentOverlayHost, type RendererCommentSource } from '../../Comments/overlay/useCommentOverlayHost'
import type { MonacoEditorHandle } from '../MonacoMarkdownEditor'
import type { ViewMode } from '../MarkdownEditorPanel/types'
import { createMarkdownAdapter } from './markdownAdapter'
import { MarkdownCommentsBand } from './MarkdownCommentsBand'
import { MarkdownCommentsOverlay } from './MarkdownCommentsOverlay'

/** Options for {@link useMarkdownComments}. */
export interface UseMarkdownCommentsOptions {
  readonly panelId: string | undefined
  /** The file the panel shows; `undefined` before it loaded. */
  readonly filePath: string | undefined
  /** The editor's text – what the preview renders. */
  readonly content: string
  readonly viewMode: ViewMode
  readonly setViewMode: (mode: ViewMode) => void
  readonly editorRef: RefObject<MonacoEditorHandle | null>
  /** This panel is the active tab (gates the mode shortcut). */
  readonly isActivePanel: boolean
  /** dockview draws this panel. */
  readonly isVisible: boolean
  /**
   * A comment save wrote the file and this panel holds no unsaved edits: read
   * the file now. Main's atomic write has finished when the save answers, and
   * the file watcher's word on it can come late or never – macOS can report a
   * rename over the file as no change – leaving the preview on the old text.
   * The panel must check again after its read that it is still unedited
   * (`useFileWatcher`'s `reloadIfUnedited`): a keystroke during the read wins.
   */
  readonly onFileWritten?: () => void
}

/** What the panel renders; each is `null` when it does not apply. */
export interface MarkdownComments {
  /** The comment tools for the Markdown toolbar (preview-only view). */
  readonly tools: React.ReactNode
  /** The paused band, above the preview. */
  readonly band: React.ReactNode
  /** The overlay for the preview pane (EditorContentLayout draws it in the preview-only view only). */
  readonly overlay: React.ReactNode
  /**
   * Start reading `filePath`'s comments now, as its text arrives and before the
   * preview renders it (024-NFR-001): the host's first list of that file takes
   * this answer instead of asking main again. Does nothing when the file will
   * not list in `mode` (setting off, not Markdown, not the preview-only view,
   * panel hidden). Always present.
   */
  readonly prefetch: (filePath: string, mode: ViewMode) => void
}

/** A list read started before the host asked for it. */
interface EarlyList {
  readonly filePath: string
  readonly answer: Promise<FileCommentListResult>
}

/** A new comment's write, between the save-start and saved-visible marks (024-NFR-001). */
async function timedAdd(request: FileCommentSaveRequest): Promise<FileCommentSaveResult> {
  noteCommentSaveStart()
  const answer = await fileCommentGateway.save(request)
  if (answer.ok && answer.threadKey !== null) awaitSavedPin(answer.threadKey)
  return answer
}

/** The early read of `filePath`, once: the first list of the file takes it. */
function takeEarlyList(early: MutableRefObject<EarlyList | null>, filePath: string): Promise<FileCommentListResult> | null {
  const started = early.current
  early.current = null
  return started !== null && started.filePath === filePath ? started.answer : null
}

/**
 * Wires one editor panel's Markdown Preview comments.
 *
 * @param options - {@link UseMarkdownCommentsOptions}
 * @returns {@link MarkdownComments}
 */
export function useMarkdownComments(options: UseMarkdownCommentsOptions): MarkdownComments {
  const { panelId = '', filePath = '', content, viewMode, setViewMode, editorRef, isActivePanel, isVisible } = options
  const settingOn = useGlobalSettingsStore(s => s.settings !== null && isMarkdownPreviewCommentsEnabled(s.settings))
  const enabled = settingOn && panelId !== '' && filePath !== '' && isMarkdownFile(filePath) && fileCommentGateway.available()
  const shown = viewMode === 'preview' && isVisible
  const fileName = getBasename(filePath)

  // The pane, from the overlay's hidden marker; the scroller is the preview beside it, captured when the
  // marker binds – never by a DOM query during render. The overlay mounts only in the preview-only view,
  // in the same commit as that view's (keyed) preview, so the preview is in the pane by then.
  const [pane, setPane] = useState<{ readonly area: HTMLElement; readonly scroller: HTMLElement | null } | null>(null)
  const bindPane = useCallback((marker: HTMLElement | null) => {
    const area = marker?.parentElement ?? null
    setPane(area === null ? null : { area, scroller: area.querySelector<HTMLElement>(':scope > .markdown-preview') })
  }, [])
  const area = pane?.area ?? null
  const scroller = pane?.scroller ?? null

  // Rebuilt for a new scroller or text: in the preview-only view the text changes only on a reload.
  const adapter = useMemo(
    () =>
      createMarkdownAdapter({
        root: () => scroller?.querySelector<HTMLElement>('.markdown-preview-content') ?? null,
        text: () => content
      }),
    [scroller, content]
  )
  // 024-NFR-001: the list read started with the file's load, while the preview renders (see `prefetch`).
  const early = useRef<EarlyList | null>(null)
  const fileWrittenRef = useLatestRef(options.onFileWritten)
  const source = useMemo<RendererCommentSource>(
    () => ({
      list: bufferText => {
        const started = bufferText === undefined ? takeEarlyList(early, filePath) : null
        return started ?? fileCommentGateway.list({ panelId, filePath, ...(bufferText === undefined ? {} : { bufferText }) })
      },
      openDraft: target => fileCommentGateway.openDraft({ panelId, filePath, ...(target === undefined ? {} : { target }) }),
      save: async request => {
        const answer = await (request.op === 'add' ? timedAdd(request) : fileCommentGateway.save(request))
        // The written text reaches the preview from the save itself, not only from the watcher.
        if (answer.ok && !useProjectStore.getState().dirtyPanelIds.has(panelId)) fileWrittenRef.current?.()
        return answer
      },
      onChanged: callback =>
        fileCommentGateway.onChanged(payload => {
          if (payload.panelId === panelId) callback()
        })
    }),
    [panelId, filePath, fileWrittenRef]
  )
  const visibleRef = useLatestRef(isVisible)
  const prefetch = useCallback(
    (path: string, mode: ViewMode) => {
      early.current = null
      const settings = useGlobalSettingsStore.getState().settings
      const willList =
        settings !== null &&
        isMarkdownPreviewCommentsEnabled(settings) &&
        panelId !== '' &&
        isMarkdownFile(path) &&
        fileCommentGateway.available() &&
        mode === 'preview' &&
        visibleRef.current
      if (willList) early.current = { filePath: path, answer: fileCommentGateway.list({ panelId, filePath: path }) }
    },
    [panelId, visibleRef]
  )

  // Paused while any editor of this window holds unsaved edits (F-02), or those and a change on disk (F-03).
  const guard = useCommentDirtyGuard(enabled ? filePath : null)
  const paused =
    guard.state === 'clean'
      ? null
      : guard.state === 'conflict'
        ? MD_SURFACE_COPY.pausedConflictReason(fileName)
        : MD_SURFACE_COPY.paused(fileName)

  // Main refuses a buffer past the Markdown file limit; the length check first spares the byte count.
  // Counted only while the buffer is sent at all – comments on and paused – never per keystroke otherwise.
  const sendsBuffer = enabled && paused !== null
  const bufferListable = useMemo(
    () => sendsBuffer && content.length <= FILE_COMMENT_BUFFER_MAX_CHARS && utf8Length(content) <= FILE_COMMENT_BUFFER_MAX_CHARS,
    [sendsBuffer, content]
  )

  const openInSource = useCallback(
    (line: number) => {
      setViewMode('editor')
      requestAnimationFrame(() => requestAnimationFrame(() => editorRef.current?.setPositionAndReveal(line)))
    },
    [setViewMode, editorRef]
  )

  const host = useCommentOverlayHost({
    panelId,
    filePath,
    enabled,
    shown,
    activePanel: isActivePanel,
    adapter,
    source,
    scroller,
    area,
    scrollerLabel: MD_SURFACE_COPY.previewName(fileName),
    paused,
    ...(paused === null || !bufferListable ? {} : { bufferText: content }),
    onOpenInSource: openInSource
  })
  // The host's list effect ran just above, in the commit that showed this file, and took the early
  // read if it wanted it. An early read left over now is not waited for later: it could be old.
  useEffect(() => {
    if (early.current?.filePath === filePath) early.current = null
  })
  // A closed tab's list, drawer and mode go with it: the same file opened again reads afresh and
  // says "Reading comments…" meanwhile, instead of showing the old list (024-NFR-001). Main forgets
  // the panel and ends its file watch too, so closed tabs do not hold the 64-watch budget.
  useEffect(
    () => () => {
      usePreviewCommentStore.getState().drop(panelId)
      if (panelId !== '') void fileCommentGateway.release({ panelId })
    },
    [panelId]
  )

  const goToEditor = useCallback(() => {
    // This panel's own edits: its editor view. Another tab's: that tab.
    if (useProjectStore.getState().dirtyPanelIds.has(panelId)) setViewMode('editor')
    else guard.goToTab()
  }, [panelId, setViewMode, guard])

  if (!enabled) return { tools: null, band: null, overlay: null, prefetch }
  return {
    prefetch,
    tools:
      viewMode === 'preview' ? (
        <CommentWordsContext.Provider value={MARKDOWN_WORDS}>
          <CommentToolbarTools {...host.toolbar} />
        </CommentWordsContext.Provider>
      ) : null,
    band:
      host.shown && guard.state !== 'clean' ? (
        <MarkdownCommentsBand
          file={fileName}
          conflict={guard.state === 'conflict'}
          onSave={() => void guard.save()}
          onGoToEditor={goToEditor}
        />
      ) : null,
    overlay: (
      <MarkdownCommentsOverlay
        host={host}
        adapter={adapter}
        filePath={filePath}
        content={content}
        bindPane={bindPane}
        area={area}
        scroller={scroller}
      />
    )
  }
}

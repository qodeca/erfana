// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HtmlPreviewPanel Component (Issue #74, work item 71).
 *
 * The user-visible half of the running HTML preview. The page itself renders in
 * a native `WebContentsView` in its own process; this component renders only a
 * sized, background-coloured DOM **placeholder** the native view paints over,
 * and the chrome around it:
 *
 * - a `ResizeObserver`-driven bounds pump keeping the native view aligned with
 *   the placeholder (via {@link usePreviewBounds});
 * - `preview:open` on mount / `preview:close` on unmount (via
 *   {@link usePreviewLifecycle});
 * - the still-frame/placeholder fallback, the limit-reached refusal and the
 *   failed banner — all selected by pure functions in `htmlPreview.logic.ts`
 *   (the failure badge lives in `HtmlPreviewTab`, which is always-DOM chrome
 *   the native view never occludes);
 * - a memoised {@link PreviewPageSearchProvider} rendered against the shared
 *   {@link SearchBar} for find-in-page.
 *
 * This file is deliberately glue only: state lives in `hooks/`, chrome lives in
 * `components/`, and every decision lives in `htmlPreview.logic.ts` — mirroring
 * the `ImageViewerPanel` split.
 *
 * @module HtmlPreviewPanel
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'

import { getBasename } from '../../../utils/fileUtils'
import { openFileInPanel } from '../../../utils/openFileInPanel'
import { useSearchKeyboard } from '../../../hooks/useSearchKeyboard'
import { PreviewPageSearchProvider } from '../../../providers/search'
import { usePreviewStore } from '../../../stores/usePreviewStore'
import { useSearchStore } from '../../../stores/useSearchStore'
import { useOverlayOccluderStore } from '../../../stores/useOverlayOccluderStore'
import { SearchBar } from '../../Search/SearchBar'
import { PreviewBanner, PreviewFallback } from './components'
import {
  usePreviewBounds,
  usePreviewEvents,
  usePreviewFindShortcuts,
  usePreviewLifecycle
} from './hooks'
import { exportPreviewPdf } from './previewPdfExport'
import { selectFallback, selectPanelView } from './htmlPreview.logic'
import './HtmlPreviewPanel.css'

/** Parameters passed to {@link HtmlPreviewPanel} via dockview. */
export interface HtmlPreviewPanelParams {
  /** Absolute path to the previewed `.html` file. */
  filePath: string
  /** Unique panel identifier. */
  panelId?: string
}

/** User-facing copy, centralised so a change is one edit (sentence case, en dashes). */
const COPY = {
  /** Failed-state banner headline. */
  failed: 'The preview stopped running.',
  /** Failed-state primary action. */
  reload: 'Reload',
  /** Limit-reached banner headline (this file is previewed in another window). */
  limitReached: 'This file is already previewed in another window.',
  /** Limit-reached primary action. */
  openAsSource: 'Open as source'
} as const

/**
 * Running HTML preview panel.
 *
 * @param props - Dockview panel props with `filePath` in `params`.
 * @returns The rendered preview panel.
 *
 * @example
 * ```tsx
 * dockviewApi.addPanel({
 *   id: 'preview-1',
 *   component: 'htmlPreview',
 *   renderer: 'always',
 *   params: { filePath: '/proj/page.html' }
 * })
 * ```
 */
export function HtmlPreviewPanel(props: IDockviewPanelProps<HtmlPreviewPanelParams>): JSX.Element {
  const { params, api, containerApi } = props
  const filePath = params?.filePath || ''
  const panelId = params?.panelId || api.id

  const placeholderRef = useRef<HTMLDivElement>(null)

  // ========================================
  // Visibility + occlusion
  // ========================================

  // dockview visibility tracks the active tab (the panel uses renderer:'always',
  // so its DOM stays mounted even when inactive — §5(a) X12).
  const [isVisible, setIsVisible] = useState<boolean>(api?.isVisible ?? true)
  useEffect(() => {
    if (!api?.onDidVisibilityChange) return
    setIsVisible(api.isVisible ?? true)
    const disposable = api.onDidVisibilityChange((event) => setIsVisible(event.isVisible))
    return () => disposable.dispose()
  }, [api])

  // Re-derive occlusion whenever the occluder store publishes (its microtask
  // flush bumps `version`); `isOccluded()` reads the settled live counts.
  const occluderVersion = useOverlayOccluderStore((s) => s.version)
  const isOccluded = useMemo(
    () => useOverlayOccluderStore.getState().isOccluded(),
    [occluderVersion]
  )

  // The native view is hidden when this tab is inactive OR something occludes it;
  // that is exactly when the still-frame fallback should show (design §1.4).
  const isViewHidden = !isVisible || isOccluded

  // ========================================
  // Lifecycle, events, bounds, shortcuts
  // ========================================

  const { limitReached, openFailed } = usePreviewLifecycle({
    panelId,
    filePath,
    placeholderRef,
    isVisible
  })

  usePreviewEvents(panelId)
  // Renderer-focus Cmd/Ctrl+F (view hidden). The sealed-page case is forwarded
  // by usePreviewFindShortcuts; both converge on the search store.
  useSearchKeyboard()

  // The find bar is open → inset the native view from the top so the DOM bar is
  // not occluded by it (UX-002). Only meaningful while this tab is visible.
  const isSearchOpen = useSearchStore((s) => s.isOpen)

  // ========================================
  // Store-derived UI state
  // ========================================

  // Select the panel ENTRY (stable object reference) and derive with stable
  // fallbacks — selecting `getFailures(panelId)` directly would return a fresh
  // `[]` each render and loop `useSyncExternalStore`.
  //
  // Read BEFORE the bounds hook: `loadState` is what tells that hook a native
  // view exists to receive a rect, and main drops one sent any earlier.
  const panel = usePreviewStore((s) => s.panels.get(panelId))
  const loadState = panel?.loadState ?? 'idle'
  const stillFrame = panel?.stillFrame ?? null
  // Main reports the colour it paints behind the page; the placeholder carries
  // the identical value so no seam ever shows a band of the wrong colour.
  const backdrop = panel?.backdrop ?? null

  // The hook owns every push, including the one on becoming visible: a tab
  // switch changes no size, so the `ResizeObserver` alone would not re-emit.
  usePreviewBounds({
    placeholderRef,
    panelId,
    enabled: !limitReached && !openFailed,
    isVisible,
    // Main emits the first non-idle load state AFTER installing the view, so
    // this is the earliest point a `setBounds` is not thrown away.
    isLive: loadState !== 'idle',
    searchOpen: isVisible && isSearchOpen
  })

  const view = selectPanelView({
    limitReached,
    loadState: openFailed ? 'failed' : loadState
  })
  const fallbackKind = selectFallback({ hasFrame: stillFrame !== null, isViewHidden })

  // ========================================
  // Find provider (X15b: memoised on panelId)
  // ========================================

  const searchProvider = useMemo(
    () => new PreviewPageSearchProvider(panelId, window.api.preview),
    [panelId]
  )
  useEffect(() => () => searchProvider.dispose(), [searchProvider])

  // ========================================
  // Forwarded-accelerator actions (view on top swallows renderer keys)
  // ========================================

  // Forwarded Escape must close the find bar the SAME way SearchBar.handleClose
  // does — clear the provider's highlights and restore focus — not just flip the
  // store flag (UX-007). A no-op when the bar is already closed.
  const closePreviewSearch = useCallback(() => {
    const { isOpen, closeSearch, restoreFocus } = useSearchStore.getState()
    if (!isOpen) return
    searchProvider.clearHighlights()
    closeSearch()
    restoreFocus()
  }, [searchProvider])

  const openPreviewSearch = useCallback(() => useSearchStore.getState().openSearch(), [])
  const exportPdf = useCallback(() => void exportPreviewPdf(panelId), [panelId])
  // Cmd/Ctrl+W closes the panel via the dockview api, matching how the tab
  // close button and MarkdownEditorPanel close a panel (UX-006).
  const closePanel = useCallback(() => api.close(), [api])

  usePreviewFindShortcuts(panelId, {
    openSearch: openPreviewSearch,
    closeSearch: closePreviewSearch,
    exportPdf,
    closePanel
  })

  // ========================================
  // Tab title
  // ========================================

  useEffect(() => {
    if (!api?.setTitle || !filePath) return
    api.setTitle(getBasename(filePath) || 'Preview')
  }, [api, filePath])

  // ========================================
  // Actions
  // ========================================

  const openAsSource = (): void => {
    openFileInPanel(containerApi, filePath, { kind: 'editor' })
  }
  const reload = (): void => {
    void window.api.preview.reload(panelId)
  }

  // ========================================
  // Render
  // ========================================

  return (
    <div className="html-preview-panel">
      {/* Find-in-page overlay; only the active tab shows it. */}
      {isVisible && <SearchBar provider={searchProvider} />}

      {view === 'limit-reached' && (
        <PreviewBanner
          message={COPY.limitReached}
          actionLabel={COPY.openAsSource}
          onAction={openAsSource}
        />
      )}

      {view === 'failed' && (
        <PreviewBanner
          message={COPY.failed}
          actionLabel={COPY.reload}
          onAction={reload}
          autoFocusAction
        />
      )}

      {view === 'normal' && (
        <div className="html-preview-surface">
          {/* The failure indicator (AC20) lives in the tab, not here: the native
              WebContentsView paints above all sibling DOM in this surface, so a
              badge here would be invisible while the page runs. See
              HtmlPreviewTab + PreviewFailureBadge (design §1.8). */}
          {/* The sized, brand-black target the native WebContentsView paints
              over. The fallback layer sits behind it for the hidden case. */}
          {/* Name the surface for assistive tech: while the native view is hidden
              (inactive tab, overlay, pre-paint) its own a11y tree is gone, so
              without a label a screen reader finds only an unnamed black region. */}
          {/* `role="img"` is correct ONLY while the native view is hidden and the
              placeholder really is a picture (a still frame) or a flat colour.
              While the view is live the user is looking at a running, scrollable
              document, and `role="img"` would both mislabel it and make its
              subtree presentational. `aria-busy` carries the "not readable yet"
              state that is otherwise visual-only. */}
          <div
            ref={placeholderRef}
            className="html-preview-placeholder"
            style={backdrop !== null ? { background: backdrop } : undefined}
            role={isViewHidden ? 'img' : 'group'}
            aria-busy={loadState === 'loading' || loadState === 'idle'}
            aria-label={`HTML preview of ${getBasename(filePath) || 'page'}`}
          >
            <PreviewFallback kind={fallbackKind} stillFrame={stillFrame} />
          </div>
        </div>
      )}
    </div>
  )
}

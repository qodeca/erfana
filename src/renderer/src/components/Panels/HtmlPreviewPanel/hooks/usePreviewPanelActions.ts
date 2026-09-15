// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewPanelActions hook (issue #124).
 *
 * Every action the HTML preview panel can take on the reader's behalf, in one
 * place: approve a host, open or close find, export to PDF, open the page in
 * the default browser, close the panel, open the file as source, reload – and
 * the two banners' words, which name those
 * last two actions. The toolbar buttons, the two banners and the forwarded
 * accelerators all reach the SAME functions, so a key and a button can never
 * drift apart – the export's in-flight guard, for one, covers both.
 *
 * It also wires those actions to the forwarded accelerators
 * ({@link usePreviewFindShortcuts}), because the shortcut table is just another
 * caller of them – forwarded Back and Forward included, which step the tab's
 * history through the panel's navigation (origin `page`), and it owns what a
 * move to another page does to the find bar and the host list.
 *
 * The panel keeps what is not an action: the find provider (the `SearchBar`
 * renders against it too), the chip ref (the band mounts it) and every piece of
 * view state. This hook reads those, it does not own them.
 *
 * @module usePreviewPanelActions
 * @see Issue #124 - multi-page HTML preview
 */

import { useCallback, useRef, useState } from 'react'
import type { DockviewApi, IDockviewPanelProps } from 'dockview'

import type { PreviewApproveResult } from '../../../../../../shared/ipc/preview-types'
import type { PreviewPageSearchProvider } from '../../../../providers/search'
import type { PreviewBannerProps } from '../components'
import { useSearchStore } from '../../../../stores/useSearchStore'
import { openFileInPanel } from '../../../../utils/openFileInPanel'
import { exportPreviewPdf } from '../previewPdfExport'
import { openInDefaultBrowser } from '../previewOpenInBrowser'
import { usePreviewFindShortcuts } from './usePreviewFindShortcuts'
import type { PreviewNavigation } from './usePreviewNavigation'

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

/** Options for {@link usePreviewPanelActions}. */
export interface UsePreviewPanelActionsOptions {
  /** The preview panel id; every IPC action is addressed by it. */
  panelId: string
  /**
   * Absolute path of the page the tab shows now (`params.filePath`), which
   * "Open as source" and "Open in default browser" act on.
   */
  filePath: string
  /** The panel's own dockview api; Cmd/Ctrl+W closes the panel through it. */
  api: Pick<IDockviewPanelProps['api'], 'close'>
  /** The dockview container "Open as source" adds the editor tab to. */
  containerApi: DockviewApi
  /** The find provider whose highlights a forwarded Escape clears. */
  searchProvider: Pick<PreviewPageSearchProvider, 'clearHighlights'>
  /** The band's chip; a forwarded Escape with the find bar closed focuses it. */
  chipRef: React.RefObject<HTMLButtonElement>
  /**
   * The panel's navigation (issue #124): forwarded Back and Forward step
   * through it, a closed find bar hands focus to its Back, and the failed
   * banner takes its move-caused text and return button. The panel always
   * passes it; without it those keys do nothing and the banner is today's.
   */
  navigation?: Pick<PreviewNavigation, 'step' | 'focusBack' | 'failedBanner'>
  /** The panel root; tells THIS panel's find bar apart from another's. */
  panelRootRef?: React.RefObject<HTMLElement>
  /** Filled by the band with its host-list collapse (`PreviewChromeBand.collapseRef`). */
  bandCollapseRef?: React.MutableRefObject<(() => void) | null>
}

/** Stands in for a missing `navigation`: no history to step, no banner changes. */
const NO_NAVIGATION: Pick<PreviewNavigation, 'step' | 'focusBack' | 'failedBanner'> = {
  step: async () => null,
  focusBack: () => {},
  failedBanner: { message: null }
}

/** Result of {@link usePreviewPanelActions}: what the panel's chrome calls. */
export interface PreviewPanelActions {
  /** Approve one host for this panel's project, resolving with main's answer. */
  approveHost: (host: string) => Promise<PreviewApproveResult>
  /** Open the find bar. */
  openSearch: () => void
  /** Export the page to PDF; ignored while an export is already in flight. */
  exportPdf: () => void
  /** An export is in flight, from the press until its save dialog settles. */
  exportingPdf: boolean
  /** Open the page the tab shows now in the default browser; ignored while one is in flight. */
  openInBrowser: () => void
  /** An open-in-browser request is in flight, from the press until main answers. */
  openingInBrowser: boolean
  /** This file is previewed in another window: the text, and "Open as source". */
  limitReachedBanner: PreviewBannerProps
  /**
   * The preview stopped running: the text, and Reload – which takes focus when
   * the banner mounts, since a keyboard reader is mid-flow here (UX-008). After
   * a same-tab move onto a broken page, the move-caused text and a return
   * button that leads (issue #124, part 3 §3.8).
   */
  failedBanner: PreviewBannerProps
  /**
   * The tab moved to another page: collapse the host list and close this
   * panel's find bar – focus in it goes to Back (UX spec §1.6, RU6). For
   * `usePreviewEvents`' `onLeavePage`.
   */
  leavePage: () => void
}

/**
 * Builds the preview panel's actions and routes the forwarded accelerators to
 * them.
 *
 * Must be called once per panel: the forwarded-shortcut subscription it makes is
 * filtered by `panelId`, and a second call would run every accelerator twice.
 *
 * @param options - The panel's id, file, dockview apis, find provider, chip ref,
 *   navigation, root and band collapse handle.
 * @returns The actions the band calls, their busy flags, both banners' props
 *   and the leave-page step.
 *
 * @example
 * ```tsx
 * const { approveHost, openSearch, exportPdf, exportingPdf, openInBrowser, openingInBrowser,
 *   limitReachedBanner, failedBanner } = usePreviewPanelActions({
 *     panelId,
 *     filePath,
 *     api,
 *     containerApi,
 *     searchProvider,
 *     chipRef: bandChipRef,
 *     navigation,
 *     panelRootRef,
 *     bandCollapseRef
 *   })
 *
 * <PreviewChromeBand onFind={openSearch} onExportPdf={exportPdf} onOpenInBrowser={openInBrowser} … />
 * {view === 'failed' && <PreviewBanner {...failedBanner} />}
 * ```
 */
export function usePreviewPanelActions({
  panelId,
  filePath,
  api,
  containerApi,
  searchProvider,
  chipRef,
  navigation = NO_NAVIGATION,
  panelRootRef,
  bandCollapseRef
}: UsePreviewPanelActionsOptions): PreviewPanelActions {
  /**
   * Approve one host, and RETURN the result.
   *
   * The old toast called this with `void`, so a `{ok: false}` — a read-only
   * checkout, a full allowlist, a settings file that would not parse — was
   * thrown away and the prompt simply vanished. The reader had no way to tell a
   * successful grant from a failed one, and the failure survived a restart.
   */
  const approveHost = useCallback(
    (host: string) => window.api.preview.approveHost(panelId, host),
    [panelId]
  )

  // Forwarded Escape must close the find bar the SAME way SearchBar.handleClose
  // does — clear the provider's highlights and restore focus — not just flip the
  // store flag (UX-007). A no-op when the bar is already closed.
  const closeSearch = useCallback(() => {
    const { isOpen, closeSearch: close, restoreFocus } = useSearchStore.getState()
    if (!isOpen) return
    searchProvider.clearHighlights()
    close()
    restoreFocus()
  }, [searchProvider])

  const openSearch = useCallback(() => useSearchStore.getState().openSearch(), [])

  // A save dialog is modal to the OS, so a second click while the first is open
  // would queue a second one behind it. `MarkdownToolbar` disables its button the
  // same way; the shortcut route is guarded by the same ref. A ref, not an
  // updater: the export used to start inside `setExportingPdf(current => …)`,
  // and StrictMode runs an updater twice, so one press opened two dialogs.
  const [exportingPdf, setExportingPdf] = useState(false)
  const exportPdfInFlight = useRef(false)
  const exportPdf = useCallback(() => {
    if (exportPdfInFlight.current) return
    exportPdfInFlight.current = true
    setExportingPdf(true)
    void exportPreviewPdf(panelId).finally(() => {
      exportPdfInFlight.current = false
      setExportingPdf(false)
    })
  }, [panelId])

  // Busy from the press until main answers (UX spec #124 §1.4). A ref, not the
  // state, guards re-entry: two presses inside one frame both read the old
  // `openingInBrowser` before React re-renders. `filePath` is the page the tab
  // shows NOW – a same-tab move commits a new one, which rebuilds this callback.
  const [openingInBrowser, setOpeningInBrowser] = useState(false)
  const openInBrowserInFlight = useRef(false)
  const openInBrowser = useCallback(() => {
    if (openInBrowserInFlight.current) return
    openInBrowserInFlight.current = true
    setOpeningInBrowser(true)
    // Never rejects: every failure is a toast raised inside the action.
    void openInDefaultBrowser(filePath).finally(() => {
      openInBrowserInFlight.current = false
      setOpeningInBrowser(false)
    })
  }, [filePath])

  // Cmd/Ctrl+W closes the panel via the dockview api, matching how the tab
  // close button and MarkdownEditorPanel close a panel (UX-006).
  const closePanel = useCallback(() => api.close(), [api])

  // A move to another document (UX spec §1.6). The search store is global, so
  // the bar is closed only when it is THIS panel's – rendered inside this root.
  // Focus in it goes to Back: a move never puts focus into the page on its own
  // (RU6) – only the reader's Enter on the placeholder does (QG-8 U1).
  const { step, focusBack } = navigation
  const leavePage = useCallback(() => {
    bandCollapseRef?.current?.()
    const bar = panelRootRef?.current?.querySelector('.search-bar')
    const search = useSearchStore.getState()
    if (!bar || !search.isOpen) return
    const hadFocus = bar.contains(document.activeElement)
    searchProvider.clearHighlights()
    search.closeSearch()
    // The focus saved when find opened belongs to the old page's chrome.
    search.savePreviousFocus(null)
    if (hadFocus) focusBack()
  }, [bandCollapseRef, panelRootRef, searchProvider, focusBack])

  usePreviewFindShortcuts(panelId, {
    openSearch,
    // Read at call time, not captured: the actions object is held in a ref by
    // the hook, so a captured boolean would be the value from first mount.
    isSearchOpen: () => useSearchStore.getState().isOpen,
    closeSearch,
    exportPdf,
    closePanel,
    focusChrome: () => chipRef.current?.focus(),
    // Focus was in the page, so the page's own title announcement covers it.
    goBack: () => void step('back', 'page'),
    goForward: () => void step('forward', 'page')
  })

  const openAsSource = useCallback(() => {
    openFileInPanel(containerApi, filePath, { kind: 'editor' })
  }, [containerApi, filePath])

  const reload = useCallback(() => {
    void window.api.preview.reload(panelId)
  }, [panelId])

  return {
    approveHost,
    openSearch,
    exportPdf,
    exportingPdf,
    openInBrowser,
    openingInBrowser,
    limitReachedBanner: {
      message: COPY.limitReached,
      actionLabel: COPY.openAsSource,
      onAction: openAsSource
    },
    failedBanner: {
      message: navigation.failedBanner.message ?? COPY.failed,
      actionLabel: COPY.reload,
      onAction: reload,
      autoFocusAction: true,
      returnAction: navigation.failedBanner.returnAction
    },
    leavePage
  }
}

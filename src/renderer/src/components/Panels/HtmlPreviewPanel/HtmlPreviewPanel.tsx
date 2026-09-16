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
 * - a per-frame measure loop keeping the native view aligned with the
 *   placeholder (via {@link usePreviewBounds});
 * - `preview:open` on mount / `preview:close` on unmount (via
 *   {@link usePreviewLifecycle});
 * - the still-frame/placeholder fallback, the limit-reached refusal and the
 *   failed banner — all selected by pure functions in `htmlPreview.logic.ts`
 *   (the failure badge lives in `HtmlPreviewTab`, which is always-DOM chrome
 *   the native view never occludes);
 * - the drag freeze's panel half (issue #124): a window-edge hold counts as
 *   hidden, a drag's picture or backdrop stays until the page is back, and the
 *   release pushes the settled rect (via `useSplitterDragFreeze`);
 * - a memoised {@link PreviewPageSearchProvider} rendered against the shared
 *   {@link SearchBar} for find-in-page;
 * - Back, the link-mode toggle and the Back/Forward keys, and the polite region
 *   a same-tab move is announced in (via {@link usePreviewNavigation}).
 *
 * This file is deliberately glue only: state lives in `hooks/`, chrome lives in
 * `components/`, and every decision lives in `htmlPreview.logic.ts` — mirroring
 * the `ImageViewerPanel` split.
 *
 * @module HtmlPreviewPanel
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'

import { getBasename } from '../../../utils/fileUtils'
import { usePreviewDragFreezeTarget } from '../../../hooks/useSplitterDragFreeze'
import { useSearchKeyboard } from '../../../hooks/useSearchKeyboard'
import { PreviewPageSearchProvider } from '../../../providers/search'
import { usePreviewStore } from '../../../stores/usePreviewStore'
import { usePreviewTabStore, type PreviewLinkMode } from '../../../stores/usePreviewTabStore'
import { useSearchStore } from '../../../stores/useSearchStore'
import { useOverlayOccluderStore } from '../../../stores/useOverlayOccluderStore'
import { SearchBar } from '../../Search/SearchBar'
import { PreviewChromeBand } from './components/PreviewChromeBand'
import { usePreviewChromeGate } from './hooks/usePreviewChromeGate'
import type { PreviewBlockedHost } from '../../../stores/usePreviewStore'
import { PreviewBanner, PreviewFallback, PreviewFindTool, PreviewNavControls } from './components'
import {
  usePreviewBounds,
  usePreviewEvents,
  usePreviewLifecycle,
  usePreviewNavigation,
  usePreviewPageEntry,
  usePreviewPanelActions
} from './hooks'
import { previewPlaceholderLabel, selectFallback, selectPanelView } from './htmlPreview.logic'
import './HtmlPreviewPanel.css'

/** Parameters passed to {@link HtmlPreviewPanel} via dockview. */
export interface HtmlPreviewPanelParams {
  /**
   * The page this tab shows NOW (issue #124). It changes on a same-tab move –
   * main's `pageChanged` writes it through `updateParameters` – while the panel
   * id and the native view stay.
   */
  filePath: string
  /** Unique panel identifier; never changes, and never names the page. */
  panelId?: string
  /**
   * The link mode a tab opened by a link inherits from its source tab. Seeds
   * the tab store once; after that the store is the record.
   */
  linkMode?: PreviewLinkMode
}

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
/** Stable empty lists. A fresh `[]` inside a selector loops `useSyncExternalStore`. */
const NO_BLOCKED_HOSTS: readonly PreviewBlockedHost[] = []
const NO_ALLOWED_HOSTS: readonly string[] = []

export function HtmlPreviewPanel(props: IDockviewPanelProps<HtmlPreviewPanelParams>): JSX.Element {
  const { params, api, containerApi } = props
  const filePath = params?.filePath || ''
  const panelId = params?.panelId || api.id

  const placeholderRef = useRef<HTMLDivElement>(null)
  /**
   * The band's disclosure chip.
   *
   * Held here, not in the band, because the PANEL owns the forwarded Escape: a
   * key pressed inside the previewed page arrives on this side of the IPC
   * boundary, and returning focus to the chip is the documented way out of the
   * page (WCAG SC 2.1.2 asks for an exit that is stated, and the chip's
   * accessible name states it).
   */
  const bandChipRef = useRef<HTMLButtonElement>(null)
  /** The panel root, measured for the band's too-short fail-safe. */
  const panelRootRef = useRef<HTMLDivElement>(null)
  /** The band fills this with its host-list collapse; a page change calls it. */
  const bandCollapseRef = useRef<(() => void) | null>(null)
  /**
   * The band wants to expose controls, so the page has to prove it moved.
   *
   * Held here rather than inside the band because the fail-safe spans the panel:
   * the geometry it proves is the panel's, and the visibility it gates belongs to
   * the overlay guard.
   */
  const [bandExpanded, setBandExpanded] = useState(false)

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
  // NB: the gate's own term is added below, once the hook has run — a gated
  // panel must show its still frame, not a blank backdrop, and `selectFallback`
  // reads this flag.
  const isViewHiddenBase = !isVisible || isOccluded

  // ========================================
  // Lifecycle, events, bounds, shortcuts
  // ========================================

  const { limitReached, openFailed } = usePreviewLifecycle({
    panelId,
    filePath,
    placeholderRef,
    isVisible
  })

  // Seed this tab's UI state. A no-op when the entry exists – the store
  // outlives an error-boundary remount, so a crash never resets the mode.
  const seedLinkMode = params?.linkMode
  useEffect(() => {
    usePreviewTabStore.getState().seed(panelId, seedLinkMode)
  }, [panelId, seedLinkMode])

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
  // The permission band's data. Both are append-only/replace-only records held
  // by the store, so the reference is stable between changes.
  const blockedHosts = panel?.blockedHosts ?? NO_BLOCKED_HOSTS
  const allowedHosts = panel?.allowedHosts ?? NO_ALLOWED_HOSTS
  const blockedHostsTruncated = panel?.blockedHostsTruncated ?? false
  // The drag freeze (issue #124, part 1 §1.5). Main hides the view for a
  // window-edge hold without the guard knowing, so it counts as hidden here;
  // the latch keeps what a drag's hide showed until the page is confirmed back.
  const resizeHeld = panel?.resizeHeld ?? false
  const dragHideLatched = panel?.dragHideLatched ?? false

  const { gate, controlsAllowed, ackController } = usePreviewChromeGate({
    panelId,
    needsProof: bandExpanded,
    panelRef: panelRootRef
  })

  const isViewHidden = isViewHiddenBase || gate !== null || resizeHeld

  // The hook owns every push, including the one on becoming visible: a tab
  // switch changes no size, so the `ResizeObserver` alone would not re-emit.
  // Computed BEFORE the bounds hook, because it is what decides whether the
  // placeholder exists at all — and the hook's `enabled` has to mean exactly
  // that. It used to be `!limitReached && !openFailed`, which stayed true for a
  // FAILED load: the placeholder was already gone, so nothing could be pushed,
  // and nothing cleared the rect that had been published for it either.
  const view = selectPanelView({
    limitReached,
    loadState: openFailed ? 'failed' : loadState
  })

  const { pushBounds } = usePreviewBounds({
    placeholderRef,
    panelRef: panelRootRef,
    ackController,
    panelId,
    // `'normal'` is precisely "there is a placeholder to measure".
    enabled: view === 'normal',
    isVisible,
    // Main emits the first non-idle load state AFTER installing the view, so
    // this is the earliest point a `setBounds` is not thrown away. `suspended`
    // is excluded for the mirror reason — the view has been evicted, so the
    // published rect describes nothing, which is also how the overlay guard
    // reads that state.
    isLive: loadState !== 'idle' && loadState !== 'suspended',
    searchOpen: isVisible && isSearchOpen
  })
  // A splitter drag's release pushes the settled rect before the page returns.
  usePreviewDragFreezeTarget(panelId, pushBounds)
  const fallbackKind = selectFallback({ hasFrame: stillFrame !== null, isViewHidden })

  // The keyboard's way into the page (issue #124, QG-8 U1). Offered only while
  // there IS a drawn, running page to enter: the `isLive` term the bounds loop
  // uses, and the hidden term the fallback uses.
  const pageEntry = usePreviewPageEntry({
    panelId,
    api,
    pageLive:
      view === 'normal' && !isViewHidden && loadState !== 'idle' && loadState !== 'suspended'
  })

  // After `view`: focus goes to Back only once the band that holds it exists.
  const navigation = usePreviewNavigation({ panelId, filePath, view, containerApi })

  // ========================================
  // Find provider (X15b: memoised on panelId)
  // ========================================

  const searchProvider = useMemo(
    () => new PreviewPageSearchProvider(panelId, window.api.preview),
    [panelId]
  )
  useEffect(() => () => searchProvider.dispose(), [searchProvider])

  // ========================================
  // Actions: toolbar, banners and forwarded accelerators (the view on top
  // swallows renderer keys, so main forwards them)
  // ========================================

  const {
    approveHost,
    openSearch,
    exportPdf,
    exportingPdf,
    openInBrowser,
    openingInBrowser,
    limitReachedBanner,
    failedBanner,
    leavePage
  } = usePreviewPanelActions({
    panelId,
    filePath,
    api,
    containerApi,
    searchProvider,
    chipRef: bandChipRef,
    navigation,
    panelRootRef,
    bandCollapseRef
  })

  usePreviewEvents(panelId, {
    api,
    filePath,
    onLeavePage: leavePage,
    onPageChanged: navigation.onPageChanged,
    pushSettledBounds: () => pushBounds({ settled: true })
  })

  // ========================================
  // Tab title
  // ========================================

  useEffect(() => {
    if (!api?.setTitle || !filePath) return
    api.setTitle(getBasename(filePath) || 'Preview')
  }, [api, filePath])

  // ========================================
  // Render
  // ========================================

  return (
    // Back/Forward keys with focus anywhere in THIS panel's chrome – a React
    // handler on the root, so another panel's keys never reach it (§3.7).
    <div className="html-preview-panel" ref={panelRootRef} onKeyDown={navigation.onRootKeyDown}>
      {/* Move announcements (part 3 §3.8, RU3-1). On the ROOT, mounted in every
          view: a move started from the failed banner mounts the band in the
          same render it lands, and a live region created with its text is not
          announced. The band's own visually-hidden class, same idiom. */}
      <div className="erf-band__announce" role="status" aria-live="polite" data-testid="preview-move-announcement">
        {navigation.announcement}
      </div>

      {view === 'limit-reached' && <PreviewBanner {...limitReachedBanner} />}

      {view === 'failed' && <PreviewBanner {...failedBanner} />}

      {view === 'normal' && (
        <div className="html-preview-surface">
          {/* The failure indicator (AC20) lives in the tab, not here: the native
              WebContentsView paints above all sibling DOM in this surface, so a
              badge here would be invisible while the page runs. See
              HtmlPreviewTab + PreviewFailureBadge (design §1.8). */}
          {/* The sized target the native WebContentsView paints over. Its
              background is held equal to the view's own backdrop — brand black
              until the page paints, then the page's resolved paper colour from
              `preview:backdropChanged` — so the seam between DOM and native view
              never flashes. The fallback layer sits behind it for the hidden
              case. */}
          {/* Name the surface for assistive tech: while the native view is hidden
              (inactive tab, overlay, pre-paint) its own a11y tree is gone, so
              without a label a screen reader finds only an unnamed black region. */}
          {/* The preview's toolbar — Back, the link-mode toggle, Find, and the
              permission chip. Always
              rendered, and a flow sibling ABOVE the page area rather than an
              overlay on it, so the untrusted page has nowhere to paint that
              could cover it and the bar may grow to any height.

              That placement is now the WHOLE of what separates Erfana's chrome
              from the page: the "content below is not Erfana" wording and the
              2px accent seam were both removed by owner decision when this
              became a toolbar (docs/security.md, residual risk 8). Do NOT make
              it conditional, do NOT let it scroll, and do NOT position it
              absolutely — there is nothing left underneath it to fall back on. */}
          <PreviewChromeBand
            blockedHosts={blockedHosts}
            allowedHosts={allowedHosts}
            blockedHostsTruncated={blockedHostsTruncated}
            chipRef={bandChipRef}
            controlsAllowed={controlsAllowed}
            paused={gate !== null}
            onFind={openSearch}
            onExportPdf={exportPdf}
            exportingPdf={exportingPdf}
            onOpenInBrowser={openInBrowser}
            openingInBrowser={openingInBrowser}
            onApprove={approveHost}
            onExpandedChange={setBandExpanded}
            collapseRef={bandCollapseRef}
            leadingTools={
              <>
                <PreviewNavControls {...navigation.controls} />
                <PreviewFindTool onFind={openSearch} />
              </>
            }
          />
          {/* Everything below the strip. This wrapper is the find bar's
              positioning context, so the bar's offset measures from BELOW the
              strip — it used to be positioned against the panel root, which put
              it over the strip's right-hand end the moment the strip grew tall
              enough to hold a control. */}
          <div className="html-preview-page-area">
            {/* Find-in-page overlay; only the active tab shows it. Now scoped to
                the normal view: in the failed and limit-reached views it was
                talking to a WebContentsView that does not exist. */}
            {isVisible && <SearchBar provider={searchProvider} />}
            {/* `role="img"` is correct ONLY while the native view is hidden and
                the placeholder really is a picture (a still frame) or a flat
                colour. While the view is live the user is looking at a running,
                scrollable document, and `role="img"` would both mislabel it and
                make its subtree presentational. `aria-busy` carries the "not
                readable yet" state that is otherwise visual-only.

                While the page can be ENTERED (issue #124, QG-8 U1) the element
                is also the keyboard's only way in, activated by Enter or Space,
                so it is a `button` for as long as that is true: the page's own
                accessibility tree lives in the native view and no DOM role here
                reaches it, while "there is something here you can activate" is
                exactly what a reader needs to be told. The name states the way
                back out too, because Escape is the only one. */}
            <div
              ref={placeholderRef}
              className="html-preview-placeholder"
              style={backdrop !== null ? { background: backdrop } : undefined}
              role={isViewHidden ? 'img' : pageEntry.enabled ? 'button' : 'group'}
              // -1, not absent: out of the tab order, yet focusable from code, so
              // a closing dialog's synchronous focus restore still lands here
              // before the page is offered again (QG-11a Q26).
              tabIndex={pageEntry.enabled ? 0 : -1}
              aria-busy={loadState === 'loading' || loadState === 'idle'}
              aria-label={previewPlaceholderLabel(
                getBasename(filePath) || 'page',
                pageEntry.enabled
              )}
              onKeyDown={pageEntry.onKeyDown}
            >
              <PreviewFallback kind={fallbackKind} stillFrame={stillFrame} dragLatched={dragHideLatched} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

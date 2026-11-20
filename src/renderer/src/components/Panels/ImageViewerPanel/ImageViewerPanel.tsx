// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ImageViewerPanel Component
 *
 * Displays an image file with zoom, pan and full-screen capabilities, and keeps
 * it in step with the file on disk.
 *
 * Features:
 * - Loading, error and empty states
 * - Zoom controls: in/out buttons, level indicator (clickable to reset), fit
 * - Full-screen button with portal overlay and focus trap
 * - Metadata display: dimensions, file size, format, last-updated stamp
 * - Mouse wheel zoom centred on the cursor, click-drag panning
 * - Keyboard shortcuts: +/- (zoom), 0 (reset), F (fit), Escape (exit full screen)
 * - Double-click to toggle between fit and 100 %
 * - Live refresh when the file changes on disk, with a permanently mounted
 *   status region and a banner + Reload action for the degraded states
 * - Export controls: PNG, PDF and copy-to-clipboard, driven entirely by the
 *   main process from a fresh read of the file on disk
 *
 * This file is deliberately glue only: state lives in `hooks/`, chrome lives in
 * `components/`, copy and precedence live in `imageViewerStatus.logic.ts`, and
 * the zoom maths lives in `imageViewer.logic.ts`.
 *
 * @module ImageViewerPanel
 * @see Spec #015 - Image preview viewer specification
 * @see Issue #70 - preview tabs show stale content when the file changes
 * @see Issue #73 - PNG / PDF / clipboard export controls
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IDockviewPanelProps } from 'dockview'
import { Loader2, AlertCircle, ImageIcon } from 'lucide-react'

import { getImageFormat } from '../../../utils/imageUtils'
import { getBasename, sanitizeFileName } from '../../../utils/fileUtils'
import { formatTabTitle } from '../../../utils/tabTitle'
import { TEST_IDS } from '../../../constants/testids'
import { useFileChangeSubscription } from '../../../hooks/useFileChangeSubscription'
import { DOCKVIEW_PANEL_ACTIVE, DOCKVIEW_PANEL_VISIBLE, useDockviewValue } from '../../../hooks/useDockviewValue'
import { selectNotice } from '../../FileConflictNotification/freshnessNoticeCopy'
import { FreshnessStatusRegion } from '../../FileConflictNotification/FreshnessStatusRegion'
import { ImageViewerBanner, ImageViewerToolbar } from './components'
import {
  useFullScreenOverlay,
  useImageExportHandlers,
  useImageSource,
  useImageViewerTransform,
  useReloadAction
} from './hooks'
import type { ImageDimensions, UseImageViewerTransformResult } from './hooks'
import {
  getBannerVariant,
  getStatusText,
  getViewerStatus,
  VIEWER_RELOAD_BUTTON_COPY,
  type ReloadFailure
} from './imageViewerStatus.logic'
import styles from './ImageViewerPanel.module.css'

// ============================================================================
// Types
// ============================================================================

/** Parameters passed to {@link ImageViewerPanel} via dockview. */
export interface ImageViewerPanelParams {
  /** Absolute path to the image file */
  filePath: string
  /** Unique panel identifier */
  panelId?: string
}

// ============================================================================
// Component
// ============================================================================

/**
 * Image viewer panel with zoom/pan/full-screen support and live refresh.
 *
 * Loads the image as a data URL via IPC (the renderer is sandboxed and cannot
 * read the filesystem), then subscribes to the main-process file watcher so an
 * external rewrite – an agent, a design tool, a build step – lands in the open
 * tab without a close/reopen.
 *
 * @param props - Dockview panel props with `filePath` in `params`
 * @returns Rendered image viewer panel
 *
 * @example
 * ```tsx
 * dockviewApi.addPanel({
 *   id: 'image-panel-1',
 *   component: 'imageViewer',
 *   params: { filePath: '/path/to/image.png' }
 * })
 * ```
 */
export function ImageViewerPanel(props: IDockviewPanelProps<ImageViewerPanelParams>) {
  const { params, api } = props
  const filePath = params?.filePath || ''

  const panelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fullScreenContainerRef = useRef<HTMLDivElement>(null)

  const fileName = useMemo(() => sanitizeFileName(filePath), [filePath])
  const format = useMemo(() => getImageFormat(filePath), [filePath])

  // The watch is always live; only the multi-MB base64 re-read waits for the
  // tab to be looked at; only the tab in front speaks its notice (#478 F13)
  const isVisible = useDockviewValue(api, DOCKVIEW_PANEL_VISIBLE)
  const isActive = useDockviewValue(api, DOCKVIEW_PANEL_ACTIVE)

  // ========================================
  // Source + watch
  // ========================================

  const fullScreen = useFullScreenOverlay()
  const { isFullScreen, overlayRef, portalRoot } = fullScreen

  // Forward declarations: the source hook reports a landed refresh to the watch
  // (built after it), and reconciles the transform in the batch that swaps
  // `src` while the transform needs the dimensions it produces. Refs break both cycles.
  const markReloadedRef = useRef<() => void>(() => {})
  const applySourceChangeRef = useRef<UseImageViewerTransformResult['applySourceChange']>(() => {})

  // Stable identity, so `useImageSource` never re-reads a moving callback.
  const handleSourceCommit = useCallback(
    (previous: ImageDimensions | null, next: ImageDimensions) => {
      applySourceChangeRef.current(previous, next)
    },
    []
  )

  const { source, isLoading, error, isStale, refresh, pushSource, handleImageError } = useImageSource({
    filePath,
    isVisible,
    onRefreshed: () => markReloadedRef.current(),
    onSourceCommit: handleSourceCommit
  })

  // The freshness tracker starts once the first image is on screen, from its
  // stamp (#478 G3), and hands every new version it reads straight to the
  // source hook – no second read (F30)
  // Follow once the first load settled: a failed first load is retried by the tracker's catch-up read
  const watch = useFileChangeSubscription(filePath, {
    ready: source !== null || error !== null,
    baseline: source?.stamp,
    visible: isVisible,
    currentVersion: source?.version,
    onBytes: pushSource
  })

  // In an effect, never in render: a render React throws away must not write it
  useEffect(() => {
    markReloadedRef.current = watch.markReloaded
  }, [watch.markReloaded])

  const imageSize = useMemo(
    () => (source ? { width: source.naturalWidth, height: source.naturalHeight } : null),
    [source]
  )

  // ========================================
  // Transform
  // ========================================

  const getActiveContainer = useCallback(
    () => (isFullScreen ? fullScreenContainerRef.current : containerRef.current),
    [isFullScreen]
  )

  const isKeyboardScoped = useCallback(() => {
    const active = document.activeElement
    return Boolean(panelRef.current?.contains(active) || overlayRef.current?.contains(active))
  }, [overlayRef])

  const isDragBlocked = useCallback(
    (target: HTMLElement) =>
      Boolean(target.closest('button')) || Boolean(target.closest(`.${styles.toolbar}`)),
    []
  )

  const transform = useImageViewerTransform({
    getActiveContainer,
    imageSize,
    isKeyboardScoped,
    onEscape: fullScreen.close,
    isDragBlocked
  })

  // Publish the reconciler for the source hook to call at commit time. Written
  // in an effect rather than in the render body for the same
  // concurrent-rendering reason as `refreshRef`; it lands long before the first
  // decode resolves, because `load('initial')` suspends on IPC immediately.
  //
  // Nothing here keys off `source` or `onLoad`: an effect that watched `source`
  // would run after the browser had already painted the new bytes at the old
  // zoom, and `onLoad` re-fires on entering full screen without the file having
  // changed.
  useEffect(() => {
    applySourceChangeRef.current = transform.applySourceChange
  }, [transform.applySourceChange])

  // ========================================
  // Tab title
  // ========================================

  // Mirrors the editor: one event, one affordance, one source of copy.
  useEffect(() => {
    if (!api?.setTitle || !filePath) return
    api.setTitle(formatTabTitle(getBasename(filePath) || 'Image', false, watch.isFileDeleted))
  }, [api, filePath, watch.isFileDeleted])

  // ========================================
  // Degraded states
  // ========================================

  // With an image on screen, Reload is the tracker's (a new watch and a forced
  // read); on the error screen there is no tracker yet: if the file is there, read it afresh
  const hasSource = source !== null
  const recover = useCallback(async (): Promise<boolean> => {
    const followed = await watch.reload()
    if (followed && !hasSource) refresh()
    return followed
  }, [hasSource, watch, refresh])
  const { isReloadPending, hasReloadFailed, reload } = useReloadAction({ recover, refresh: () => {} })
  const [limitedDismissed, setLimitedDismissed] = useState(false)
  const notice = selectNotice({
    state: watch.state,
    fileName: getBasename(filePath) || 'Image',
    tab: 'image',
    tooLargeSize: watch.tooLargeSize,
    limitedDismissed
  })

  // Read at render time, never captured when the click was made: `recover`
  // updates `isFileDeleted` as part of failing, so the current value is what
  // says whether the file is still missing or the watch would not restart.
  const reloadFailure: ReloadFailure | null = hasReloadFailed
    ? watch.isFileDeleted || watch.reloadFoundMissing
      ? 'missing'
      : 'watch'
    : null

  const bannerVariant = getBannerVariant({ hasNotice: notice !== null, isStale })

  const status = getViewerStatus({
    isWatchUnavailable: watch.isWatchUnavailable,
    isStale,
    isReloading: watch.isReloading,
    reloadFailure,
    // The banner is the fuller statement of the same fact; passing it in stops
    // two live regions announcing one sentence twice.
    bannerVariant
  })

  // ========================================
  // Export
  // ========================================

  // Called ONCE, and its output handed to BOTH toolbar instances: one busy
  // state, one in-flight request, so the overlay's PNG button is literally the
  // panel's PNG button (requirement 14). A hook per instance would let the two
  // disagree, and a second click could then reach the main-side lock.
  const imageExport = useImageExportHandlers({ filePath, isFullScreen })

  // ========================================
  // Render helpers
  // ========================================

  const renderToolbar = (inFullScreen: boolean) => (
    <ImageViewerToolbar
      imageSize={imageSize}
      fileSize={source?.fileSize ?? 0}
      format={format}
      updatedAt={source?.updatedAt ?? 0}
      status={status}
      scale={transform.transform.scale}
      canZoomIn={transform.canZoomIn}
      canZoomOut={transform.canZoomOut}
      isFullScreen={inFullScreen}
      // The panel instance owns the live region. The overlay's copy would be a
      // second element with the same `role="status"` and the same testid, so a
      // screen reader would announce every refresh twice.
      showStatus={!inFullScreen}
      isExportingPng={imageExport.isExportingPng}
      isExportingPdf={imageExport.isExportingPdf}
      isCopying={imageExport.isCopying}
      onExportPng={imageExport.onExportPng}
      onExportPdf={imageExport.onExportPdf}
      onCopyImage={imageExport.onCopyImage}
      onBusyClick={imageExport.onBusyClick}
      onZoomIn={transform.zoomIn}
      onZoomOut={transform.zoomOut}
      onReset={transform.reset}
      onFit={transform.fitToView}
      onEnterFullScreen={fullScreen.open}
      onExitFullScreen={fullScreen.close}
    />
  )

  // The banner renders into whichever surface is on top, and only there: the
  // overlay covers the panel, so a panel-only banner left a full-screen user
  // with no notice that the file was deleted and no Reload button, while
  // rendering it in both would duplicate a `role="alert"` region.
  const renderBanner = () =>
    bannerVariant && (
      <ImageViewerBanner
        variant={bannerVariant}
        notice={notice}
        onReload={reload}
        onClose={() => api.close()}
        onDismissLimited={() => setLimitedDismissed(true)}
        isReloadPending={isReloadPending}
      />
    )

  // Panel-owned export live regions, rendered into whichever surface is on top -
  // the toolbar must not own them, for the same reason it does not own the
  // refresh status: two elements with one `role="status"` announce twice and
  // break every `getByTestId`.
  //
  // TWO regions, split exactly the way `ToastNotification` splits its own: the
  // full-screen overlay is `aria-modal="true"`, so the toast's assertive region
  // is outside the accessibility tree while it is open. A failure written into
  // a polite region can be queued behind whatever the reader is saying or
  // dropped, and the user is then left believing the file was written. Errors
  // therefore go to `role="alert"`, everything else stays polite.
  //
  // Both are permanently mounted with empty text when idle: a live region added
  // to the DOM at the same moment its text appears is not announced at all.
  // `aria-atomic` without an `aria-label`, matching the constraint recorded on
  // the toolbar's status slot - an author-supplied name on an atomic region can
  // replace the text the reader would otherwise speak.
  const announcement = imageExport.exportAnnouncement
  const renderExportStatus = () => (
    <>
      <span
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid={TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS}
      >
        {announcement.region === 'polite' ? announcement.text : ''}
      </span>
      {/* No `aria-live` here: `role="alert"` already implies assertive, and
          pairing the two is the redundancy ToastNotification calls out. */}
      <span
        className={styles.srOnly}
        role="alert"
        aria-atomic="true"
        data-testid={TEST_IDS.IMAGE_VIEWER_EXPORT_ALERT}
      >
        {announcement.region === 'alert' ? announcement.text : ''}
      </span>
    </>
  )

  const renderImageContent = (
    ref: React.RefObject<HTMLDivElement>,
    inFullScreen: boolean = false
  ) => (
    <div
      ref={ref}
      className={styles.content}
      onMouseDown={transform.handleMouseDown}
      onDoubleClick={transform.handleDoubleClick}
      role="img"
      aria-label={`Image preview: ${fileName}`}
      data-testid={
        inFullScreen ? TEST_IDS.IMAGE_VIEWER_FULLSCREEN_CONTENT : TEST_IDS.IMAGE_VIEWER_CONTENT
      }
    >
      {source && (
        <img
          src={source.url}
          alt={`Preview of ${fileName}`}
          // The version on screen: the e2e freshness recorder times it (#478 P1)
          data-version={source.version}
          className={styles.image}
          style={{
            transform: `translate(${transform.transform.translateX}px, ${transform.transform.translateY}px) scale(${transform.transform.scale})`,
            transformOrigin: 'center center'
          }}
          onError={handleImageError}
          draggable={false}
          data-testid={TEST_IDS.IMAGE_VIEWER_IMAGE}
        />
      )}
    </div>
  )

  // ========================================
  // Render: loading / error / empty
  // ========================================

  if (isLoading) {
    return (
      <div className={styles.container} data-testid={TEST_IDS.IMAGE_VIEWER_PANEL}>
        <div className={styles.loadingState} role="status" aria-live="polite">
          <Loader2 className={styles.spinner} size={32} aria-hidden="true" />
          <span>Loading image...</span>
        </div>
      </div>
    )
  }

  // H1: the error screen is a dead end without this button. `error` is cleared
  // by any accepted commit, so a watcher event recovers the tab by itself - but
  // a first load that failed while an agent was mid-write may never receive
  // one, and closing and reopening the tab is the workaround issue #70 exists
  // to delete. The banner is deliberately NOT reused here: its copy promises
  // "showing the version that was loaded", and in this state there is none.
  if (error) {
    return (
      <div className={styles.container} data-testid={TEST_IDS.IMAGE_VIEWER_PANEL}>
        <div className={styles.errorState} role="alert">
          <AlertCircle size={32} aria-hidden="true" />
          <span className={styles.errorMessage}>{error}</span>
          {/* The toolbar's status slot is not rendered in this state, so the
              verdict on a failed Reload goes here instead - otherwise the
              button is silent exactly where it is the only affordance (H4).
              The alert is a live region, so the change is announced. */}
          {getStatusText(status) && (
            <span className={styles.errorMessage}>{getStatusText(status)}</span>
          )}
          <button
            type="button"
            className={styles.bannerButton}
            onClick={reload}
            disabled={isReloadPending}
            aria-label={VIEWER_RELOAD_BUTTON_COPY.ariaLabel}
            data-testid={TEST_IDS.IMAGE_VIEWER_BTN_RELOAD}
          >
            {VIEWER_RELOAD_BUTTON_COPY.label}
          </button>
        </div>
      </div>
    )
  }

  if (!source) {
    return (
      <div className={styles.container} data-testid={TEST_IDS.IMAGE_VIEWER_PANEL}>
        <div className={styles.emptyState}>
          <ImageIcon size={32} />
          <span>No image to display</span>
        </div>
      </div>
    )
  }

  // ========================================
  // Render: main panel
  // ========================================

  return (
    <div
      ref={panelRef}
      className={styles.container}
      data-testid={TEST_IDS.IMAGE_VIEWER_PANEL}
      tabIndex={0}
    >
      {renderToolbar(false)}

      {!isFullScreen && renderBanner()}

      {!isFullScreen && renderExportStatus()}

      <FreshnessStatusRegion text={isActive && bannerVariant === 'notice' ? (notice?.message ?? '') : ''} />

      {renderImageContent(containerRef)}

      {isFullScreen &&
        portalRoot &&
        createPortal(
          <div
            ref={overlayRef}
            className={styles.fullScreenOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Full screen image viewer"
            data-testid={TEST_IDS.IMAGE_VIEWER_FULLSCREEN}
          >
            {renderToolbar(true)}
            {renderBanner()}
            {renderExportStatus()}
            {renderImageContent(fullScreenContainerRef, true)}
          </div>,
          portalRoot
        )}
    </div>
  )
}

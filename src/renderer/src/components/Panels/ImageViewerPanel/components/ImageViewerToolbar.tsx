// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Image viewer toolbar: metadata, refresh status, zoom controls, export, full
 * screen.
 *
 * Rendered twice – once in the panel and once inside the full-screen portal –
 * so it holds no state of its own, and only ONE of the two instances may carry
 * the status live region (see `showStatus`).
 *
 * @module ImageViewerToolbar
 */

import { ZoomIn, ZoomOut, Maximize2, Minimize2, X } from 'lucide-react'

import { TEST_IDS } from '../../../../constants/testids'
import { ImageViewerExportControls } from './ImageViewerExportControls'
import { formatDimensions, formatFileSize, formatZoomLevel } from '../imageViewer.logic'
import {
  formatUpdatedAccessibleName,
  formatUpdatedStamp,
  getStatusText,
  getStatusTone,
  type ViewerStatus
} from '../imageViewerStatus.logic'
import styles from '../ImageViewerPanel.module.css'

/** Props for {@link ImageViewerToolbar}. */
export interface ImageViewerToolbarProps {
  /** Intrinsic image size, or `null` before the first decode. */
  imageSize: { width: number; height: number } | null
  /** File size in bytes; hidden when 0. */
  fileSize: number
  /** Human-readable format label, e.g. `PNG`. */
  format: string
  /** When the current bytes were read from disk, in ms since the epoch; 0 hides the stamp. */
  updatedAt: number
  /** Refresh status driving the permanently mounted live region. */
  status: ViewerStatus
  /** Current zoom scale (1 = 100 %). */
  scale: number
  /** Whether the zoom-in control is enabled. */
  canZoomIn: boolean
  /** Whether the zoom-out control is enabled. */
  canZoomOut: boolean
  /** Whether this instance is the one inside the full-screen overlay. */
  isFullScreen: boolean
  /**
   * Whether this instance renders the status live region.
   *
   * Exactly one instance may: two elements with `role="status"` and the same
   * text make a screen reader announce "Reloaded from disk" twice, and two
   * elements with the same testid break every `getByTestId` while full screen
   * is open. The panel instance owns it, because the panel stays mounted for
   * the whole life of the tab and a live region only announces if it was
   * already in the DOM when its text changed.
   *
   * @default true
   */
  showStatus?: boolean
  /** Whether a PNG export is in flight (issue #73). */
  isExportingPng: boolean
  /** Whether a PDF export is in flight (issue #73). */
  isExportingPdf: boolean
  /** Whether a clipboard copy is in flight (issue #73). */
  isCopying: boolean
  /** Start a PNG export of the file on disk. */
  onExportPng: () => void
  /** Start a PDF export of the file on disk. */
  onExportPdf: () => void
  /** Copy the file on disk to the clipboard as PNG bytes. */
  onCopyImage: () => void
  /**
   * Called instead of an action when a click lands while an export is running.
   *
   * The export controls stay live while busy, so the click is legal and does
   * nothing; this is what stops it being completely silent.
   */
  onBusyClick: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onFit: () => void
  onEnterFullScreen: () => void
  onExitFullScreen: () => void
}

/**
 * Renders the viewer's toolbar.
 *
 * The status slot is **permanently mounted**. A live region that is added to
 * the DOM at the same moment its text appears is not announced, and for an
 * image the status text is the only channel a screen-reader user has that the
 * content changed – the pixels are opaque.
 *
 * The slot carries no `aria-label`: an author-supplied name on an `aria-atomic`
 * live region can replace or suppress the text a screen reader announces, and
 * it hid the cause of a degradation from everyone who can see the screen
 * (QG-11a H3). Cause and remedy are visible text in the banner instead.
 *
 * @param props - Metadata, status and control wiring
 * @returns The toolbar element
 *
 * @example
 * ```tsx
 * <ImageViewerToolbar
 *   imageSize={{ width: 800, height: 600 }}
 *   fileSize={2048}
 *   format="PNG"
 *   updatedAt={Date.now()}
 *   status="reloading"
 *   scale={1}
 *   canZoomIn
 *   canZoomOut
 *   isFullScreen={false}
 *   isExportingPng={false}
 *   isExportingPdf={false}
 *   isCopying={false}
 *   onExportPng={onExportPng}
 *   onExportPdf={onExportPdf}
 *   onCopyImage={onCopyImage}
 *   onBusyClick={onBusyClick}
 *   onZoomIn={zoomIn}
 *   onZoomOut={zoomOut}
 *   onReset={reset}
 *   onFit={fitToView}
 *   onEnterFullScreen={open}
 *   onExitFullScreen={close}
 * />
 * ```
 */
export function ImageViewerToolbar({
  imageSize,
  fileSize,
  format,
  updatedAt,
  status,
  scale,
  canZoomIn,
  canZoomOut,
  isFullScreen,
  showStatus = true,
  isExportingPng,
  isExportingPdf,
  isCopying,
  onExportPng,
  onExportPdf,
  onCopyImage,
  onBusyClick,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  onEnterFullScreen,
  onExitFullScreen
}: ImageViewerToolbarProps): JSX.Element {
  const statusText = getStatusText(status)
  const updatedStamp = formatUpdatedStamp(updatedAt)

  // Tone, not state: every degradation shares one warning colour, so a new
  // status cannot accidentally be painted in the positive one.
  const toneClass =
    {
      positive: styles['statusSlot--positive'],
      warning: styles['statusSlot--warning'],
      neutral: ''
    }[getStatusTone(status)] ?? ''
  const statusClassName = `${styles.statusSlot} ${toneClass}`.trim()

  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label="Image viewer controls"
      data-testid={TEST_IDS.IMAGE_VIEWER_TOOLBAR}
    >
      {/* Left: metadata. Truncates first so the status slot never shifts the
          zoom controls in a narrow split layout. */}
      <div className={styles.toolbarMetadata}>
        {imageSize && (
          <span
            className={styles.metadataItem}
            title="Dimensions"
            aria-label={`Dimensions: ${formatDimensions(imageSize.width, imageSize.height)}`}
          >
            {formatDimensions(imageSize.width, imageSize.height)}
          </span>
        )}
        {fileSize > 0 && (
          <span
            className={styles.metadataItem}
            title="File size"
            aria-label={`File size: ${formatFileSize(fileSize)}`}
          >
            {formatFileSize(fileSize)}
          </span>
        )}
        <span className={styles.metadataItem} title="Format" aria-label={`Format: ${format}`}>
          {format}
        </span>
        {updatedStamp && (
          <span
            className={styles.metadataItem}
            title="Last updated from disk"
            aria-label={formatUpdatedAccessibleName(updatedAt)}
          >
            {updatedStamp}
          </span>
        )}
      </div>

      {/* Spacer pushes the controls right. */}
      <div className={styles.toolbarSpacer} />

      {/* Permanently mounted live region – but only on the instance that owns
          it. `data-state` is the E2E hook; the text is what a screen reader
          announces. The overlay instance renders the same text WITHOUT the live
          region: one announcement, but a full-screen user still sees the news
          (QG-11a). */}
      {showStatus ? (
        <span
          className={statusClassName}
          role="status"
          aria-live="polite"
          data-state={status}
          data-testid={TEST_IDS.IMAGE_VIEWER_STATUS}
        >
          {statusText}
        </span>
      ) : (
        <span className={statusClassName} aria-hidden="true" data-state={status}>
          {statusText}
        </span>
      )}

      {/* Zoom controls */}
      <div className={styles.toolbarControls}>
        <button
          className={styles.controlButton}
          onClick={onZoomOut}
          disabled={!canZoomOut}
          title="Zoom out (-)"
          aria-label="Zoom out"
          data-testid={TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_OUT}
        >
          <ZoomOut size={16} strokeWidth={2} />
        </button>

        <button
          className={styles.zoomLevel}
          onClick={onReset}
          title="Reset zoom (0)"
          aria-label={`Zoom level ${formatZoomLevel(scale)}, click to reset`}
          aria-live="polite"
          data-testid={TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL}
        >
          {formatZoomLevel(scale)}
        </button>

        <button
          className={styles.controlButton}
          onClick={onZoomIn}
          disabled={!canZoomIn}
          title="Zoom in (+)"
          aria-label="Zoom in"
          data-testid={TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN}
        >
          <ZoomIn size={16} strokeWidth={2} />
        </button>

        <button
          className={styles.controlButton}
          onClick={onFit}
          title="Fit to view (F)"
          aria-label="Fit image to view"
          data-testid={TEST_IDS.IMAGE_VIEWER_BTN_FIT}
        >
          <Minimize2 size={16} strokeWidth={2} />
        </button>
      </div>

      {/* Export group. Between the zoom cluster and the actions group, so the
          toolbar reads as three regions - how I look at it, what I take away,
          where I look at it - and the far-right corner stays the full-screen
          affordance it already was. Both instances render it; ONE hook in the
          panel owns the busy state, so the two cannot disagree. */}
      <div className={styles.toolbarSeparator} />

      <ImageViewerExportControls
        isExportingPng={isExportingPng}
        isExportingPdf={isExportingPdf}
        isCopying={isCopying}
        onExportPng={onExportPng}
        onExportPdf={onExportPdf}
        onCopyImage={onCopyImage}
        onBusyClick={onBusyClick}
      />

      <div className={styles.toolbarSeparator} />

      <div className={styles.toolbarActions}>
        {isFullScreen ? (
          <button
            className={styles.controlButton}
            onClick={onExitFullScreen}
            title="Exit full screen (Escape)"
            aria-label="Exit full screen"
            data-testid={TEST_IDS.IMAGE_VIEWER_BTN_CLOSE}
          >
            <X size={16} strokeWidth={2} />
          </button>
        ) : (
          <button
            className={styles.controlButton}
            onClick={onEnterFullScreen}
            title="Full screen"
            aria-label="Enter full screen"
            data-testid={TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN}
          >
            <Maximize2 size={16} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The image viewer's three export controls: PNG, PDF, copy to clipboard.
 *
 * Stateless, like the toolbar that renders it: the busy flags and the handlers
 * are owned by `useImageExportHandlers` in the panel, so the panel's toolbar
 * and the full-screen overlay's toolbar are two views of ONE export.
 *
 * Two decisions worth not re-litigating:
 *
 * 1. **Busy is `aria-disabled`, never the `disabled` attribute.** Chromium
 *    blurs a disabled control the instant it is disabled, and the native save
 *    dialog then returns focus to a control that no longer accepts it - which
 *    drops the keyboard user on `<body>` after every export.
 * 2. **All three read busy, only the invoked one spins.** Within ONE panel that
 *    is what keeps a click the UI allowed from coming back as an "another
 *    export is already running" error. It is not a promise across panels: the
 *    main-side lock is process-wide while this busy state is per-panel, so a
 *    second image tab that takes the lock while this one sits in its save
 *    dialog (deliberately outside the lock) can still make the next request
 *    here fail as busy.
 *
 * @module ImageViewerExportControls
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import { Copy, FileDown, ImageDown, Loader2 } from 'lucide-react'

import { TEST_IDS } from '../../../../constants/testids'
import { IMAGE_EXPORT_COPY, type ImageExportAction } from '../imageViewerStatus.logic'
import styles from '../ImageViewerPanel.module.css'

/** Props for {@link ImageViewerExportControls}. */
export interface ImageViewerExportControlsProps {
  /** Whether a PNG export is in flight. */
  isExportingPng: boolean
  /** Whether a PDF export is in flight. */
  isExportingPdf: boolean
  /** Whether a clipboard copy is in flight. */
  isCopying: boolean
  /** Start a PNG export (opens a native save dialog). */
  onExportPng: () => void
  /** Start a PDF export (opens a native save dialog). */
  onExportPdf: () => void
  /** Copy the image to the clipboard (no dialog). */
  onCopyImage: () => void
  /**
   * Called instead of an action when a click is swallowed because an export is
   * already running.
   *
   * It re-states the running export's busy sentence in the panel's polite live
   * region. It must never raise a toast - a click the UI itself swallowed is
   * not an error.
   */
  onBusyClick: () => void
}

/** Props for the single-button building block below. */
interface ExportButtonProps {
  /** Which action this button performs; selects its copy and its glyph. */
  action: ImageExportAction
  /** Whether THIS action is the one currently running. */
  isRunning: boolean
  /** Whether ANY export is running, including another button's. */
  isBusy: boolean
  /** Test id, duplicated across both toolbar instances by design. */
  testId: string
  /** Click handler; not invoked while busy. */
  onActivate: () => void
  /** Called in place of `onActivate` when the click is swallowed as busy. */
  onBusyClick: () => void
}

/** Glyph per action. `FileDown` is the same icon the markdown toolbar's Export-to-PDF uses. */
const ACTION_ICONS = {
  png: ImageDown,
  pdf: FileDown,
  clipboard: Copy
} as const

/**
 * One export control.
 *
 * @param props - Action, busy state and wiring
 * @returns The button element
 */
function ExportButton({
  action,
  isRunning,
  isBusy,
  testId,
  onActivate,
  onBusyClick
}: ExportButtonProps): JSX.Element {
  const copy = IMAGE_EXPORT_COPY[action]
  const Icon = ACTION_ICONS[action]

  // `aria-disabled` does not stop a click the way `disabled` does, so the guard
  // has to be here as well - otherwise the attribute would be a lie for anyone
  // reading it. The hook holds a second, ref-based guard against two clicks
  // landing in the same tick, before React has re-rendered these flags.
  //
  // A swallowed click is not silently dropped: nothing about these buttons
  // changes while another export runs (no dimming, by design), so the only
  // other feedback is `cursor: progress` on hover. `onBusyClick` re-states the
  // RUNNING export's busy sentence in the panel's polite live region. It is
  // never a toast - the UI allowed this click, so refusing it is not an error.
  const handleClick = (): void => {
    if (isBusy) {
      onBusyClick()
      return
    }
    onActivate()
  }

  return (
    <button
      type="button"
      className={styles.controlButton}
      onClick={handleClick}
      aria-disabled={isBusy}
      aria-busy={isRunning}
      // The tooltip follows the accessible name into the busy wording. Left on
      // the idle copy it promises a hovering mouse user an action that will not
      // fire, because the click guard above rejects it while busy.
      title={isRunning ? copy.ariaLabelBusy : copy.tooltip}
      aria-label={isRunning ? copy.ariaLabelBusy : copy.ariaLabel}
      data-testid={testId}
    >
      {isRunning ? (
        <Loader2 className={styles.spinner} size={16} strokeWidth={2} />
      ) : (
        <Icon size={16} strokeWidth={2} />
      )}
    </button>
  )
}

/**
 * Renders the export group between the zoom cluster and the actions group.
 *
 * Reading left to right the toolbar is then three semantic regions: how I look
 * at it, what I take away, where I look at it - with the far-right corner left
 * as the full-screen / close affordance it already was.
 *
 * @param props - Busy flags and the three handlers from `useImageExportHandlers`
 * @returns The grouped export controls
 *
 * @example
 * ```tsx
 * <ImageViewerExportControls
 *   isExportingPng={exports.isExportingPng}
 *   isExportingPdf={exports.isExportingPdf}
 *   isCopying={exports.isCopying}
 *   onExportPng={exports.onExportPng}
 *   onExportPdf={exports.onExportPdf}
 *   onCopyImage={exports.onCopyImage}
 *   onBusyClick={exports.onBusyClick}
 * />
 * ```
 */
export function ImageViewerExportControls({
  isExportingPng,
  isExportingPdf,
  isCopying,
  onExportPng,
  onExportPdf,
  onCopyImage,
  onBusyClick
}: ImageViewerExportControlsProps): JSX.Element {
  // Derived, never a prop of its own: the three flags ARE the busy state, and a
  // separate one could disagree with them.
  const isBusy = isExportingPng || isExportingPdf || isCopying

  // A plain div, like `.toolbarControls` and `.toolbarActions` next to it: a
  // `role="group"` with no accessible name adds a boundary a screen reader
  // announces as nothing, and it would make this one cluster of the three
  // structurally different from its siblings for no stated reason.
  return (
    <div className={styles.toolbarExport}>
      <ExportButton
        action="png"
        isRunning={isExportingPng}
        isBusy={isBusy}
        testId={TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG}
        onActivate={onExportPng}
        onBusyClick={onBusyClick}
      />
      <ExportButton
        action="pdf"
        isRunning={isExportingPdf}
        isBusy={isBusy}
        testId={TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF}
        onActivate={onExportPdf}
        onBusyClick={onBusyClick}
      />
      <ExportButton
        action="clipboard"
        isRunning={isCopying}
        isBusy={isBusy}
        testId={TEST_IDS.IMAGE_VIEWER_BTN_COPY}
        onActivate={onCopyImage}
        onBusyClick={onBusyClick}
      />
    </div>
  )
}

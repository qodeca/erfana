// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Degraded-state banner for the image viewer.
 *
 * Three ways the viewer can stop tracking the file – the file was deleted, the
 * watch died, or the last re-read failed – get one banner and one action,
 * because the user's next move is the same in all three.
 *
 * The banner is the only surface that states the CAUSE and the REMEDY in
 * visible text. The toolbar slot is a headline; a user who reads only
 * "Auto-refresh unavailable" cannot discover that closing tabs is what fixes
 * the watched-files cap (QG-11a H3).
 *
 * @module ImageViewerBanner
 */

import { AlertTriangle } from 'lucide-react'

import { TEST_IDS } from '../../../../constants/testids'
import {
  getBannerMessage,
  VIEWER_RELOAD_BUTTON_COPY,
  type ViewerBannerVariant,
  type WatchUnavailableReason
} from '../imageViewerStatus.logic'
import styles from '../ImageViewerPanel.module.css'

/** Props for {@link ImageViewerBanner}. */
export interface ImageViewerBannerProps {
  /** Which degradation to describe. */
  variant: ViewerBannerVariant
  /**
   * Why the watch is unavailable, when it is.
   *
   * Selects between the cap wording ("close some tabs") and the watcher-fault
   * wording, so the remedy the user reads is the one that can actually work.
   */
  unavailableReason?: WatchUnavailableReason | null
  /** Re-read the file and restart the watch. */
  onReload: () => void
  /** Disables the button while a reload attempt is in flight. */
  isReloadPending?: boolean
}

/**
 * Renders the degraded-state banner.
 *
 * Notes on the interaction design:
 * - `role="alert"` so the state is announced when it appears.
 * - The button is **not** autofocused. The user is looking at an image; moving
 *   focus for a passive notification would interrupt keyboard panning.
 * - The banner mounts above the content, so it pushes the image down and the
 *   `ResizeObserver` refires in fit mode. That second small jump is accepted.
 *
 * @param props - Variant, cause and reload handler
 * @returns The banner element
 *
 * @example
 * ```tsx
 * <ImageViewerBanner
 *   variant="unavailable"
 *   unavailableReason="limit"
 *   onReload={() => reload()}
 * />
 * ```
 */
export function ImageViewerBanner({
  variant,
  unavailableReason = null,
  onReload,
  isReloadPending = false
}: ImageViewerBannerProps): JSX.Element {
  return (
    <div
      className={styles.deletedBanner}
      role="alert"
      // Drives the variant's colour treatment: `deleted` uses the same error
      // tokens as the Markdown editor's deleted warning, the other two the
      // warning tokens. Without it all three looked identical.
      data-variant={variant}
      data-testid={TEST_IDS.IMAGE_VIEWER_DELETED_BANNER}
    >
      <AlertTriangle size={16} aria-hidden="true" />
      <span className={styles.bannerMessage}>{getBannerMessage(variant, unavailableReason)}</span>
      <button
        type="button"
        className={styles.bannerButton}
        onClick={onReload}
        disabled={isReloadPending}
        aria-label={VIEWER_RELOAD_BUTTON_COPY.ariaLabel}
        data-testid={TEST_IDS.IMAGE_VIEWER_BTN_RELOAD}
      >
        {VIEWER_RELOAD_BUTTON_COPY.label}
      </button>
    </div>
  )
}

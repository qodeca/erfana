// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The image viewer's banner: the tab's freshness notice in the viewer's own
 * slot (#478, plan § 3.6), or the viewer's one state of its own – bytes that
 * would not paint.
 *
 * The words are the shared notice's (`freshnessNoticeCopy`), so the editor and
 * the viewer say a file was deleted, cannot be shown, or is no longer followed
 * the same way. The banner states the cause and the remedy in visible text;
 * the toolbar slot is only a headline (QG-11a H3).
 *
 * @module ImageViewerBanner
 */

import { AlertTriangle, Info } from 'lucide-react'

import { TEST_IDS } from '../../../../constants/testids'
import {
  FRESHNESS_NOTICE_TEST_IDS,
  NOTICE_BUTTON_COPY,
  type NoticeModel
} from '../../../FileConflictNotification/freshnessNoticeCopy'
import {
  VIEWER_BANNER_COPY,
  VIEWER_RELOAD_BUTTON_COPY,
  type ViewerBannerVariant
} from '../imageViewerStatus.logic'
import styles from '../ImageViewerPanel.module.css'

/** Props for {@link ImageViewerBanner}. */
export interface ImageViewerBannerProps {
  /** What to show: the notice, or the stale-bytes state. */
  variant: ViewerBannerVariant
  /** The freshness notice, for `variant === 'notice'`. */
  notice?: NoticeModel | null
  /** Reload: a new watch and a forced read (or a fresh read on the stale state). */
  onReload: () => void
  /** Close the tab (deleted notice). */
  onClose?: () => void
  /** Hide the "limited live refresh" notice for this tab. */
  onDismissLimited?: () => void
  /** Disables Reload while a reload attempt is in flight. */
  isReloadPending?: boolean
}

/** The colour treatment: the editor's error tokens for deleted, warning for the rest, neutral for info. */
function treatment(variant: ViewerBannerVariant, notice: NoticeModel | null | undefined): string {
  if (variant === 'stale') return 'stale'
  if (notice?.kind === 'deleted') return 'deleted'
  return notice?.severity === 'info' ? 'info' : 'unavailable'
}

/**
 * Renders the banner. It carries no live-region role: the panel's status
 * region announces the notice while the tab is active (F13). The button is
 * never autofocused – the user is looking at an image.
 *
 * @example
 * ```tsx
 * <ImageViewerBanner variant="notice" notice={notice} onReload={reload} onClose={() => api.close()} />
 * ```
 */
export function ImageViewerBanner({
  variant,
  notice = null,
  onReload,
  onClose,
  onDismissLimited,
  isReloadPending = false
}: ImageViewerBannerProps): JSX.Element {
  const actions: readonly string[] = variant === 'stale' ? ['reload'] : (notice?.actions ?? [])
  const Icon = notice?.severity === 'info' ? Info : AlertTriangle
  return (
    <div
      className={styles.deletedBanner}
      data-variant={treatment(variant, notice)}
      data-notice={notice?.kind ?? variant}
      data-testid={TEST_IDS.IMAGE_VIEWER_DELETED_BANNER}
    >
      <Icon size={16} aria-hidden="true" />
      <span className={styles.bannerMessage}>
        {variant === 'stale' ? VIEWER_BANNER_COPY.stale : (notice?.message ?? '')}
      </span>
      {actions.includes('reload') && (
        <button
          type="button"
          className={styles.bannerButton}
          onClick={() => onReload()}
          disabled={isReloadPending}
          aria-label={VIEWER_RELOAD_BUTTON_COPY.ariaLabel}
          data-testid={TEST_IDS.IMAGE_VIEWER_BTN_RELOAD}
        >
          {VIEWER_RELOAD_BUTTON_COPY.label}
        </button>
      )}
      {actions.includes('close') && onClose && (
        <button
          type="button"
          className={styles.bannerButton}
          onClick={() => onClose()}
          data-testid={FRESHNESS_NOTICE_TEST_IDS.close}
        >
          {NOTICE_BUTTON_COPY.close}
        </button>
      )}
      {actions.includes('dismiss-limited') && onDismissLimited && (
        <button
          type="button"
          className={styles.bannerButton}
          onClick={() => onDismissLimited()}
          data-testid={FRESHNESS_NOTICE_TEST_IDS.dismissLimited}
        >
          {NOTICE_BUTTON_COPY.dismiss}
        </button>
      )}
    </div>
  )
}

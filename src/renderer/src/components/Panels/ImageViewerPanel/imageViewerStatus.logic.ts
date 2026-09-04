// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure status/copy helpers for the image viewer.
 *
 * Every user-facing string the refresh feature adds lives here so tests assert
 * against a constant rather than a literal, and so a copy change is a one-file
 * edit. Sentence case, en dashes (never em dashes), per the project style.
 *
 * Two rules this module exists to keep honest:
 *
 * 1. **Cause and remedy are visible text, not an accessible name.** The banner
 *    carries them, because a sighted user who is told only "Auto-refresh
 *    unavailable" cannot discover that the fix is closing tabs (QG-11a H3).
 * 2. **The same fact is never stated twice.** When the banner already reports a
 *    degradation, the toolbar slot falls through to whatever is next, so a
 *    `role="alert"` and a `role="status"` never announce the same sentence.
 *
 * @module imageViewerStatus.logic
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { IMAGE_EXPORT } from '../../../../../shared/ipc/image-export-schema'
import { WATCHED_FILES_CAP } from '../../../constants/fileWatch'

// ============================================================================
// Types
// ============================================================================

/**
 * Why auto-refresh is unavailable for a file.
 *
 * - `limit` – `file-watch:start` refused because the app-wide
 *   `MAX_WATCHED_FILES` cap ({@link WATCHED_FILES_CAP} watched files) is full.
 *   Attributed only when the refusal carries the cap's own error, never by
 *   elimination.
 * - `watcher-error` – every other way the watch can be dead: it existed and
 *   then died (`file-watch:error`), the main process told us a project switch
 *   invalidated it, or `start` failed for a reason that is not the cap.
 */
export type WatchUnavailableReason = 'limit' | 'watcher-error'

/**
 * Which degradation the banner is reporting, if any.
 *
 * - `deleted` – the file is gone from disk and was still gone when re-checked.
 * - `unavailable` – the watch is dead, so nothing will arrive by itself.
 * - `stale` – the watch is alive and fired, but the re-read failed, so the
 *   image on screen is older than the file on disk.
 */
export type ViewerBannerVariant = 'deleted' | 'unavailable' | 'stale'

/**
 * How a user-initiated Reload failed.
 *
 * - `missing` – the file is still not on disk, so there was nothing to read.
 * - `watch` – the file is there, but the watch could not be restarted.
 */
export type ReloadFailure = 'missing' | 'watch'

/**
 * Mutually exclusive states of the toolbar status slot.
 *
 * A Reload failure outranks everything: it is the answer to a click the user
 * just made, and without it a failed Reload changes nothing on screen at all.
 */
export type ViewerStatus =
  | 'idle'
  | 'reloading'
  | 'unavailable'
  | 'stale'
  | 'reload-failed-missing'
  | 'reload-failed-watch'

/** Visual weight of a status, so the toolbar does not hard-code a colour per state. */
export type ViewerStatusTone = 'neutral' | 'positive' | 'warning'

/** Inputs to {@link getBannerVariant}. */
export interface BannerVariantInput {
  /** The file was deleted on disk and was still gone when re-checked. */
  isFileDeleted: boolean
  /** The watch is dead: start failed, errored, or the session ended. */
  isWatchUnavailable: boolean
  /** The most recent re-read failed, so the painted image is behind the file. */
  isStale: boolean
}

/** Inputs to {@link getViewerStatus}. */
export interface ViewerStatusInput {
  /** The watch is dead: start failed, errored, or the session ended. */
  isWatchUnavailable: boolean
  /** The most recent re-read failed, so the painted image is behind the file. */
  isStale: boolean
  /** A refresh landed within the last `INDICATOR_DURATION_MS`. */
  isReloading: boolean
  /** A Reload the user asked for failed within the last `INDICATOR_DURATION_MS`. */
  reloadFailure: ReloadFailure | null
  /**
   * What the banner is rendering right now, or `null` when it is not mounted.
   *
   * Passed as the variant rather than as a bare "is the banner visible"
   * boolean: with a boolean, a banner reporting a *deleted* file would also
   * suppress the "auto-refresh unavailable" slot, and that fact would then
   * appear nowhere at all.
   */
  bannerVariant: ViewerBannerVariant | null
}

// ============================================================================
// Copy
// ============================================================================

/**
 * Toolbar status-slot copy.
 *
 * Deliberately short: the slot sits between the metadata and the zoom controls,
 * so it states the fact and the banner underneath carries cause and remedy.
 */
export const VIEWER_STATUS_COPY = {
  /** Visible text after a successful refresh. */
  reloading: 'Reloaded from disk',
  /** Visible text while the watch is dead. */
  unavailable: 'Auto-refresh unavailable',
  /** Visible text when the last re-read failed and the image on screen is behind disk. */
  stale: 'Could not load the latest version',
  /** Visible text after a Reload that found nothing on disk. */
  reloadFailedMissing: 'Still missing on disk',
  /** Visible text after a Reload that could not restart the watch. */
  reloadFailedWatch: 'Auto-refresh could not be restarted'
} as const

/**
 * Banner copy: the only place cause and remedy are stated in VISIBLE text.
 *
 * The editor's precedent ("This file was deleted on disk. Save to restore it.")
 * is impossible in a read-only viewer, so the viewer states what it is showing
 * and offers Reload instead.
 *
 * The `limit` wording names the cap, because "too many files are open" left the
 * user pressing Reload against a cap that was still full with no way to learn
 * that closing tabs is the fix.
 */
export const VIEWER_BANNER_COPY = {
  deleted: 'This file was deleted on disk. Showing the last version that was loaded.',
  // NOTE: the number is `MAX_WATCHED_FILES` from the main process, re-exported
  // through the renderer constant so the two cannot drift (see the guard test
  // in `constants/fileWatch.test.ts`).
  unavailableLimit:
    `Auto-refresh is unavailable – Erfana is watching its maximum of ${WATCHED_FILES_CAP} files. ` +
    'Close some tabs, then choose Reload.',
  unavailableWatcherError:
    'Auto-refresh is unavailable – the file watcher stopped. Showing the version that was ' +
    'loaded. Choose Reload to try again.',
  stale:
    'Could not load the latest version of this file. Showing the version that was loaded. ' +
    'Choose Reload to try again.'
} as const

/** Visible label and accessible name of the banner's single action. */
export const VIEWER_RELOAD_BUTTON_COPY = {
  label: 'Reload',
  ariaLabel: 'Reload image from disk'
} as const

/**
 * Copy deck for the three export controls (issue #73).
 *
 * Every string the export feature shows a user lives here: tooltips, accessible
 * names, their busy variants, the live-region sentence and the toast titles.
 * Tests assert against these constants, so a copy change is a one-file edit and
 * cannot drift from what the toolbar renders.
 *
 * Rules this deck encodes:
 *
 * 1. **Sentence case, format acronyms upper case** – matching this toolbar's
 *    existing `Zoom out (-)` / `Fit to view (F)` / `Full screen`.
 * 2. **No shortcut suffix.** No keyboard shortcut exists for these actions, and
 *    inventing one in a tooltip would promise a key that does nothing.
 * 3. **The accessible name says "image" where the tooltip does not.** A tooltip
 *    is read in the visual context of the panel; an accessible name may be read
 *    with no context at all.
 * 4. `Copy to clipboard` deliberately does not say PNG – the user is copying
 *    *the image*. That it lands as PNG bytes is a result, and the success toast
 *    is where that is stated.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
export const IMAGE_EXPORT_COPY = {
  png: {
    tooltip: 'Export as PNG',
    ariaLabel: 'Export image as PNG',
    ariaLabelBusy: 'Exporting PNG, please wait',
    announceBusy: 'Exporting PNG…',
    toastTitle: 'PNG exported',
    toastErrorTitle: 'Export failed'
  },
  pdf: {
    tooltip: 'Export as PDF',
    ariaLabel: 'Export image as PDF',
    ariaLabelBusy: 'Exporting PDF, please wait',
    announceBusy: 'Exporting PDF…',
    toastTitle: 'PDF exported',
    toastErrorTitle: 'Export failed'
  },
  clipboard: {
    tooltip: 'Copy to clipboard',
    ariaLabel: 'Copy image to clipboard',
    ariaLabelBusy: 'Copying image, please wait',
    announceBusy: 'Copying image…',
    toastTitle: 'Copied to clipboard',
    toastErrorTitle: 'Copy failed'
  }
} as const

/**
 * Which export action a control, a busy flag or a toast belongs to.
 *
 * Derived from {@link IMAGE_EXPORT_COPY} rather than written out again, so a
 * fourth action cannot be added to the deck without the type following it.
 */
export type ImageExportAction = keyof typeof IMAGE_EXPORT_COPY

/**
 * Message-body templates for the export toasts (issue #73).
 *
 * Kept beside the button copy for the same reason: one file owns every string
 * this feature can put on screen. The qualifier clauses use an EN DASH and the
 * ` x ` dimension spacing that `formatDimensions()` (imageViewer.logic.ts)
 * already prints in this toolbar, so a toast and the metadata row read the same.
 */
export const IMAGE_EXPORT_TOAST_COPY = {
  /** Body of a successful PNG/PDF export; `name` is the truncated basename. */
  saved: (name: string): string => `Saved as ${name}`,
  /** Body of a successful clipboard copy. */
  copied: 'Image copied as PNG',
  /** Animated-GIF qualifier; only ever composed when `frameCount > 1`. */
  gifFrame: (frameCount: number): string => `first frame of ${frameCount}`,
  /** Multi-size-ICO qualifier; only ever composed when `sizeCount > 1`. */
  icoSize: (width: number, height: number, sizeCount: number): string =>
    `${width} x ${height} of ${sizeCount} sizes`,
  /**
   * SVG qualifier, naming the fixed rasterization factor and its result.
   *
   * The factor is interpolated from the constant main actually rasterizes at,
   * so raising `SVG_RASTER_SCALE` cannot leave this sentence claiming a scale
   * the file was never rendered at.
   */
  svgScaled: (width: number, height: number): string =>
    `rendered at ${IMAGE_EXPORT.SVG_RASTER_SCALE}x (${width} x ${height})`,
  /**
   * Body used when the IPC call itself rejected, so no response - and therefore
   * no `error` string - ever came back.
   *
   * Verbatim the main process's own catch-all message for
   * `IMAGE_EXPORT_FAILED`, so the two channels cannot describe the same class
   * of failure differently. The raw error goes to the log, never to the UI: it
   * can carry an absolute path.
   */
  bridgeFailure: 'Image export failed'
} as const

// ============================================================================
// Pure functions
// ============================================================================

/**
 * Resolves which degradation the banner reports, if any.
 *
 * Precedence is "most specific cause first": a deleted file explains a failed
 * re-read, and a dead watch explains why nothing arrives, so either outranks
 * the generic "the last read failed".
 *
 * @param input - Current degraded state
 * @returns The banner variant, or `null` when nothing is wrong
 *
 * @example
 * ```ts
 * getBannerVariant({ isFileDeleted: true, isWatchUnavailable: true, isStale: true }) // 'deleted'
 * getBannerVariant({ isFileDeleted: false, isWatchUnavailable: false, isStale: true }) // 'stale'
 * getBannerVariant({ isFileDeleted: false, isWatchUnavailable: false, isStale: false }) // null
 * ```
 */
export function getBannerVariant(input: BannerVariantInput): ViewerBannerVariant | null {
  if (input.isFileDeleted) return 'deleted'
  if (input.isWatchUnavailable) return 'unavailable'
  if (input.isStale) return 'stale'
  return null
}

/**
 * Visible banner text for a variant.
 *
 * @param variant - Variant from {@link getBannerVariant}
 * @param reason - Why the watch is unavailable, when it is
 * @returns The sentence to render inside the banner
 *
 * @example
 * ```ts
 * getBannerMessage('unavailable', 'limit')
 * // 'Auto-refresh is unavailable – Erfana is watching its maximum of 100 files. …'
 * ```
 */
export function getBannerMessage(
  variant: ViewerBannerVariant,
  reason: WatchUnavailableReason | null
): string {
  switch (variant) {
    case 'deleted':
      return VIEWER_BANNER_COPY.deleted
    case 'stale':
      return VIEWER_BANNER_COPY.stale
    default:
      // An unattributed refusal is reported as a watcher fault, never as the
      // cap: telling a user to close tabs they do not have wastes their time.
      return reason === 'limit'
        ? VIEWER_BANNER_COPY.unavailableLimit
        : VIEWER_BANNER_COPY.unavailableWatcherError
  }
}

/**
 * Resolves the single status the toolbar slot renders.
 *
 * Expressed as one function rather than a chain of `{cond && …}` blocks so the
 * precedence is compile-time total and testable in isolation:
 *
 * 1. a Reload the user just asked for and that failed – nothing else on screen
 *    changes when `recover()` returns false, so this is the only feedback;
 * 2. a dead watch, unless the banner is already saying so;
 * 3. a failed re-read, unless the banner is already saying so;
 * 4. the transient "Reloaded from disk" confirmation.
 *
 * @param input - Current watch, indicator and banner state
 * @returns The status to render
 *
 * @example
 * ```ts
 * const idle = { isWatchUnavailable: false, isStale: false, isReloading: false,
 *                reloadFailure: null, bannerVariant: null }
 * getViewerStatus({ ...idle, isReloading: true })                              // 'reloading'
 * getViewerStatus({ ...idle, isWatchUnavailable: true })                       // 'unavailable'
 * getViewerStatus({ ...idle, isWatchUnavailable: true,
 *                  bannerVariant: 'unavailable' })                             // 'idle'
 * getViewerStatus({ ...idle, reloadFailure: 'missing' })                       // 'reload-failed-missing'
 * ```
 */
export function getViewerStatus(input: ViewerStatusInput): ViewerStatus {
  if (input.reloadFailure === 'missing') return 'reload-failed-missing'
  if (input.reloadFailure === 'watch') return 'reload-failed-watch'
  if (input.isWatchUnavailable && input.bannerVariant !== 'unavailable') return 'unavailable'
  if (input.isStale && input.bannerVariant !== 'stale') return 'stale'
  if (input.isReloading) return 'reloading'
  return 'idle'
}

/**
 * Visible text for a status slot state.
 *
 * `idle` renders an empty string rather than unmounting the element: a live
 * region that is not in the DOM before the change never announces it. The
 * visible text is also the whole accessible name – the slot carries no
 * `aria-label`, so a sighted user and a screen-reader user get the same words.
 *
 * @param status - Status from {@link getViewerStatus}
 * @returns Text to render inside the slot (may be empty)
 */
export function getStatusText(status: ViewerStatus): string {
  switch (status) {
    case 'reloading':
      return VIEWER_STATUS_COPY.reloading
    case 'unavailable':
      return VIEWER_STATUS_COPY.unavailable
    case 'stale':
      return VIEWER_STATUS_COPY.stale
    case 'reload-failed-missing':
      return VIEWER_STATUS_COPY.reloadFailedMissing
    case 'reload-failed-watch':
      return VIEWER_STATUS_COPY.reloadFailedWatch
    default:
      return ''
  }
}

/**
 * Visual weight of a status.
 *
 * Kept out of the component so "bad news is never painted in the positive
 * colour" is a tested rule rather than a class-name ternary.
 *
 * @param status - Status from {@link getViewerStatus}
 * @returns `positive` for the refresh confirmation, `warning` for every
 *   degradation, `neutral` when there is nothing to show
 */
export function getStatusTone(status: ViewerStatus): ViewerStatusTone {
  if (status === 'reloading') return 'positive'
  if (status === 'idle') return 'neutral'
  return 'warning'
}

/**
 * Formats a timestamp as a 24-hour local wall clock.
 *
 * A 24-hour clock avoids an am/pm suffix widening the toolbar and reads the
 * same in every locale the app ships in.
 *
 * @param timestamp - Milliseconds since the epoch. `0` means "never loaded".
 * @returns `hh:mm:ss`, or an empty string when there is no timestamp to show
 *
 * @example
 * ```ts
 * formatClockTime(new Date(2026, 0, 1, 14, 32, 5).getTime()) // '14:32:05'
 * formatClockTime(0)                                         // ''
 * formatClockTime(Number.NaN)                                // ''
 * ```
 */
export function formatClockTime(timestamp: number): string {
  // 0 is the "not loaded yet" sentinel, not midnight in 1970.
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''

  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')

  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Builds the visible "Updated hh:mm:ss" metadata stamp.
 *
 * @param timestamp - When the current bytes were read from disk
 * @returns Stamp text, or an empty string when there is nothing to report
 */
export function formatUpdatedStamp(timestamp: number): string {
  const clock = formatClockTime(timestamp)
  return clock ? `Updated ${clock}` : ''
}

/**
 * Accessible name for the "Updated hh:mm:ss" stamp.
 *
 * @param timestamp - When the current bytes were read from disk
 * @returns Accessible name, or an empty string when there is nothing to report
 */
export function formatUpdatedAccessibleName(timestamp: number): string {
  const clock = formatClockTime(timestamp)
  return clock ? `Last updated at ${clock}` : ''
}

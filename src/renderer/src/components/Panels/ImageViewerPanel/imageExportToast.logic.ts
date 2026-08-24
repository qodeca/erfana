// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure formatting for the image-export toasts and their live-region sentence.
 *
 * The whole point of the export feature's shape is that every DECISION is made
 * by a pure function: main decides which frame, which size and what background,
 * and this module decides what the user is told about it. Nothing here touches
 * React, the DOM or the bridge, so every row of the copy table in the design is
 * a plain unit assertion.
 *
 * Two rules it exists to keep honest:
 *
 * 1. **The toast can never lie.** Every qualifier is composed from structured
 *    fields the main process reported after the fact (`selection`), never from
 *    a guess about what the file contained. No `selection`, no qualifier.
 * 2. **A cancelled export says nothing at all.** The user cancelled; telling
 *    them so is noise, and it is the one settled outcome with no toast and no
 *    announcement.
 *
 * Copy lives in `imageViewerStatus.logic.ts` – this module composes, it does
 * not author.
 *
 * @module imageExportToast.logic
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import type {
  ImageExportResponse,
  ImageExportTarget
} from '../../../../../shared/ipc/image-export-schema'
import type { GlobalToastPayload } from '../../Toast/toastService'
import { sanitizeFileName } from '../../../utils/fileUtils'
import { IMAGE_EXPORT_COPY, IMAGE_EXPORT_TOAST_COPY } from './imageViewerStatus.logic'

// ============================================================================
// Constants
// ============================================================================

/** How long a success toast stays up, matching `useExportHandlers`. */
export const EXPORT_TOAST_SUCCESS_MS = 3000

/** How long an error toast stays up, matching `useExportHandlers`. */
export const EXPORT_TOAST_ERROR_MS = 5000

/**
 * Longest basename rendered into a toast body before middle-truncation.
 *
 * `.toast-message` has `max-width: 400px` and no `overflow-wrap`, so an
 * unbroken 60-character filename overflows the toast rather than wrapping. The
 * global one-line fix belongs in `Toast.css` and is recorded as a pre-existing
 * finding; this bound contains the damage inside this feature.
 */
export const TOAST_FILENAME_MAX_LENGTH = 48

/** Separator between the toast's subject and its optional qualifier. */
const QUALIFIER_SEPARATOR = ' – '

/** Error code whose only correct treatment is silence. */
const CANCELLED_CODE = 'IMAGE_EXPORT_CANCELLED'

// ============================================================================
// Types
// ============================================================================

/** Options for {@link formatExportToast}. */
export interface FormatExportToastOptions {
  /**
   * The action the user invoked.
   *
   * Passed in rather than read off the response because the FAILURE branch
   * carries no target – it carries only the code and its message – and the
   * error title differs between an export (`Export failed`) and a copy
   * (`Copy failed`).
   *
   * Typed against the SHARED target union rather than the copy deck's own keys,
   * so a target the deck has no copy for is a compile error here.
   */
  target: ImageExportTarget
}

/** Options for {@link formatSettledAnnouncement}. */
export interface FormatAnnouncementOptions {
  /** Whether the full-screen overlay is the top surface. */
  isFullScreen: boolean
}

/**
 * Which of the panel's two export live regions a sentence belongs in.
 *
 * `ToastNotification` splits its own announcements the same way and for the
 * same reason: `role="status"` is polite and can be queued behind whatever the
 * reader is already saying, which is right for "PNG exported" and wrong for
 * "Export failed". Errors go to the assertive region so a user who is told the
 * export failed cannot mistake silence for success.
 */
export type ExportAnnouncementRegion = 'polite' | 'alert'

/** One sentence for the panel's export live regions, and where it goes. */
export interface ExportAnnouncement {
  /** The sentence; `''` clears both regions. */
  text: string
  /** The region that should carry it. Irrelevant while `text` is empty. */
  region: ExportAnnouncementRegion
}

/** Nothing to announce — both regions render empty. */
export const SILENT_ANNOUNCEMENT: ExportAnnouncement = { text: '', region: 'polite' }

/**
 * Wrap a sentence that should be announced politely.
 *
 * @param text - The sentence
 * @returns The announcement, routed to the `role="status"` region
 */
export function politeAnnouncement(text: string): ExportAnnouncement {
  return { text, region: 'polite' }
}

// ============================================================================
// Pure helpers
// ============================================================================

/**
 * Shorten a string from the middle, keeping both ends readable.
 *
 * Filenames carry their meaning at both ends – a project prefix at the front
 * and the extension at the back – so a tail-only ellipsis hides exactly the
 * part that says what kind of file was written.
 *
 * @param value - Text to shorten
 * @param maxLength - Longest result, including the ellipsis
 * @returns `value` unchanged when it already fits, otherwise a middle-elided form
 *
 * @example
 * ```ts
 * truncateMiddle('diagram.png', 48)                        // 'diagram.png'
 * truncateMiddle('favicon-generated-2026-01-final.png', 20) // 'favicon-g…-final.png'
 * ```
 */
export function truncateMiddle(value: string, maxLength: number): string {
  if (maxLength <= 1) return '…'
  if (value.length <= maxLength) return value

  const keep = maxLength - 1 // one character for the ellipsis
  const head = Math.ceil(keep / 2)
  const tail = keep - head

  return `${value.slice(0, head)}…${tail > 0 ? value.slice(value.length - tail) : ''}`
}

/**
 * Build the qualifier clause for a reported selection.
 *
 * Suppression is deliberate: "first frame of 1" and "256 x 256 of 1 sizes" are
 * noise about a choice that was never made. A single-frame GIF and a
 * single-size ICO therefore read exactly like a plain PNG.
 *
 * @param selection - What the main process chose, when there was a choice
 * @returns The clause, or `null` when there is nothing worth saying
 *
 * @example
 * ```ts
 * buildSelectionQualifier({ kind: 'gif-frame', frameCount: 12 }) // 'first frame of 12'
 * buildSelectionQualifier(undefined)                             // null
 * ```
 */
export function buildSelectionQualifier(
  selection: Extract<ImageExportResponse, { success: true }>['selection']
): string | null {
  if (!selection) return null

  switch (selection.kind) {
    case 'gif-frame':
      return selection.frameCount > 1
        ? IMAGE_EXPORT_TOAST_COPY.gifFrame(selection.frameCount)
        : null
    case 'ico-size':
      return selection.sizeCount > 1
        ? IMAGE_EXPORT_TOAST_COPY.icoSize(selection.width, selection.height, selection.sizeCount)
        : null
    case 'svg-scaled':
      return IMAGE_EXPORT_TOAST_COPY.svgScaled(selection.width, selection.height)
    default:
      // Unreachable while the union is exhaustive; a new variant with no copy
      // yet degrades to no qualifier rather than to `undefined` on screen.
      return null
  }
}

// ============================================================================
// Formatters
// ============================================================================

/**
 * Turn an export response into the toast to show, if any.
 *
 * @param result - Response from `window.api.imageExport.run`
 * @param options - The action the user invoked
 * @returns The toast payload, or `null` when nothing should be shown
 *
 * @example Success with a qualifier
 * ```ts
 * formatExportToast(
 *   { success: true, target: 'png', filePath: '/out/loop.png',
 *     output: { width: 64, height: 64 },
 *     selection: { kind: 'gif-frame', frameCount: 12 } },
 *   { target: 'png' }
 * )
 * // { title: 'PNG exported', message: 'Saved as loop.png – first frame of 12', … }
 * ```
 *
 * @example Cancellation
 * ```ts
 * formatExportToast(
 *   { success: false, errorCode: 'IMAGE_EXPORT_CANCELLED', error: '…' },
 *   { target: 'png' }
 * ) // null
 * ```
 */
export function formatExportToast(
  result: ImageExportResponse,
  options: FormatExportToastOptions
): GlobalToastPayload | null {
  const copy = IMAGE_EXPORT_COPY[options.target]

  if (!result.success) {
    // The user dismissed the save dialog: no toast, no announcement, nothing.
    if (result.errorCode === CANCELLED_CODE) return null

    return {
      title: copy.toastErrorTitle,
      // `error` is REQUIRED on the failure branch and is always
      // ERROR_MESSAGES[errorCode], so there is no "Unknown error" to fall back to.
      message: result.error,
      type: 'error',
      duration: EXPORT_TOAST_ERROR_MS
    }
  }

  const qualifier = buildSelectionQualifier(result.selection)
  const subject = buildSuccessSubject(result, options.target)

  // A success the formatter cannot describe truthfully is better left silent
  // than announced as "Saved as ". Unreachable via the schema, which requires
  // `filePath` on every non-clipboard success.
  if (subject === null) return null

  return {
    title: copy.toastTitle,
    message: qualifier ? `${subject}${QUALIFIER_SEPARATOR}${qualifier}` : subject,
    type: 'success',
    duration: EXPORT_TOAST_SUCCESS_MS
  }
}

/**
 * Compose the sentence the panel's export live regions should settle on, and
 * decide which of the two carries it.
 *
 * While the full-screen overlay is open it is `aria-modal="true"` and the toast
 * regions live outside it, so a screen reader may never speak the completion
 * toast. In that surface the settled sentence goes into the in-overlay live
 * regions instead; worst case a reader honouring both says it twice, and the
 * alternative is silence.
 *
 * A FAILURE is routed to the assertive region. Announcing "Export failed"
 * politely is the one outcome where being queued or dropped changes what the
 * user believes happened — they are left thinking the file was written.
 *
 * @param toast - The toast {@link formatExportToast} produced, or `null`
 * @param options - Which surface is on top
 * @returns The sentence and its region; empty text clears both
 *
 * @example
 * ```ts
 * formatSettledAnnouncement(
 *   { title: 'Export failed', message: 'Could not write', type: 'error' },
 *   { isFullScreen: true }
 * ) // { text: 'Export failed: Could not write', region: 'alert' }
 * ```
 */
export function formatSettledAnnouncement(
  toast: GlobalToastPayload | null,
  options: FormatAnnouncementOptions
): ExportAnnouncement {
  if (!options.isFullScreen || !toast) return SILENT_ANNOUNCEMENT
  return {
    text: `${toast.title}: ${toast.message}`,
    region: toast.type === 'error' ? 'alert' : 'polite'
  }
}

/**
 * Subject half of a success message: what happened, before any qualifier.
 *
 * @param result - The successful response
 * @param target - The action the user invoked
 * @returns The subject, or `null` when a file target reported no path
 */
function buildSuccessSubject(
  result: Extract<ImageExportResponse, { success: true }>,
  target: ImageExportTarget
): string | null {
  if (target === 'clipboard') return IMAGE_EXPORT_TOAST_COPY.copied
  if (!result.filePath) return null

  // The destination is the user's own chosen path; only its basename is shown,
  // sanitized (control characters, native separators) and middle-truncated.
  const name = truncateMiddle(sanitizeFileName(result.filePath), TOAST_FILENAME_MAX_LENGTH)
  return IMAGE_EXPORT_TOAST_COPY.saved(name)
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The same-tab move coordinator's toast wording (issue #124, part 3 §3.6
 * refusal UX). Split from `previewTabMove.ts` to keep it under the line cap.
 *
 * @module previewTabMoveMessages
 */
import { ErrorCode } from '../../../../shared/errors'
import { getBasename } from '../../utils/fileUtils'
import type { PreviewMoveRequest, PreviewMoveToast } from './previewTabMove'

/**
 * A file name for a toast: the base name, or `the page` when there is none.
 *
 * @param filePath - The page's path, if known
 * @returns The base name, e.g. `pricing.html`, or `the page`
 */
export function nameOf(filePath: string | null | undefined): string {
  return (filePath && getBasename(filePath)) || 'the page'
}

/** Capitalises a sentence that starts with the `the page` fallback; real names stay as they are. */
function sentence(text: string): string {
  return text.startsWith('the page') ? `T${text.slice(1)}` : text
}

/**
 * The toast for a refused move (§3.6 refusal UX), or `null` for a `SKIPPED`
 * nobody was asked about. `target` and `current` are file names.
 *
 * @param code - Main's refusal code
 * @param action - The move that was refused
 * @param target - File name of the page the tab was moving to
 * @param current - File name of the page the tab stays on
 * @param prompted - Whether the user answered the unsaved-changes prompt for this move
 * @returns The toast to show, or `null` for none
 *
 * @example
 * ```ts
 * refusalToast(ErrorCode.PREVIEW_NAV_TARGET_REFUSED, 'open', 'pricing.html', 'index.html', false)
 * // { type: 'error', title: 'Could not show pricing.html', message: 'pricing.html cannot be … ' }
 * ```
 */
export function refusalToast(
  code: ErrorCode,
  action: PreviewMoveRequest['action'],
  target: string,
  current: string,
  prompted: boolean
): PreviewMoveToast | null {
  const stayed = `This tab stayed on ${current}.`
  const title = `Could not show ${target}`
  switch (code) {
    case ErrorCode.PREVIEW_NAV_TARGET_MISSING:
      return {
        type: 'error',
        title,
        message:
          action === 'open'
            ? sentence(`${target} is no longer there – it may have been moved or deleted. ${stayed}`)
            : sentence(
                `${target} is no longer there, so it was removed from this tab's history. ${stayed}`
              )
      }
    case ErrorCode.PREVIEW_NAV_TARGET_REFUSED:
      return {
        type: 'error',
        title,
        message: sentence(`${target} cannot be shown as a preview here. ${stayed}`)
      }
    case ErrorCode.PREVIEW_NAV_SKIPPED:
      // Silent unless the user answered a prompt for this move: they chose, so
      // they are told it did not happen (RS2-5).
      return prompted
        ? {
            type: 'info',
            title: `Did not show ${target}`,
            message: 'This tab was still loading another page. Nothing was closed – try again.'
          }
        : null
    default:
      // PREVIEW_NAV_UNAVAILABLE, a bridge that failed, or a code this table
      // does not know: the move cannot run now.
      return { type: 'error', title, message: 'This preview is not ready. Try again in a moment.' }
  }
}

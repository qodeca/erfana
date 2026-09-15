// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "Open in default browser" – the one action the project tree and the preview
 * toolbar share (issue #124, part 4 §4.5).
 *
 * Both entry points call {@link openInDefaultBrowser}, so a tree item and a
 * toolbar button can never tell the reader two different things about the same
 * refusal. The texts are the UX spec's §7 table.
 *
 * What main sends back is deliberately generic: its `error` names no file,
 * because it crosses IPC and ends up in logs. The file name only ever appears in
 * the toast, which is built HERE from the path the caller already holds – the
 * CLAUDE.md rule (toasts carry the full name; logs do not).
 *
 * Success is silent: the browser coming to the front is the feedback.
 *
 * @module previewOpenInBrowser
 * @see docs/design/design-issue-124-part4.md §4.5
 * @see src/shared/ipc/browser-schema.ts for the wire contract
 */

import { ErrorCode } from '../../../../../shared/errors'
import {
  BrowserOpenFileResponseSchema,
  type BrowserOpenErrorCode
} from '../../../../../shared/ipc/browser-schema'
import { getBasename } from '../../../utils/fileUtils'
import { logger } from '../../../utils/logger'
import { isMacOS, isWindows } from '../../../utils/platform'
import { showGlobalToast } from '../../Toast/toastService'

/** Title of every refusal toast (UX spec §7). */
export const OPEN_IN_BROWSER_ERROR_TITLE = 'Could not open in browser'

/** Title of the notice raised when no default browser could be found. */
export const OPEN_IN_BROWSER_FALLBACK_TITLE = 'Opened in the app for .html files'

/**
 * Why a request never produced a usable answer. Logged in place of an error
 * code; neither carries the path or the raw error.
 */
type TransportFailure = 'INVOKE_REJECTED' | 'INVALID_RESPONSE'

/**
 * The name of the file manager's reveal command on this platform – the same
 * words the tree's own "Reveal in …" item uses, so the toast points at a
 * command the reader can actually find.
 */
function revealCommandName(): string {
  if (isMacOS()) return 'Reveal in Finder'
  if (isWindows()) return 'Reveal in Explorer'
  return 'Reveal in File Manager'
}

/**
 * The refusal text for one error code, naming the file where the code is about
 * the file.
 *
 * `NO_PROJECT` and `INVALID_REQUEST` share the launch-failure text on purpose
 * (RU13): neither is something the reader can act on from this toast, and
 * "try again, or reveal it yourself" is the honest advice for both. `null` is a
 * request that never produced an answer (a rejected invoke, a malformed reply).
 *
 * @param code - The code main answered with, or `null` for no usable answer.
 * @param fileName - The base name of the requested file, for the named texts.
 * @returns The toast message, in sentence case with en dashes.
 *
 * @example
 * ```ts
 * describeOpenInBrowserFailure(ErrorCode.OPEN_IN_BROWSER_MISSING, 'pricing.html')
 * // 'pricing.html is no longer there – it may have been moved or deleted.'
 * ```
 */
export function describeOpenInBrowserFailure(
  code: BrowserOpenErrorCode | null,
  fileName: string
): string {
  switch (code) {
    case ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT:
      return `${fileName} leads outside the open project, so Erfana will not open it in a browser.`
    case ErrorCode.OPEN_IN_BROWSER_NOT_HTML:
      return `${fileName} is not an HTML page. Only .html and .htm files can be opened in a browser.`
    case ErrorCode.OPEN_IN_BROWSER_MISSING:
      return `${fileName} is no longer there – it may have been moved or deleted.`
    case ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED:
    case ErrorCode.OPEN_IN_BROWSER_NO_PROJECT:
    case ErrorCode.OPEN_IN_BROWSER_INVALID_REQUEST:
    case null:
      return `Your browser did not start. Try again, or use ${revealCommandName()} to open the file yourself.`
  }
}

/** Log a refusal by its code alone, then show the reader the named text. */
function reportFailure(
  code: BrowserOpenErrorCode | TransportFailure,
  filePath: string
): void {
  logger.warn('Open in default browser refused', { errorCode: code })
  const known = code === 'INVOKE_REJECTED' || code === 'INVALID_RESPONSE' ? null : code
  showGlobalToast({
    type: 'error',
    title: OPEN_IN_BROWSER_ERROR_TITLE,
    message: describeOpenInBrowserFailure(known, getBasename(filePath))
  })
}

/**
 * Asks main to open a project `.html` / `.htm` file in the default browser and
 * tells the reader what happened.
 *
 * The path is passed through unchanged – native separators included – because
 * main confines it to the open project and launches the REAL path it resolved
 * itself; nothing here is a check.
 *
 * Never rejects. The service never does either, but the `invoke` can: the
 * process-wide sender gate throws when it refuses a sender. That, and a reply
 * that does not match the contract, both surface as the launch-failure toast
 * rather than as an unhandled rejection that leaves the reader with nothing.
 *
 * @param filePath - Absolute path of the page, as the tree node or the preview
 *   tab (`params.filePath`, the page it shows now) holds it.
 * @returns Resolves once main has answered and any toast has been raised.
 *
 * @example From the preview toolbar
 * ```ts
 * await openInDefaultBrowser(params.filePath)
 * ```
 *
 * @example From the project tree's menu context
 * ```ts
 * const ctx: MenuContext = { ...rest, openInBrowser: openInDefaultBrowser }
 * ```
 */
export async function openInDefaultBrowser(filePath: string): Promise<void> {
  let reply: unknown
  try {
    reply = await window.api.browser.openFile(filePath)
  } catch {
    reportFailure('INVOKE_REJECTED', filePath)
    return
  }

  const parsed = BrowserOpenFileResponseSchema.safeParse(reply)
  if (!parsed.success) {
    reportFailure('INVALID_RESPONSE', filePath)
    return
  }

  const result = parsed.data
  if (!result.success) {
    reportFailure(result.errorCode, filePath)
    return
  }

  // Shown every time it happens: it is rare on macOS and Windows, and showing
  // it every time needs nothing remembered (UX spec §7).
  if (result.usedFallback) {
    showGlobalToast({
      type: 'info',
      title: OPEN_IN_BROWSER_FALLBACK_TITLE,
      message: `Erfana could not find your default web browser, so ${getBasename(filePath)} opened in the app your system uses for .html files.`
    })
  }
}

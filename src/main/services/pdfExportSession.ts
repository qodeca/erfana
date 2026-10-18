// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Isolating the window the PDF export renders in.
 *
 * The export window is handed an HTML string that came from the renderer and
 * loads it from a temp `file://` page. Everything here exists so that page can
 * do exactly one thing – lay out and print – and nothing else.
 *
 * - Own in-memory partition, so nothing is shared with the app's default
 *   session and nothing is written to disk.
 * - A request filter that admits the one temp page being loaded and, for
 *   images only, the schemes listed under {@link isAllowedPdfRequest}.
 * - A CSP `<meta>` limiting what the page itself may run or fetch.
 * - Popups, navigation and permissions are denied explicitly on this window,
 *   whatever the app-wide defaults are.
 *
 * Like `imageExport/rasterizeSession`, the session controls are installed
 * BEFORE the window that uses the partition is constructed.
 */
import { session, type BrowserWindow, type Session } from 'electron'
import { pathToFileURL } from 'url'
import { logger } from './LoggingService'
import { redactPath } from '../utils/redactUserInput'

/**
 * In-memory partition (no `persist:` prefix). `session.fromPartition` returns
 * the same Session for the life of the process, so the filter below is
 * re-installed on every export; `onBeforeRequest` replaces the previous listener.
 */
export const PDF_EXPORT_PARTITION = 'pdf-export'

/** Strip query and fragment so the comparison is on the document identity. */
function withoutQueryAndHash(url: URL): string {
  const clean = new URL(url.href)
  clean.search = ''
  clean.hash = ''
  return clean.href
}

/**
 * May the export window fetch this URL?
 *
 * Decision on images: the Markdown preview can contain `![](https://…)`
 * images and the PDF has always rendered them, so `http:` and `https:` are
 * still allowed – but ONLY as `image` resources. A remote image is a
 * deliberate user-authored reference; remote scripts, styles, frames, fonts
 * and fetches are refused. `data:` images (Mermaid diagrams arrive that way)
 * are allowed. Everything else, other `file:` URLs included, is refused.
 *
 * @param url - The request URL as Chromium reports it.
 * @param resourceType - Electron's `details.resourceType`.
 * @param allowedFileUrl - `file://` URL of the temp page for this export.
 */
export function isAllowedPdfRequest(
  url: string,
  resourceType: string,
  allowedFileUrl: string
): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol === 'file:') {
    return withoutQueryAndHash(parsed) === withoutQueryAndHash(new URL(allowedFileUrl))
  }
  if (resourceType !== 'image') return false
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'data:'
}

/**
 * Create the export session and install every session-level control on it.
 *
 * MUST be called before the `BrowserWindow` that uses this partition exists.
 *
 * @param tempFilePath - Absolute path of the temp page about to be loaded.
 */
export function preparePdfExportSession(tempFilePath: string): Session {
  const pdfSession = session.fromPartition(PDF_EXPORT_PARTITION)
  const allowedFileUrl = pathToFileURL(tempFilePath).href

  pdfSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (isAllowedPdfRequest(details.url, details.resourceType, allowedFileUrl)) {
      callback({ cancel: false })
      return
    }
    logger.warn('Blocked request from the PDF export window', {
      url: redactPath(details.url),
      resourceType: details.resourceType
    })
    callback({ cancel: true })
  })

  // Printing needs no capability: deny both the ask and the silent check.
  pdfSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  pdfSession.setPermissionCheckHandler(() => false)

  return pdfSession
}

/**
 * Content-Security-Policy for the export page. The only script allowed is the
 * readiness script, by hash; inline styles are needed for the print stylesheet
 * and for style attributes in the exported HTML.
 *
 * @param scriptSha256 - Base64 SHA-256 of the exact inline script text.
 */
export function buildPdfCsp(scriptSha256: string): string {
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptSha256}'`,
    "style-src 'unsafe-inline'",
    'img-src data: http: https:',
    "object-src 'none'",
    "base-uri 'none'"
  ].join('; ')
}

/**
 * Install the per-`webContents` controls the session cannot cover: no popups,
 * and no navigation away from the page that was loaded.
 */
export function hardenPdfWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    logger.warn('Blocked PDF export window navigation', { to: redactPath(url) })
    event.preventDefault()
  })
}

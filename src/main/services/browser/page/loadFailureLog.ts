// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one log line of a browser page that failed to load (spec 025,
 * 025-FR-042, 025-FR-064, 025-AC-042).
 *
 * LOGGING EXCEPTION – docs/technical-debt.md entry 68: the full URL, path and
 * query included, goes to the log file for support, as a deliberate exception
 * to the `redactUserInput` convention. Userinfo and the fragment are dropped
 * (`failedRequestUrl`), and the URL is cut to its bound. A failed
 * **search-fallback** load (what the address bar sends to the search
 * engine) is logged as the event "search load failed" with no URL, so typed
 * search text never reaches the log. A served local file (ADR 0012 decision
 * 9) is logged by its file path through `redactPath` – the folders hidden,
 * the file name kept – never by its loopback address, which names the path
 * below the opened folder and the folder's token. Nothing else of the page –
 * title, form data, console text – is logged here.
 */
import { fileURLToPath } from 'node:url'
import { SEARCH_URL_PREFIX } from '../../../../shared/browser/addressInput'
import { redactPath } from '../../../utils/redactUserInput'
import { logger } from '../../LoggingService'
import { failedRequestUrl } from '../cdp/browserLogBuffer'

const SEARCH_HOST = new URL(SEARCH_URL_PREFIX).hostname

/**
 * Whether `url` is a search-engine address: the address bar's search
 * fallback, or one of the engine's own pages it moves to.
 *
 * @param url - The failed load's URL
 */
export function isSearchLoad(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === SEARCH_HOST || host.endsWith(`.${SEARCH_HOST}`)
  } catch {
    return false
  }
}

/** The redacted file of a served local address, or null for any other URL. */
function localFile(url: string, displayAddress: (url: string) => string | null): string | null {
  const shown = displayAddress(url)
  if (shown === null) return null
  try {
    return redactPath(fileURLToPath(shown))
  } catch {
    return '[redacted-filename]'
  }
}

/**
 * Log a failed page load: the error code and – a recorded exception, see the
 * module comment – the full URL, except for a search load and a local file.
 *
 * @param code - Chromium's net error code
 * @param url - The URL that failed
 * @param displayAddress - `LocalFileServers.displayAddress`: the `file://`
 *   address of a served local address, else null
 */
export function logLoadFailure(code: number, url: string, displayAddress: (url: string) => string | null = () => null): void {
  if (isSearchLoad(url)) {
    logger.info('search load failed', { code })
    return
  }
  const file = localFile(url, displayAddress)
  if (file !== null) {
    logger.info('A browser tab local file failed to load', { code, file })
    return
  }
  // LOGGING EXCEPTION: full browser URL, docs/technical-debt.md entry 68 (025-FR-042).
  logger.info('A browser tab page failed to load', { code, url: failedRequestUrl(url) })
}

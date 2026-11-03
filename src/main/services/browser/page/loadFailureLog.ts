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
 * search text never reaches the log. Nothing else of the page – title, form
 * data, console text – is logged here.
 */
import { SEARCH_URL_PREFIX } from '../../../../shared/browser/addressInput'
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

/**
 * Log a failed page load: the error code and – a recorded exception, see the
 * module comment – the full URL, except for a search load.
 *
 * @param code - Chromium's net error code
 * @param url - The URL that failed
 */
export function logLoadFailure(code: number, url: string): void {
  if (isSearchLoad(url)) {
    logger.info('search load failed', { code })
    return
  }
  // LOGGING EXCEPTION: full browser URL, docs/technical-debt.md entry 68 (025-FR-042).
  logger.info('A browser tab page failed to load', { code, url: failedRequestUrl(url) })
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page features' part of a browser tab's `state` (spec 025, 025-FR-008,
 * 025-FR-056, 025-FR-059; ADR 0011 decision 5): pure rules over what
 * `BrowserTabPage` observed.
 *
 * - **Load-error page** (025-FR-059): a main-frame load that fails with any
 *   code but `ERR_ABORTED` shows Erfana's page, which commits the address
 *   that failed (025-FR-002), so the bar names the host **Reload** would
 *   load. Keyboard focus goes to **Reload** when the user started the load,
 *   to the page's heading otherwise.
 * - **Crashed page** (025-FR-056): "This page crashed" with **Reload**.
 * - **Precedence**: the certificate page (025-FR-021) over the crashed page
 *   over the load-error page; the empty tab only when none applies.
 * - **Zoom** (025-FR-008): the level the page shows, in whole percent within
 *   the zoom steps' range.
 */
import { originParts, withoutUserInfo, type RegistrableDomainResolver } from '../../../../shared/browser/originFormat'
import { showsLoadErrorPage } from '../../../../shared/browser/netErrorMessages'
import { ZOOM_MAX_PERCENT, ZOOM_MIN_PERCENT } from '../../../../shared/browser/zoomSteps'
import type { LoadErrorPage } from '../../../../shared/ipc/browser-tab-page-schema'
import { BROWSER_URL_MAX_CHARS, type TabStateEvent } from '../../../../shared/ipc/browser-tab-schema'
import { securityStateOf } from '../browserNavigationPolicy'

/** What the tab's page features observed. */
export interface PageFacts {
  /** The address whose main-frame load failed, while the load-error page shows. */
  readonly failedUrl: string | null
  readonly loadError: LoadErrorPage | null
  readonly crashed: boolean
  readonly zoomPercent: number
}

export const NO_PAGE_FACTS: PageFacts = Object.freeze({ failedUrl: null, loadError: null, crashed: false, zoomPercent: 100 })

/** The security states the navigation policy derives from an address; any other is the certificate's word. */
const ADDRESS_SECURITY: ReadonlySet<string> = new Set(['secure', 'local', 'file', 'notSecureHttp'])

/** Chromium's net error codes are negative; anything else is not a load error. */
const MIN_NET_ERROR = -1000

/**
 * The load-error page for a failed main-frame load with Chromium's `code`, or
 * `null` when none shows (a cancelled load, or a code out of range).
 */
export function loadErrorFor(code: number, userStarted: boolean): LoadErrorPage | null {
  if (!Number.isInteger(code) || code >= 0 || code < MIN_NET_ERROR || !showsLoadErrorPage(code)) return null
  return { code, focus: userStarted ? 'reload' : 'heading' }
}

/** A zoom factor's level in whole percent, inside the zoom steps' range. */
export function clampZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 100
  return Math.min(Math.max(Math.round(percent), ZOOM_MIN_PERCENT), ZOOM_MAX_PERCENT)
}

/** `state` with the page features' facts applied. */
export function decorateTabState(
  state: TabStateEvent,
  facts: PageFacts,
  resolveDomain: RegistrableDomainResolver
): TabStateEvent {
  const zoomed: TabStateEvent = { ...state, zoomPercent: clampZoomPercent(facts.zoomPercent) }
  if (state.erfanaPage === 'certificate') return zoomed
  if (facts.crashed) return { ...zoomed, erfanaPage: 'crashed' }
  if (facts.loadError === null || facts.failedUrl === null) return zoomed
  // The load-error page names the failed address as the bar does: without user info.
  const url = withoutUserInfo(facts.failedUrl).slice(0, BROWSER_URL_MAX_CHARS)
  return {
    ...zoomed,
    committedUrl: url,
    pendingUrl: null,
    origin: originParts(url, resolveDomain),
    security: ADDRESS_SECURITY.has(state.security) ? securityStateOf(url) : state.security,
    erfanaPage: 'loadError',
    loadError: facts.loadError
  }
}

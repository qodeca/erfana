// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The navigation policy for what a tab's page starts (spec 025, 025-FR-005,
 * solution design § 3.4; panel findings S2, S-7), moved out of
 * `BrowserTab.ts`.
 *
 * A link, a script, a form, a redirect or a frame navigation is checked
 * under the `page` source (`browserNavigationPolicy.checkNavigation`) and
 * cancelled when not allowed. A page may reach a served local folder only
 * from a page of that folder: refused here, the page stays where it is,
 * rather than landing on the error page the session filter would leave.
 */
import type { WebContents } from 'electron'
import { logger } from '../LoggingService'
import { checkNavigation, type AppAddresses, type FrameKind } from './browserNavigationPolicy'
import type { TabLocalFiles } from './BrowserTab'

export interface TabNavigationGuardDeps {
  readonly appAddresses: () => AppAddresses
  readonly local?: Pick<TabLocalFiles, 'isLocalAddress' | 'allowsRequest'>
  /** The tab's committed address now, for the page's origin and the served-folder rule. */
  readonly committedUrl: () => string | null
}

/** The page's origin for `url`, or null. */
function originOf(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Check every navigation the page in `contents` starts, for the life of the page. */
export function guardPageNavigation(contents: Pick<WebContents, 'on'>, deps: TabNavigationGuardDeps): void {
  /** A page may reach a served folder only from a page of that folder (S-7). */
  const refusesLocal = (url: string, frame: FrameKind): boolean => {
    const local = deps.local
    if (local === undefined || !local.isLocalAddress(url)) return false
    return !local.allowsRequest({ url, resourceType: frame === 'main' ? 'mainFrame' : 'subFrame', topUrl: deps.committedUrl() })
  }

  const refuseUnlessAllowed = (event: { preventDefault(): void }, url: string, frame: FrameKind): void => {
    const verdict = checkNavigation(url, 'page', frame, deps.appAddresses(), originOf(deps.committedUrl()))
    if (verdict.allowed && !refusesLocal(url, frame)) return
    event.preventDefault()
    if (verdict.allowed) logger.warn('Refused a page navigation to a served local folder', { frame })
    else logger.warn('Refused a page navigation in a browser tab', { frame, reason: verdict.reason })
  }

  contents.on('will-navigate', (details) => {
    refuseUnlessAllowed(details, details.url, 'main')
  })
  contents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame) refuseUnlessAllowed(details, details.url, 'frame')
  })
  contents.on('will-redirect', (details) => {
    refuseUnlessAllowed(details, details.url, details.isMainFrame ? 'main' : 'frame')
  })
}

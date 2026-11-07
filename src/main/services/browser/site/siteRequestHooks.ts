// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser session's request hooks for site behaviour (spec 025,
 * 025-FR-005, 025-FR-022; spec change S-16).
 *
 * A session has exactly one listener per `webRequest` event, so this module
 * owns the three it uses and no other module may set them on a browser
 * session:
 *
 * - `onBeforeSendHeaders` – the private-network rule
 *   (`browserPrivateNetwork.ts`): a refused request is cancelled before a
 *   byte of it is sent. `onBeforeRequest` stays with
 *   `browserAppRequestFilter.ts`.
 * - `onCompleted` and `onErrorOccurred` – tell the site how a request of a
 *   tab ended, so a remembered sign-in is saved only once the site accepted
 *   it (`browserAuth.ts`).
 */
import type { Session } from 'electron'
import { logger } from '../../LoggingService'
import { refusedByPrivateNetworkRule } from './browserPrivateNetwork'

type HookSession = {
  readonly webRequest: Pick<Session['webRequest'], 'onBeforeSendHeaders' | 'onCompleted' | 'onErrorOccurred'>
}

/** Where a finished request of a page goes: `BrowserSite.requestCompleted`. */
export interface SiteRequestSink {
  requestCompleted(contentsId: number, url: string, statusCode: number | null): void
}

interface RequestPage {
  readonly webContents?: { getURL(): string; isDestroyed(): boolean }
}

const installed = new WeakSet<object>()

function topUrlOf(details: RequestPage): string | null {
  const contents = details.webContents
  if (contents === undefined || contents.isDestroyed()) return null
  return contents.getURL()
}

/** Install the hooks on `session` once. */
export function installSiteRequestHooks(session: HookSession, sink: SiteRequestSink): void {
  if (installed.has(session)) return
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const cancel = refusedByPrivateNetworkRule({
      url: details.url,
      resourceType: details.resourceType,
      topUrl: topUrlOf(details),
      initiatorOrigin: (details as { initiatorOrigin?: string }).initiatorOrigin
    })
    if (cancel) logger.warn('Refused a public page request to a local address', { resourceType: details.resourceType })
    callback(cancel ? { cancel: true } : { requestHeaders: details.requestHeaders })
  })
  session.webRequest.onCompleted((details) => {
    if (details.webContentsId !== undefined) sink.requestCompleted(details.webContentsId, details.url, details.statusCode)
  })
  session.webRequest.onErrorOccurred((details) => {
    if (details.webContentsId !== undefined) sink.requestCompleted(details.webContentsId, details.url, null)
  })
  installed.add(session)
}

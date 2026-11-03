// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Refuses every browser-session request to Erfana's own addresses (spec 025,
 * 025-FR-005 rule 3, 025-NFR-001 "load the renderer entry and the dev-server
 * origin").
 *
 * The navigation policy stops a tab or a frame from navigating there; this
 * also stops subresources – a page's `fetch`, an image, a script – before a
 * byte is sent. It is the browser session's `webRequest.onBeforeRequest`, of
 * which a session has exactly one: the `file:` and `erfana-local` refusals of
 * ADR 0012 (commit 11) join this filter rather than install a second one.
 */
import type { Session } from 'electron'
import { logger } from '../LoggingService'
import { isAppAddress, type AppAddresses } from './browserNavigationPolicy'

type FilterSession = { readonly webRequest: Pick<Session['webRequest'], 'onBeforeRequest'> }

const installed = new WeakSet<object>()

/** Install the filter on `session` once; `app` is read per request, so a later change applies. */
export function installAppRequestFilter(session: FilterSession, app: () => AppAddresses): void {
  if (installed.has(session)) return
  session.webRequest.onBeforeRequest((details, callback) => {
    const cancel = isAppAddress(details.url, app())
    if (cancel) logger.warn('Refused a browser request to an Erfana address', { resourceType: details.resourceType })
    callback({ cancel })
  })
  installed.add(session)
}

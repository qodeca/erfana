// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser session's request filter (spec 025, 025-FR-005 rules 1–3,
 * 025-NFR-001 "load the renderer entry and the dev-server origin"; ADR 0012
 * decision 3).
 *
 * The navigation policy stops a tab or a frame from navigating; this also
 * stops subresources – a page's `fetch`, an image, a script – before a byte is
 * sent. It is the browser session's `webRequest.onBeforeRequest`, of which a
 * session has exactly one, so every refusal of that stage lives here:
 *
 * - every `file:` subresource and frame – local files load only through a
 *   served folder (`local/LocalFileServers.ts`) – and every `file:` URL with
 *   a host, which would open a network share, the main frame included (rules
 *   1 and 2). A main-frame load of a plain `file:` URL is the navigation
 *   policy's to refuse (`BrowserTab` never loads one), with the app addresses
 *   below as the backstop; the test hook that proves the IPC gate against a
 *   browser-session view at the renderer entry relies on that load;
 * - Erfana's own addresses (rule 3);
 * - a request to a served local folder that its gate refuses: the
 *   requesting tab's top-level page is not on that folder's server and the
 *   load is not one Erfana armed (rule 1, S-7).
 */
import type { Session } from 'electron'
import { logger } from '../LoggingService'
import { isAppAddress, type AppAddresses } from './browserNavigationPolicy'
import type { LocalGateRequest } from './local/LocalFileServers'

type FilterSession = { readonly webRequest: Pick<Session['webRequest'], 'onBeforeRequest'> }

/** The served local folders' gate (`LocalFileServers.allowsRequest`). */
export interface LocalRequestGate {
  allowsRequest(request: LocalGateRequest): boolean
}

/** The fields of a request the filter reads. */
interface FilterDetails {
  readonly url: string
  readonly resourceType: string
  readonly webContents?: { getURL(): string; isDestroyed(): boolean }
}

const installed = new WeakSet<object>()

function topUrlOf(details: FilterDetails): string | null {
  const contents = details.webContents
  if (contents === undefined || contents.isDestroyed()) return null
  return contents.getURL()
}

/** A `file:` URL with a host (a network share), or a `file:` subresource or frame. */
function refusedFileRequest(details: FilterDetails): boolean {
  if (!/^file:/i.test(details.url)) return false
  if (details.resourceType !== 'mainFrame') return true
  try {
    return new URL(details.url).host !== ''
  } catch {
    return true
  }
}

function refusal(details: FilterDetails, app: AppAddresses, local: LocalRequestGate | undefined): string | null {
  if (refusedFileRequest(details)) return 'Refused a browser request to a file: address'
  if (isAppAddress(details.url, app)) return 'Refused a browser request to an Erfana address'
  if (local !== undefined && !local.allowsRequest({ url: details.url, resourceType: details.resourceType, topUrl: topUrlOf(details) })) {
    return 'Refused a browser request to a served local folder'
  }
  return null
}

/**
 * Install the filter on `session` once; `app` is read per request, so a later
 * change applies. Without `local`, no request to a served folder is checked.
 */
export function installAppRequestFilter(session: FilterSession, app: () => AppAddresses, local?: LocalRequestGate): void {
  if (installed.has(session)) return
  session.webRequest.onBeforeRequest((details, callback) => {
    const refused = refusal(details, app(), local)
    if (refused !== null) logger.warn(refused, { resourceType: details.resourceType })
    callback({ cancel: refused !== null })
  })
  installed.add(session)
}

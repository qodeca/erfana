// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A public page cannot reach this machine or the local network (spec 025,
 * 025-FR-005; solution design § 3.5 `browserPrivateNetwork`, spec change S-16).
 *
 * A request whose target is a loopback, private or other local address
 * (`addressClass.ts`) is refused when the top-level page that caused it is
 * public – the cross-site request forgery a hostile page could aim at a dev
 * server or a router. Allowed:
 *
 * - every main-frame navigation (the user can always open a local address,
 *   and a page that navigates the whole tab leaves itself);
 * - every request of a local or private top-level page, and of a local file
 *   page (`erfana-local:`, `file:`);
 * - a request with no page behind it (Erfana's own fetches in the session).
 *
 * The top-level page is the request's `webContents` address; without one
 * (a service worker) the request's initiator stands in. Classes are read
 * from the address literal only: a public name that resolves to a private
 * address is not caught here (Chromium's own Local Network Access check,
 * whose permission the session denies, is the second line).
 */
import { urlAddressClass } from './addressClass'

export interface PrivateNetworkRequest {
  readonly url: string
  readonly resourceType: string
  /** The top-level page's address, or `null` when no page is known. */
  readonly topUrl: string | null
  readonly initiatorOrigin?: string
}

/** Whether `request` must be refused. */
export function refusedByPrivateNetworkRule(request: PrivateNetworkRequest): boolean {
  if (request.resourceType === 'mainFrame') return false
  const target = urlAddressClass(request.url)
  if (target === null || target === 'public') return false
  const context = webContext(request.topUrl) ?? webContext(request.initiatorOrigin ?? null)
  if (context === null) return false
  return context === 'public'
}

/** `public` or `local` for a web page's address; `null` when it is not a usable context. */
function webContext(url: string | null): 'public' | 'local' | null {
  if (url === null || url === '') return null
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return null
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    // about:blank and friends say nothing; a local file page is local.
    return protocol === 'about:' || protocol === 'data:' || protocol === 'blob:' ? null : 'local'
  }
  const cls = urlAddressClass(url)
  return cls === null ? null : cls === 'public' ? 'public' : 'local'
}

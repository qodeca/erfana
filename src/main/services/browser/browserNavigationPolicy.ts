// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a browser tab may navigate, by who started the navigation (spec 025,
 * 025-FR-002, 025-FR-005; solution design § 3.4; panel finding S2).
 *
 * Every navigation carries a **source**. The user's sources (an address typed
 * in the bar, a history row, a terminal link, …) show a pending address; the
 * `page` source – a script, a link, a form, a redirect – never does, and is
 * never accepted from the renderer: main sets it for what the page itself
 * started. Each source has its own schemes:
 *
 * | Source | Main frame | Frames |
 * |---|---|---|
 * | user sources | `http`, `https` | – |
 * | `page` | `http`, `https` | `http`, `https`, `about:blank`, `about:srcdoc`, own-origin `blob:`, `data:` |
 *
 * Checked first, whatever the source: Erfana's own addresses – the bundled
 * renderer entry, anything under the app's resources folder, and in
 * development the dev-server origin (025-FR-005 rule 3, 025-AC-068). A
 * `file:` URL never loads as such: a `file:` URL with a host is a network path
 * (rule 2), and a local file loads only through its served folder
 * (`local/LocalFileServers.ts`) from the sources in {@link LOCAL_FILE_SOURCES}
 * – `BrowserTab.navigate` answers `local-file` and the caller opens it there.
 */
import { pathToFileURL } from 'node:url'
import type { NavigationSource } from '../../../shared/ipc/browser-tab-schema'

/** Erfana's own addresses, which no browser tab may load (025-FR-005 rule 3). */
export interface AppAddresses {
  /** The bundled renderer entry, `file://…/renderer/index.html`. */
  readonly rendererEntry: string
  /** The app's resources folder (`process.resourcesPath`). */
  readonly resourcesDir: string
  /** The dev-server origin of the app window, in development only; otherwise `null`. */
  devServerOrigin: string | null
}

/** Why a navigation was refused; the first three are `navigate`'s answer codes. */
export type NavigationRefusal = 'scheme' | 'network-path' | 'app-entry' | 'local-file'

export type NavigationVerdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: NavigationRefusal }

/** A navigation of the main frame or of a frame inside the page. */
export type FrameKind = 'main' | 'frame'

const WEB = ['http:', 'https:'] as const

/** Schemes per source and frame kind (`blob:` is further limited to the page's own origin). */
const SOURCE_SCHEMES: Readonly<Record<NavigationSource, Readonly<Record<FrameKind, readonly string[]>>>> = {
  address: { main: WEB, frame: [] },
  history: { main: WEB, frame: [] },
  reload: { main: WEB, frame: [] },
  back: { main: WEB, frame: [] },
  forward: { main: WEB, frame: [] },
  terminalLink: { main: WEB, frame: [] },
  contextMenuLink: { main: WEB, frame: [] },
  // Local files only, through openLocalFile (LOCAL_FILE_SOURCES).
  previewOpen: { main: [], frame: [] },
  page: { main: WEB, frame: [...WEB, 'about:', 'blob:', 'data:'] }
}

/**
 * The sources that may open a local file, through its served folder
 * (design § 3.4): the address bar, a history row and **Open in browser tab**.
 * Reload, Back and Forward of a local entry reload its served address.
 */
export const LOCAL_FILE_SOURCES: ReadonlySet<NavigationSource> = new Set<NavigationSource>(['address', 'history', 'previewOpen'])

/** The `about:` pages a frame may show. */
const FRAME_ABOUT_PAGES = new Set(['about:blank', 'about:srcdoc'])

/** True for a navigation the user started: it shows a pending address (025-FR-002). */
export function isUserStarted(source: NavigationSource): boolean {
  return source !== 'page'
}

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function withoutHashAndQuery(url: URL): string {
  const copy = new URL(url.href)
  copy.hash = ''
  copy.search = ''
  return copy.href
}

/** True when `url` is one of Erfana's own addresses. */
export function isAppAddress(url: string, app: AppAddresses): boolean {
  const parsed = parse(url)
  if (parsed === null) return false
  if (parsed.protocol === 'file:') {
    const entry = parse(app.rendererEntry)
    if (entry !== null && withoutHashAndQuery(parsed).toLowerCase() === withoutHashAndQuery(entry).toLowerCase()) {
      return true
    }
    const resources = pathToFileURL(app.resourcesDir).href.replace(/\/?$/, '/')
    return parsed.href.toLowerCase().startsWith(resources.toLowerCase())
  }
  if (app.devServerOrigin === null) return false
  const dev = parse(app.devServerOrigin)
  return dev !== null && parsed.origin === dev.origin
}

/**
 * May a navigation to `url` from `source` go ahead in a `frame` of a page
 * whose origin is `pageOrigin` (for `blob:` frames)?
 */
export function checkNavigation(
  url: string,
  source: NavigationSource,
  frame: FrameKind,
  app: AppAddresses,
  pageOrigin: string | null = null
): NavigationVerdict {
  const parsed = parse(url)
  if (parsed === null) return { allowed: false, reason: 'scheme' }
  if (isAppAddress(url, app)) return { allowed: false, reason: 'app-entry' }
  if (parsed.protocol === 'file:') {
    return { allowed: false, reason: parsed.host === '' ? 'local-file' : 'network-path' }
  }
  if (!SOURCE_SCHEMES[source][frame].includes(parsed.protocol)) return { allowed: false, reason: 'scheme' }
  if (parsed.protocol === 'about:' && !FRAME_ABOUT_PAGES.has(withoutHashAndQuery(parsed))) {
    return { allowed: false, reason: 'scheme' }
  }
  if (parsed.protocol === 'blob:' && (pageOrigin === null || parsed.origin !== pageOrigin)) {
    return { allowed: false, reason: 'scheme' }
  }
  return { allowed: true }
}

const LOOPBACK_HOST = /^(?:localhost|[^.]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i

/** The address bar's badge for `url` until certificates are tracked (commit 12c). */
export function securityStateOf(url: string | null): 'secure' | 'local' | 'file' | 'notSecureHttp' {
  const parsed = url === null ? null : parse(url)
  if (parsed === null) return 'local'
  if (parsed.protocol === 'https:') return 'secure'
  if (parsed.protocol === 'file:') return 'file'
  if (parsed.protocol === 'http:' && LOOPBACK_HOST.test(parsed.hostname)) return 'local'
  return 'notSecureHttp'
}

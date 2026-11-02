// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { isAppWebContents, type AppWebContentsLike } from './appWebContents'

/**
 * Canonical `file://` URL of the bundled renderer entry point.
 *
 * MUST match `src/main/index.ts`'s production loader
 * (`mainWindow.loadFile(join(__dirname, '../renderer/index.html'))`): both files
 * resolve relative to the same compiled main-process `__dirname`, so the trust
 * gate pins exactly the URL the window actually loads — no other `file://`
 * origin is accepted.
 */
export const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href

/**
 * How strictly a sender URL must match the renderer entry in production.
 *
 * - `exact`: the URL must equal {@link RENDERER_FILE_URL} character for
 *   character. Rejects the screenshot overlay windows, which load the same
 *   entry with a route hash – the per-handler gates rely on that.
 * - `route`: fragment and query are ignored, so the overlay windows pass.
 *
 * In development both reduce to the same rule: the dev-server origin.
 */
type UrlStrictness = 'exact' | 'route'

/**
 * The URL half of every trust decision – never sufficient on its own; each
 * exported predicate also requires {@link isAppWebContents}.
 *
 * Mirrors EXACTLY how `src/main/index.ts` loads the renderer:
 * - Development: only when `is.dev && process.env.ELECTRON_RENDERER_URL` — the
 *   URL's origin must match the electron-vite dev server. (Gating on the same
 *   condition prevents a dev branch from being reachable in a production build.)
 * - Production: the bundled renderer file URL ({@link RENDERER_FILE_URL}); an
 *   arbitrary `file://` URL is NOT accepted. An empty or unparsable URL is not
 *   trusted.
 */
function isRendererUrl(rawUrl: string | undefined, strictness: UrlStrictness): boolean {
  if (!rawUrl) return false

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    try {
      return new URL(rawUrl).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }

  if (strictness === 'exact') return rawUrl === RENDERER_FILE_URL

  try {
    const url = new URL(rawUrl)
    url.hash = ''
    url.search = ''
    return url.href === RENDERER_FILE_URL
  } catch {
    return false
  }
}

/**
 * Shared shape of both event-based predicates: the sending `webContents` is a
 * registered Erfana window, the frame is its top-level frame, and the frame URL
 * is the renderer entry at the given strictness. Identity and URL are both
 * required; neither substitutes for the other.
 */
function isTrustedEvent(
  event: IpcMainEvent | IpcMainInvokeEvent,
  strictness: UrlStrictness
): boolean {
  // `sender` is typed non-optional, but a stand-in event in a test – or a
  // malformed one – may lack it; isAppWebContents refuses a missing value.
  if (!isAppWebContents(event.sender as AppWebContentsLike | undefined)) return false

  const frame = event.senderFrame
  // No frame, or not the top-level frame → reject.
  if (!frame || frame.parent !== null) return false

  return isRendererUrl(frame.url, strictness)
}

/**
 * Verify the IPC request came from the top-level frame of one of Erfana's own
 * windows, at the exact renderer entry URL.
 *
 * Requires all of:
 * - the sending `webContents` is registered in `appWebContents.ts` (identity –
 *   a browser tab that loaded the renderer entry file is not registered);
 * - the sender is the top-level frame (sub-frames are rejected);
 * - the frame URL is the dev-server origin (development) or exactly
 *   {@link RENDERER_FILE_URL} (production – no fragment, no query).
 *
 * Shared by the clipboard, file-reveal, Claude status, screenshot and preview
 * handlers so the trust gate has a single source of truth. Accepts `send`
 * events as well as `invoke` events (preview uses `send` for bounds and
 * visibility).
 */
export function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isTrustedEvent(event, 'exact')
}

/**
 * Route-tolerant variant of {@link isTrustedSender}, used by the process-wide
 * IPC sender gate ({@link file://./registry.ts}).
 *
 * Same identity and top-level-frame requirement, with one deliberate
 * difference: **fragment and query are ignored.** The screenshot overlay windows
 * load the SAME bundled entry with a route hash
 * (`ScreenshotOverlayWindow.loadOverlay` → `loadFile(index.html, { hash })`),
 * and one of the channels they use is global (`logging:log`, sent from
 * `src/preload/screenshotOverlay.ts`). Exact-URL equality would silently drop
 * those messages. The overlays are registered app windows, so they pass the
 * identity check too.
 *
 * The stricter {@link isTrustedSender} stays in place inside the handlers that
 * already call it, so this is defence in depth, not a relaxation of any
 * existing gate.
 */
export function isTrustedAppSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isTrustedEvent(event, 'route')
}

/**
 * Identity-plus-URL decision for callers that get a `webContents` and a URL
 * instead of an IPC event (session permission handlers).
 *
 * `webContents` must be a registered Erfana window, and `rawUrl` must pass the
 * same route-tolerant rule as {@link isTrustedAppSender}. A missing
 * `webContents` (Electron passes `null` for some permission checks) or an empty
 * or unparsable URL is untrusted.
 */
export function isTrustedAppWebContents(
  webContents: Pick<AppWebContentsLike, 'id' | 'isDestroyed'> | null | undefined,
  rawUrl: string | undefined
): boolean {
  return isAppWebContents(webContents) && isRendererUrl(rawUrl, 'route')
}

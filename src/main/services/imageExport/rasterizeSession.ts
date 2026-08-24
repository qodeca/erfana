// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Locking down the session the rasterize harness runs in.
 *
 * The harness is a real Chromium page that is handed bytes from the user's
 * project — including SVG, which is a document format with a script model.
 * Everything here exists so that page can do exactly one thing (decode an
 * image into a canvas) and nothing else.
 *
 * ## Order is part of the control
 *
 * A fresh partition inherits NONE of the app's hardening, and the page's own
 * `<meta>` CSP only takes effect once the document has been parsed — which is
 * already too late for the document request itself. So the request filter and
 * the permission handlers are installed on the session BEFORE the window that
 * uses it exists, and long before anything is loaded. `installOrder` in the
 * unit tests pins that sequence, because getting it wrong produces a control
 * that looks present and does nothing.
 *
 * ## The allow-list is a directory prefix, on purpose
 *
 * In production the emitted JS chunk name is decided by the bundler, so
 * pinning one exact file URL would break the harness on the next build — in a
 * window with no visible UI, which is the worst place to discover it. The
 * filter therefore admits any `file://` URL inside the packaged
 * `out/renderer/` directory and refuses everything else, network included.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 * @see src/main/services/screenshot/ScreenshotOverlayWindow.ts for the
 *      window-hardening precedent this mirrors
 */
import { session, type BrowserWindow, type Session, type WebPreferences } from 'electron'
import { resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { is } from '@electron-toolkit/utils'
import { logger } from '../LoggingService'
import { redactPath } from '../../utils/redactUserInput'

/**
 * In-memory partition (no `persist:` prefix): nothing it holds is ever written
 * to disk.
 *
 * Its LIFETIME is the process, not the window — `session.fromPartition` returns
 * the SAME Session object on every call, and `prepareRasterizeSession` runs once
 * per export — so it is shared by every export the app performs. That is what
 * makes the hardening below idempotent by necessity rather than by taste.
 */
export const IMAGE_EXPORT_PARTITION = 'image-export'

/** The harness page, relative to the renderer output directory. */
export const HARNESS_PAGE = 'imageExport.html'

/**
 * Dev-server path prefixes the harness legitimately fetches: Vite's own
 * client, the TypeScript source it transforms on the fly, its dependency
 * pre-bundle, and the React refresh runtime the HTML plugin injects into every
 * page it serves. Production needs none of these.
 */
const DEV_PATH_PREFIXES = [
  '/@vite/',
  '/@id/',
  '/@fs/',
  '/@react-refresh',
  '/src/',
  '/node_modules/.vite/'
]

/** What `isAllowedHarnessUrl` needs to know about where the harness lives. */
export interface HarnessUrlContext {
  /** `ELECTRON_RENDERER_URL` when the dev server is the source, else `null`. */
  devServerUrl: string | null
  /** Absolute path of the built renderer directory (`out/renderer`). */
  rendererDir: string
}

/** `true` when `target` is `dir` itself or something beneath it. */
function isInsideDirectory(target: string, dir: string): boolean {
  const resolvedTarget = resolve(target)
  const resolvedDir = resolve(dir)
  return resolvedTarget === resolvedDir || resolvedTarget.startsWith(resolvedDir + sep)
}

/** Convert a `file://` URL to a path, ignoring any query or fragment. */
function fileUrlToPath(url: URL): string | null {
  try {
    const clean = new URL(url.href)
    clean.search = ''
    clean.hash = ''
    return fileURLToPath(clean)
  } catch {
    return null
  }
}

/**
 * May the harness session fetch this URL?
 *
 * Pure, so the allow-list is unit-testable without a real session.
 *
 * @param url - The request URL as Chromium reports it.
 * @param context - Where the harness is being served from.
 * @returns `true` to let the request through.
 *
 * @example
 * ```ts
 * isAllowedHarnessUrl('https://example.com/x.js', ctx) // false
 * ```
 */
export function isAllowedHarnessUrl(url: string, context: HarnessUrlContext): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (context.devServerUrl) {
    let devUrl: URL
    try {
      devUrl = new URL(context.devServerUrl)
    } catch {
      return false
    }
    if (parsed.origin !== devUrl.origin) return false
    if (parsed.pathname === `/${HARNESS_PAGE}`) return true
    return DEV_PATH_PREFIXES.some(prefix => parsed.pathname.startsWith(prefix))
  }

  if (parsed.protocol !== 'file:') return false
  const path = fileUrlToPath(parsed)
  return path !== null && isInsideDirectory(path, context.rendererDir)
}

/** Build the allow-list context from the running environment. */
export function harnessUrlContext(rendererDir: string): HarnessUrlContext {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return {
    devServerUrl: is.dev && devUrl ? devUrl : null,
    rendererDir
  }
}

/**
 * Create the harness session and install every session-level control on it.
 *
 * MUST be called before the `BrowserWindow` that uses this partition is
 * constructed.
 *
 * @param rendererDir - Absolute path of the built renderer directory.
 * @returns The prepared session.
 */
export function prepareRasterizeSession(rendererDir: string): Session {
  const rasterizeSession = session.fromPartition(IMAGE_EXPORT_PARTITION)
  const context = harnessUrlContext(rendererDir)

  rasterizeSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (isAllowedHarnessUrl(details.url, context)) {
      callback({ cancel: false })
      return
    }
    logger.warn('Blocked request from the image-export harness', {
      url: redactPath(details.url),
      resourceType: details.resourceType
    })
    callback({ cancel: true })
  })

  // The harness needs no capability at all: no camera, no clipboard read, no
  // notifications, no geolocation. Deny both the ask and the silent check.
  rasterizeSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  rasterizeSession.setPermissionCheckHandler(() => false)

  return rasterizeSession
}

/**
 * `webPreferences` for the harness window — the union of the screenshot
 * overlay's and the PDF render window's hardening.
 *
 * @param preloadPath - Absolute path to `out/preload/imageExport.js`.
 * @param token - Per-export nonce, passed through `additionalArguments`.
 */
export function buildHarnessWebPreferences(preloadPath: string, token: string): WebPreferences {
  return {
    preload: preloadPath,
    additionalArguments: [`--image-export-token=${token}`],
    partition: IMAGE_EXPORT_PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webgl: false,
    enableWebSQL: false,
    spellcheck: false,
    offscreen: false
  }
}

/**
 * Install the per-`webContents` controls the session cannot cover.
 *
 * `setWindowOpenHandler` denies popups outright — the main window's handler at
 * `index.ts` routes to `shell.openExternal`, which is per-`webContents` and
 * therefore does not apply here. `will-navigate` pins the harness to the one
 * URL it was loaded with.
 */
export function hardenRasterizeWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url !== current) {
      logger.warn('Blocked image-export harness navigation', {
        from: redactPath(current),
        to: redactPath(url)
      })
      event.preventDefault()
    }
  })
}

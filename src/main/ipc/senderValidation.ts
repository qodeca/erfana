// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'

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
 * Verify the IPC request came from the app's own top-level renderer frame.
 *
 * The predicate mirrors EXACTLY how `src/main/index.ts` loads the renderer:
 * - Development: only when `is.dev && process.env.ELECTRON_RENDERER_URL` — the
 *   sender origin must match the electron-vite dev server. (Gating on the same
 *   condition prevents a dev branch from being reachable in a production build.)
 * - Production: the sender URL must equal the exact bundled renderer file URL
 *   ({@link RENDERER_FILE_URL}); an arbitrary `file://` URL is NOT accepted.
 *
 * Sub-frames (iframes) and any other origin are rejected. Returns `true` when
 * the sender is trusted.
 *
 * Shared by the clipboard and file-reveal IPC handlers so the trust gate has a
 * single source of truth.
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame

  // No frame, or not the top-level frame → reject.
  if (!frame || frame.parent !== null) {
    return false
  }

  const senderUrl = frame.url

  // Development: must match the electron-vite renderer dev server origin, and
  // ONLY when index.ts would actually load it (is.dev && ELECTRON_RENDERER_URL).
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    try {
      return new URL(senderUrl).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }

  // Production: pin to the exact bundled renderer file URL index.ts loads.
  return senderUrl === RENDERER_FILE_URL
}

/**
 * Route-tolerant variant of {@link isTrustedSender}, used by the process-wide
 * IPC sender gate ({@link file://./registry.ts}).
 *
 * Identical trust decision, with two deliberate differences:
 *
 * - **Fragment and query are ignored.** The screenshot overlay windows load the
 *   SAME bundled entry with a route hash
 *   (`ScreenshotOverlayWindow.loadOverlay` → `loadFile(index.html, { hash })`),
 *   and one of the channels they use is global (`logging:log`, sent from
 *   `src/preload/screenshotOverlay.ts`). Exact-URL equality would silently drop
 *   those messages. Stripping hash/query admits our own renderer entry on any
 *   route and nothing else — the preview page is served over `erfana-preview://`
 *   and can never match a `file://` URL whatever its fragment.
 * - **Accepts `send` events too**, because the gate wraps `ipcMain.on` as well
 *   as `ipcMain.handle`.
 *
 * The stricter {@link isTrustedSender} is unchanged and stays in place inside
 * the handlers that already call it, so this is defence in depth, not a
 * relaxation of any existing gate.
 */
export function isTrustedAppSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame

  if (!frame || frame.parent !== null) {
    return false
  }

  const senderUrl = frame.url

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    try {
      return new URL(senderUrl).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }

  try {
    const url = new URL(senderUrl)
    url.hash = ''
    url.search = ''
    return url.href === RENDERER_FILE_URL
  } catch {
    return false
  }
}

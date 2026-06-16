// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { IpcMainInvokeEvent } from 'electron'
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

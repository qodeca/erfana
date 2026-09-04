// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview IPC sender-validation predicate (Issue #74, work item 42).
 *
 * The preview feature's own copy of the trust gate every preview R→M handler
 * runs before acting (design §4.3). It is byte-for-byte the same predicate as
 * `claude-status-handlers.ts#isTrustedSender` (and `clipboard-handlers.ts`),
 * placed in its own module so the later de-duplication tracked as debt item 31
 * is a file move plus import edits, not a rewrite of a security predicate.
 *
 *  - **Sub-frames rejected**: only the top-level frame (`frame.parent === null`)
 *    is trusted.
 *  - **Development**: trusted only when `is.dev && ELECTRON_RENDERER_URL`, and
 *    the sender origin matches the electron-vite dev server origin.
 *  - **Production**: the sender URL must equal the exact bundled renderer file
 *    URL — pinned the same way `src/main/index.ts` loads it.
 *
 * @see docs/designs/sd-074-html-preview.md §4.3, §7.1 debt item 31
 * @see src/main/ipc/claude-status-handlers.ts (the mirrored predicate)
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

/**
 * Canonical `file://` URL of the bundled renderer entry point. MUST match
 * `src/main/index.ts`'s production loader so the gate pins exactly the URL the
 * window actually loads (mirrors `claude-status-handlers.ts`). Relative to the
 * main bundle's `__dirname` (`out/main` at runtime).
 */
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href

/**
 * Verify a preview IPC request came from the app's own top-level renderer frame.
 * Sub-frames and any other origin are rejected. Accepts both invoke and send
 * event shapes, since preview uses `send` for bounds/visibility.
 */
export function isTrustedPreviewSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
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

  return senderUrl === RENDERER_FILE_URL
}

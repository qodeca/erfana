// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview IPC sender-validation predicate (Issue #74, work item 42).
 *
 * The trust gate every preview R→M handler runs before acting (design §4.3).
 * It used to be a byte-for-byte copy of the URL-only predicate; spec 025
 * commit 1 (025-NFR-001) moved every gate to `webContents` identity, so it now
 * delegates to the shared {@link isTrustedSender} rather than keep a copy of a
 * security predicate that could drift. The module stays so the preview
 * handlers keep one import, and debt item 31's de-duplication is done.
 *
 *  - **Identity**: the sending `webContents` must be a registered Erfana window
 *    (`src/main/ipc/appWebContents.ts`).
 *  - **Sub-frames rejected**: only the top-level frame is trusted.
 *  - **Development**: the sender origin matches the electron-vite dev server
 *    origin, only when `is.dev && ELECTRON_RENDERER_URL`.
 *  - **Production**: the sender URL must equal the exact bundled renderer file
 *    URL (no fragment, no query – the screenshot overlays stay refused).
 *
 * @see docs/designs/html-preview/sd-074-html-preview.md §4.3, §7.1 debt item 31
 * @see src/main/ipc/senderValidation.ts (the shared predicate)
 */
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { isTrustedSender } from '../senderValidation'

/**
 * Verify a preview IPC request came from the top-level frame of one of
 * Erfana's own windows at the exact renderer URL. Accepts both invoke and send
 * event shapes, since preview uses `send` for bounds/visibility.
 */
export function isTrustedPreviewSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  return isTrustedSender(event)
}

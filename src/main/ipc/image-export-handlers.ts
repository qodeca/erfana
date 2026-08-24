// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * IPC handler for image export (issue #73).
 *
 * One channel, `image-export:run`, and three gates in a fixed order before any
 * work starts:
 *
 * 1. **`isTrustedSender`** — the request must come from the app's own
 *    top-level frame. This runs FIRST, before the payload is even looked at,
 *    so an untrusted sender cannot reach the Zod parser, the filesystem or the
 *    save dialog. Note what it does NOT do: in dev it accepts any URL on the
 *    dev-server origin, which the hidden rasterize harness shares. What keeps
 *    the harness off this channel is its own preload — three verbs, no `run`,
 *    and no `ipcRenderer` handle to build one with.
 * 2. **Zod** — `.strict()`, with the supported-extension allow-list expressed
 *    in the request schema itself.
 * 3. **The parent window** — resolved from `event.sender`, never sent by the
 *    renderer, so the native save dialog is modal to the window that asked for
 *    it rather than floating free or parented to a hidden window.
 *
 * Nothing raw ever crosses back: the service returns a code plus its mapped
 * user-facing message, and this handler's own catch-all does the same.
 *
 * @see src/shared/ipc/image-export-schema.ts for the contract
 * @see src/main/services/imageExport/ImageExportService.ts for the pipeline
 */
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ErrorCode, ERROR_MESSAGES } from '../../shared/errors'
import { IMAGE_EXPORT_CHANNELS } from '../../shared/ipc/image-export-channels'
import {
  ImageExportRequestSchema,
  type ImageExportErrorCode,
  type ImageExportResponse
} from '../../shared/ipc/image-export-schema'
import { imageExportService } from '../services/imageExport/ImageExportService'
import { logger } from '../services/LoggingService'
import { redactPath, redactedLogError } from '../utils/redactUserInput'
import { isTrustedSender } from './senderValidation'

/** Build the single failure shape this channel returns. */
function refuse(code: ImageExportErrorCode): ImageExportResponse {
  return { success: false, errorCode: code, error: ERROR_MESSAGES[code] }
}

/**
 * Register the image-export IPC handler.
 *
 * Channels:
 * - `image-export:run` — export the image at `filePath` as PNG, as PDF, or to
 *   the clipboard.
 *
 * Call once during app startup from `src/main/index.ts`.
 */
export function registerImageExportHandlers(): void {
  ipcMain.handle(
    IMAGE_EXPORT_CHANNELS.RUN,
    async (event: IpcMainInvokeEvent, request: unknown): Promise<ImageExportResponse> => {
      if (!isTrustedSender(event)) {
        logger.warn('Rejected image-export:run from untrusted sender', {
          // A packaged build's own renderer URL is a `file:///Users/<name>/...`
          // path, so even the REJECTED sender's URL is redacted before logging.
          url: redactPath(event.senderFrame?.url ?? '')
        })
        return refuse(ErrorCode.IMAGE_EXPORT_INVALID_REQUEST)
      }

      const parsed = ImageExportRequestSchema.safeParse(request)
      if (!parsed.success) {
        // The issue message describes the SHAPE that failed, never the value,
        // so no user path reaches the log here.
        logger.warn('Rejected image-export:run with invalid payload', {
          issue: parsed.error.issues[0]?.message
        })
        return refuse(ErrorCode.IMAGE_EXPORT_INVALID_REQUEST)
      }

      try {
        return await imageExportService.run({
          filePath: parsed.data.filePath,
          target: parsed.data.target,
          parentWindow: BrowserWindow.fromWebContents(event.sender)
        })
      } catch (error) {
        // The service is written not to throw; this is the belt-and-braces
        // branch that keeps a raw Node error (which may carry an absolute
        // path) from crossing IPC.
        logger.error('Image export handler error', redactedLogError(error))
        return refuse(ErrorCode.IMAGE_EXPORT_FAILED)
      }
    }
  )

  logger.info('✅ Image export IPC handlers registered')
}

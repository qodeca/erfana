// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * IPC handler for "Open in default browser" (issue #124, design part 4 §4.1).
 *
 * One channel, `browser:openFile`, modelled on `image-export:run`. Gates, in
 * this order, before anything reaches the filesystem or a process:
 *
 * 1. the process-wide `isTrustedAppSender` gate in `registry.ts`;
 * 2. **`isTrustedSender`** – the exact bundled renderer URL (or the dev-server
 *    origin), top-level frame only. It runs BEFORE the payload is looked at, so
 *    an untrusted sender never reaches the Zod parser. A previewed page cannot
 *    get here: it is served over `erfana-preview://`, and its preload exposes
 *    no bridge to this channel;
 * 3. **Zod** – `{ filePath }`, `.strict()`.
 *
 * Then `BrowserLaunchService` runs the project and real-path checks against the
 * project path main owns. Nothing raw crosses back: every refusal is a code
 * plus its `ERROR_MESSAGES` text, and this handler's catch-all does the same.
 *
 * @see src/shared/ipc/browser-schema.ts for the contract
 * @see src/main/services/browserLaunch/BrowserLaunchService.ts for the checks
 */
import type { IpcMainInvokeEvent } from 'electron'
import { ErrorCode, ERROR_MESSAGES } from '../../shared/errors'
import { BROWSER_CHANNELS } from '../../shared/ipc/browser-channels'
import {
  BrowserOpenFileRequestSchema,
  type BrowserOpenErrorCode,
  type BrowserOpenFileResponse
} from '../../shared/ipc/browser-schema'
import { browserLaunchService } from '../services/browserLaunch/BrowserLaunchService'
import { fileService } from '../services/FileService'
import { logger } from '../services/LoggingService'
import { redactPath, redactedLogError } from '../utils/redactUserInput'
import { isTrustedSender } from './senderValidation'
import { registerHandle } from './registry'

/** Build the single failure shape this channel returns. */
function refuse(code: BrowserOpenErrorCode): BrowserOpenFileResponse {
  return { success: false, errorCode: code, error: ERROR_MESSAGES[code] }
}

/**
 * Register the open-in-browser IPC handler.
 *
 * Channels:
 * - `browser:openFile` – open the `.html` / `.htm` file at `filePath`, inside
 *   the open project, in the default browser.
 *
 * Call once during app startup from `src/main/index.ts`.
 */
export function registerBrowserHandlers(): void {
  registerHandle(
    BROWSER_CHANNELS.OPEN_FILE,
    async (event: IpcMainInvokeEvent, request: unknown): Promise<BrowserOpenFileResponse> => {
      if (!isTrustedSender(event)) {
        logger.warn('Rejected browser:openFile from untrusted sender', {
          // A preview page's URL names a file in the user's project, and a
          // packaged renderer's is a `file:///Users/<name>/...` path.
          url: redactPath(event.senderFrame?.url ?? '')
        })
        return refuse(ErrorCode.OPEN_IN_BROWSER_INVALID_REQUEST)
      }

      const parsed = BrowserOpenFileRequestSchema.safeParse(request)
      if (!parsed.success) {
        // The issue message describes the SHAPE that failed, never the value.
        logger.warn('Rejected browser:openFile with invalid payload', {
          issue: parsed.error.issues[0]?.message
        })
        return refuse(ErrorCode.OPEN_IN_BROWSER_INVALID_REQUEST)
      }

      try {
        return await browserLaunchService.openFile(
          parsed.data.filePath,
          fileService.getProjectPath()
        )
      } catch (error) {
        // The service is written not to throw; this keeps a raw Node error
        // (which may carry an absolute path) from crossing IPC.
        logger.error('Open in browser handler error', redactedLogError(error))
        return refuse(ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED)
      }
    }
  )

  logger.info('✅ Browser IPC handlers registered')
}

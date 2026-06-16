// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain, clipboard } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { logger } from '../services/LoggingService'
import { CLIPBOARD_CHANNELS } from '../../shared/ipc/clipboard-channels'
import {
  ClipboardWriteTextSchema,
  CLIPBOARD_MAX_TEXT_LENGTH
} from '../../shared/ipc/clipboard-schema'
import { isTrustedSender } from './senderValidation'

/**
 * Clipboard IPC Handlers
 *
 * Backs the central text-clipboard service (issue #203) with Electron's native
 * `clipboard` module in the main process. The renderer is sandboxed, so the
 * `clipboard` module is not usable in preload — every read/write must cross IPC.
 *
 * Security:
 * - Sender validation: each handler verifies the request originated from the
 *   app's own top-level frame (dev renderer URL or the bundled file:// index)
 *   before touching the OS clipboard. On mismatch it returns the safe value
 *   (`''`/`false`) and logs a warning — never reads/writes the clipboard.
 * - Payload bound: `writeText` is Zod-validated (`z.string().max(N)`); oversize
 *   or non-string payloads are rejected with `false`.
 *
 * @see docs/design/issue-203-clipboard-service.md §1–§3
 */

/**
 * Register the clipboard IPC handlers (read/write plain text).
 *
 * Both handlers are asynchronous (`ipcMain.handle`). Call once during app
 * startup from `src/main/index.ts`.
 */
export function registerClipboardHandlers(): void {
  /**
   * Read plain text from the OS clipboard.
   *
   * @returns Promise<string> — the clipboard text, or `''` on failure / untrusted sender
   */
  ipcMain.handle(CLIPBOARD_CHANNELS.readText, async (event: IpcMainInvokeEvent): Promise<string> => {
    if (!isTrustedSender(event)) {
      logger.warn('Rejected clipboard:readText from untrusted sender', {
        url: event.senderFrame?.url
      })
      return ''
    }

    try {
      // Cap the returned text at the same bound as the write path so a hostile
      // or accidental multi-MB clipboard payload can't be funnelled into the
      // renderer unbounded.
      return clipboard.readText().slice(0, CLIPBOARD_MAX_TEXT_LENGTH)
    } catch (error) {
      logger.error(
        'Failed to read text from clipboard',
        error instanceof Error ? error : undefined
      )
      return ''
    }
  })

  /**
   * Write plain text to the OS clipboard.
   *
   * @param text - text to write (Zod-validated: string, max length bounded)
   * @returns Promise<boolean> — `true` on success, `false` on failure / reject / untrusted sender
   */
  ipcMain.handle(
    CLIPBOARD_CHANNELS.writeText,
    async (event: IpcMainInvokeEvent, text: unknown): Promise<boolean> => {
      if (!isTrustedSender(event)) {
        logger.warn('Rejected clipboard:writeText from untrusted sender', {
          url: event.senderFrame?.url
        })
        return false
      }

      const parsed = ClipboardWriteTextSchema.safeParse(text)
      if (!parsed.success) {
        logger.warn('Rejected clipboard:writeText with invalid payload', {
          error: parsed.error.message
        })
        return false
      }

      try {
        clipboard.writeText(parsed.data)
        return true
      } catch (error) {
        logger.error(
          'Failed to write text to clipboard',
          error instanceof Error ? error : undefined
        )
        return false
      }
    }
  )

  logger.info('✅ Clipboard IPC handlers registered')
}

import { ipcMain, clipboard } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { logger } from '../services/LoggingService'
import { CLIPBOARD_CHANNELS } from '../../shared/ipc/clipboard-channels'
import {
  ClipboardWriteTextSchema,
  CLIPBOARD_MAX_TEXT_LENGTH
} from '../../shared/ipc/clipboard-schema'

/**
 * Canonical `file://` URL of the bundled renderer entry point.
 *
 * MUST match `src/main/index.ts`'s production loader
 * (`mainWindow.loadFile(join(__dirname, '../renderer/index.html'))`): both files
 * resolve relative to the same compiled main-process `__dirname`, so the trust
 * gate pins exactly the URL the window actually loads — no other `file://`
 * origin is accepted.
 */
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href

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
 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
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

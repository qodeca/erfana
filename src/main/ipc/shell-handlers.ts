// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain, shell } from 'electron'
import { logger } from '../services/LoggingService'

/**
 * Shell IPC Handlers
 *
 * Handles shell operations that require main process privileges.
 * Used for opening external URLs, files, and folders in the system's default application.
 *
 * Security: All URLs are validated by Electron's shell.openExternal before opening.
 */

export function registerShellHandlers(): void {
  /**
   * Open a URL in the system's default browser
   *
   * @param url - URL to open (http://, https://, mailto:, tel:, etc.)
   * @returns Promise<void> - Resolves when the URL is opened
   *
   * Security Notes:
   * - Electron's shell.openExternal validates the URL protocol
   * - Dangerous protocols (javascript:, data:, vbscript:) should be blocked in renderer
   * - The renderer must validate URLs before calling this IPC handler
   */
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    logger.debug('Opening external URL', { url })

    try {
      await shell.openExternal(url)
      logger.info('External URL opened successfully', { url })
    } catch (error) {
      logger.error('Failed to open external URL', error instanceof Error ? error : undefined, {
        url
      })
      throw error
    }
  })

  logger.info('✅ Shell IPC handlers registered')
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * IPC handlers for quit confirmation
 *
 * Handles communication between main and renderer process for quit confirmation.
 * Main process sends quit request, renderer responds with proceed/cancel.
 *
 * @see Issue #64 - quit confirmation feature
 */

import { ipcMain } from 'electron'
import { QuitConfirmResponseSchema } from '../../shared/ipc/quit-schema'
import { logger } from '../services/LoggingService'

/**
 * Register quit confirmation IPC handlers
 *
 * @param onResponse - Callback when renderer responds to quit request
 */
export function registerQuitHandlers(onResponse: (proceed: boolean) => void): void {
  /**
   * Receive quit confirmation response from renderer
   * One-way channel from renderer
   */
  ipcMain.on('quit:confirmResponse', (_event, payload: unknown) => {
    // Validate response payload
    const result = QuitConfirmResponseSchema.safeParse(payload)
    if (!result.success) {
      logger.error('Invalid quit response from renderer', undefined, {
        issues: result.error.issues
      })
      // On invalid response, allow quit to prevent user being stuck
      onResponse(true)
      return
    }

    logger.info('Quit response received', { proceed: result.data.proceed })
    onResponse(result.data.proceed)
  })
}

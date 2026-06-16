// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * IPC Broadcast Utility
 *
 * Provides a centralized function for broadcasting IPC events to all renderer windows.
 * Handles edge cases like destroyed windows and shutdown scenarios.
 *
 * @module main/utils/ipcBroadcast
 */

import { BrowserWindow } from 'electron'
import { logger } from '../services/LoggingService'

/**
 * Broadcast an event to all renderer windows.
 *
 * Safely handles:
 * - Destroyed windows (skipped)
 * - Errors during shutdown (suppressed)
 * - Windows being destroyed mid-broadcast
 *
 * @param channel - IPC channel name
 * @param payload - Data to send
 */
export function broadcastToAllWindows<T>(channel: string, payload: T): void {
  const windows = BrowserWindow.getAllWindows()

  for (const window of windows) {
    if (window.isDestroyed()) continue

    try {
      window.webContents.send(channel, payload)
    } catch (error) {
      // Suppress errors during shutdown (window destroyed between check and send)
      if (error instanceof Error && !error.message.includes('destroyed')) {
        logger.debug('IPC broadcast error (suppressed)', { channel, error: error.message })
      }
    }
  }
}

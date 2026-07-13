// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { app, ipcMain, shell } from 'electron'
import { SYSTEM_CHANNELS } from '../../shared/ipc/system-channels'
import { isTrustedSender } from './senderValidation'
import { logger } from '../services/LoggingService'

/**
 * System IPC Handlers
 *
 * OS-integration actions requested by the renderer's screen-recording
 * permission flow. Both handlers are sender-gated (`isTrustedSender`) because
 * a renderer-triggerable app restart would otherwise be a boot-loop DoS lever.
 *
 * The deep-link URL is a fixed constant with no renderer-supplied input, so
 * there is no arbitrary-URL / protocol-injection surface.
 *
 * Verified working anchor on macOS 13–15; the legacy
 * `com.apple.preference.security` scheme is preserved on macOS 26 (reconfirm
 * during QA).
 */
const SCREEN_RECORDING_PANE =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export function registerSystemHandlers(): void {
  ipcMain.handle(SYSTEM_CHANNELS.OPEN_SCREEN_RECORDING_SETTINGS, async (event) => {
    if (!isTrustedSender(event)) {
      logger.warn('Rejected system:openScreenRecordingSettings from untrusted sender')
      return
    }
    // Screen Recording is a macOS-only TCC concept; no-op elsewhere.
    if (process.platform !== 'darwin') return
    await shell.openExternal(SCREEN_RECORDING_PANE)
  })

  ipcMain.handle(SYSTEM_CHANNELS.RELAUNCH_APP, (event) => {
    if (!isTrustedSender(event)) {
      logger.warn('Rejected system:relaunchApp from untrusted sender')
      return
    }
    logger.info('Relaunching app on user request (permission flow)')
    app.relaunch()
    // app.quit() (NOT app.exit) so `before-quit` runs: releases the project
    // lock and disposes watchers/PTYs before the process ends.
    app.quit()
  })

  logger.info('✅ System IPC handlers registered')
}

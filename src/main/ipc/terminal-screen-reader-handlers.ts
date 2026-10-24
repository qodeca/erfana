// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal screen-reader support IPC (lens review [23]).
 *
 * xterm.js draws on a canvas (WebGL), so a screen reader sees no text unless
 * the terminal runs in `screenReaderMode`. The renderer's "Auto" setting turns
 * that mode on when the OS reports assistive technology, and this module is
 * where it learns that:
 *
 * - `terminal:getScreenReaderSupport` – payload-free, sender-gated (the stricter
 *   `isTrustedSender`, on top of the registry's process-wide gate). Answers
 *   `{ enabled }` from `app.isAccessibilitySupportEnabled()`.
 * - `terminal:screenReaderSupportChanged` – pushed to every window when
 *   Electron emits `accessibility-support-changed`.
 *
 * Electron reports this on macOS and Windows only. Elsewhere the answer is
 * always `false`, and the user turns the mode on in Settings.
 *
 * Chromium also counts some non-screen-reader tools that use the accessibility
 * APIs (for example certain password managers or window managers) as
 * assistive technology, so "Auto" can turn the mode on without a screen
 * reader. The cost is a little extra work per output batch; the Settings
 * override exists for that case.
 */
import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { TERMINAL_CHANNELS, TERMINAL_EVENTS } from '../../shared/ipc/terminal-channels'
import type { ScreenReaderSupport } from '../../shared/ipc/terminal-schema'
import { isTrustedSender } from './senderValidation'
import { logger } from '../services/LoggingService'
import { registerHandle } from './registry'

/** The app listener this module added, so a re-registration (HMR) replaces it */
let supportListener: ((event: unknown, enabled: boolean) => void) | null = null

/**
 * Read the OS state. Any failure (an Electron without the API, a platform
 * where it throws) reads as "no screen reader", so the terminal falls back to
 * its normal renderer rather than failing to start.
 *
 * @returns Whether Chromium's accessibility support is on
 */
export function readScreenReaderSupport(): boolean {
  try {
    return typeof app.isAccessibilitySupportEnabled === 'function' && app.isAccessibilitySupportEnabled() === true
  } catch (error) {
    logger.warn('Could not read accessibility support state', {
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

/** Push the new state to every open window */
function broadcast(payload: ScreenReaderSupport): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(TERMINAL_EVENTS.screenReaderSupportChanged, payload)
    }
  }
}

/**
 * Register the screen-reader support channel and the OS change listener.
 *
 * @example
 * ```ts
 * registerTerminalHandlers(projectService.session)
 * registerTerminalScreenReaderHandlers()
 * ```
 */
export function registerTerminalScreenReaderHandlers(): void {
  registerHandle(TERMINAL_CHANNELS.getScreenReaderSupport, (event: IpcMainInvokeEvent): ScreenReaderSupport => {
    if (!isTrustedSender(event)) {
      logger.warn('Rejected terminal:getScreenReaderSupport from untrusted sender')
      return { enabled: false }
    }
    return { enabled: readScreenReaderSupport() }
  })

  if (supportListener) app.removeListener('accessibility-support-changed', supportListener)
  supportListener = (_event, enabled) => {
    logger.info('Accessibility support changed', { enabled })
    broadcast({ enabled: enabled === true })
  }
  app.on('accessibility-support-changed', supportListener)
}

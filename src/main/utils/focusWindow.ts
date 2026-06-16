// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Platform-adaptive window focusing utilities
 *
 * Handles platform-specific quirks for bringing windows to foreground.
 * Used by ProjectLockService to focus existing instance when duplicate open attempted.
 *
 * @see ProjectLockService.ts - uses focusWindow for focus requests
 * @see Spec #010 - Multi-instance support specification
 */
import { BrowserWindow, app } from 'electron'

/**
 * Platform-adaptive window focusing.
 * Handles platform-specific quirks for bringing windows to foreground.
 *
 * Platform behaviors:
 * - macOS: Dock bounce for attention if not focused
 * - Windows: setAlwaysOnTop trick to bypass focus stealing prevention
 * - Linux: Best effort focus (Wayland may ignore this)
 *
 * @param window - The BrowserWindow to focus
 * @returns true if focus was successful, false if window is invalid/destroyed
 */
export async function focusWindow(window: BrowserWindow): Promise<boolean> {
  if (!window || window.isDestroyed()) {
    return false
  }

  try {
    // Restore if minimized
    if (window.isMinimized()) {
      window.restore()
    }

    // Show if hidden
    if (!window.isVisible()) {
      window.show()
    }

    // Platform-specific focusing
    if (process.platform === 'darwin') {
      // macOS: Dock bounce for attention if not focused
      if (!window.isFocused()) {
        app.dock?.bounce('informational')
      }
      window.focus()
    } else if (process.platform === 'win32') {
      // Windows: setAlwaysOnTop trick to bypass focus stealing prevention
      // Windows prevents apps from stealing focus, so we temporarily
      // set the window as always-on-top, focus it, then restore
      const wasOnTop = window.isAlwaysOnTop()
      if (!wasOnTop) {
        window.setAlwaysOnTop(true)
        window.focus()
        window.setAlwaysOnTop(false)
      } else {
        window.focus()
      }
    } else {
      // Linux: Best effort focus (Wayland may ignore this due to security model)
      window.focus()
    }

    return true
  } catch {
    return false
  }
}

/**
 * Finds a window by its webContents ID.
 *
 * @param webContentsId - The ID of the webContents to find
 * @returns The BrowserWindow if found and not destroyed, undefined otherwise
 */
export function findWindowByWebContentsId(webContentsId: number): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(
    (w) => !w.isDestroyed() && w.webContents.id === webContentsId
  )
}

/**
 * Gets the main application window (first non-destroyed window).
 *
 * In Erfana, there's typically only one main window per instance.
 *
 * @returns The main BrowserWindow if exists and not destroyed, undefined otherwise
 */
export function getMainWindow(): BrowserWindow | undefined {
  const windows = BrowserWindow.getAllWindows()
  return windows.find((w) => !w.isDestroyed())
}

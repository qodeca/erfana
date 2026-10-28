// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { BrowserWindow, Menu, app, MenuItemConstructorOptions } from 'electron'
import { spawnNewInstance } from './utils/spawnNewInstance'
import { PREVIEW } from '../shared/constants'

/**
 * Routes a zoom request to a previewed page when one has keyboard focus.
 *
 * A late-bound holder rather than a constructor argument because the menu is
 * installed before the preview graph is built, and it must survive the graph
 * being torn down and rebuilt by the feature's global off-switch.
 *
 * Returns `true` when a preview took the zoom, so the menu falls through to the
 * host window only when no preview was focused.
 */
let previewZoomHandler: ((step: number) => Promise<boolean>) | null = null

/**
 * Register (or clear, with `null`) the preview zoom route.
 *
 * WHY THE MENU CANNOT KEEP `role: 'zoomIn'`. A menu accelerator is global to the
 * app, so with a previewed page focused Cmd/Ctrl-+ would fire the role AND be
 * forwarded to the page through `before-input-event` — zooming the host window
 * and the page at once, in opposite directions as far as the reader is
 * concerned. The roles are therefore replaced by handlers that ask the preview
 * first.
 */
export function setPreviewZoomHandler(
  handler: ((step: number) => Promise<boolean>) | null
): void {
  previewZoomHandler = handler
}

/** Apply a zoom step to the focused window's own web contents. */
function zoomFocusedWindow(step: number): void {
  const wc = BrowserWindow.getFocusedWindow()?.webContents
  if (wc === undefined) {
    return
  }
  const next =
    step === 0
      ? 0
      : Math.min(PREVIEW.MAX_ZOOM_LEVEL, Math.max(PREVIEW.MIN_ZOOM_LEVEL, wc.getZoomLevel() + step))
  wc.setZoomLevel(next)
}

/** A View-menu zoom item that prefers a focused preview over the window. */
function zoomItem(label: string, accelerator: string, step: number): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => {
      void (async () => {
        if (previewZoomHandler !== null && (await previewZoomHandler(step))) {
          return
        }
        zoomFocusedWindow(step)
      })()
    }
  }
}

/**
 * Creates the application menu with Edit roles for native clipboard support.
 *
 * Electron requires Menu.setApplicationMenu() with Edit roles for native
 * clipboard shortcuts (Cmd+C/V, Ctrl+C/V) to work in standard HTML elements
 * like <textarea> and <input>.
 *
 * Note: xterm.js terminals use custom handlers (useTerminalClipboard) and
 * Monaco Editor has built-in handling - neither requires this menu.
 *
 * @returns The configured application menu
 */
export function createApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: (): void => {
            spawnNewInstance()
          }
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          : [])
      ]
    },
    // Edit menu (CRITICAL for clipboard in standard HTML elements)
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        zoomItem('Actual Size', 'CommandOrControl+0', 0),
        zoomItem('Zoom In', 'CommandOrControl+Plus', 1),
        zoomItem('Zoom Out', 'CommandOrControl+-', -1),
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }])
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * macOS application-menu roles performed from page focus (spec 025,
 * 025-FR-047; ADR 0011 decision 12; panel finding X2).
 *
 * A page view ignores the application menu's shortcuts while it has focus
 * (`setIgnoreMenuShortcuts(true)`), so Erfana's File, View and Window
 * shortcuts never fire from a page and the page receives them instead. The
 * Edit roles and the operating system's application keys would be lost with
 * them, so the key router performs those itself:
 *
 * - Cmd+C, V, X, A, Z and Shift+Z run the matching editing command in the page.
 * - Cmd+Q takes the app's normal quit path (`app.quit()`, the same call the
 *   menu's quit role makes, so the quit confirmation still runs); Cmd+H hides
 *   Erfana, Cmd+Option+H hides the other applications and Cmd+M minimises the
 *   tab's window.
 */
import type { MacEditRole, ReservedOsAction } from '../../../../shared/browser/browserKeys'

/** The editing commands of a page's `webContents`. */
export type EditableContents = Readonly<
  Record<'copy' | 'paste' | 'cut' | 'selectAll' | 'undo' | 'redo', () => void>
>

/** Run the Edit-menu role `role` in the page. */
export function performMacEditRole(contents: EditableContents, role: MacEditRole): void {
  contents[role]()
}

/** Where the macOS application keys act. */
export interface MacAppKeyTargets {
  /** The app's graceful quit path. */
  quit(): void
  hide(): void
  hideOthers(): void
  /** Minimise the window the tab lives in. */
  minimize(): void
}

/**
 * Perform an operating-system key from page focus. Only the macOS
 * application keys are Erfana's to perform; `closeWindow` and `system` belong
 * to the operating system and are never routed here.
 *
 * @returns whether the key was performed
 */
export function performMacAppKey(targets: MacAppKeyTargets, action: ReservedOsAction): boolean {
  switch (action) {
    case 'quit':
      targets.quit()
      return true
    case 'hide':
      targets.hide()
      return true
    case 'hideOthers':
      targets.hideOthers()
      return true
    case 'minimize':
      targets.minimize()
      return true
    default:
      return false
  }
}

/** The Electron calls behind {@link MacAppKeyTargets}, for the window `windowId`. */
export interface MacAppKeyElectron {
  readonly app: { quit(): void; hide(): void }
  /** `Menu.sendActionToFirstResponder` (macOS only). */
  readonly sendActionToFirstResponder: (action: string) => void
  /** The tab's window, or `null` when it is gone. */
  readonly window: () => { minimize(): void; isDestroyed(): boolean } | null
}

/** Build the macOS application-key targets from Electron's calls. */
export function electronMacAppKeys(electron: MacAppKeyElectron): MacAppKeyTargets {
  return {
    quit: () => electron.app.quit(),
    hide: () => electron.app.hide(),
    // The selector the menu's `hideOthers` role sends.
    hideOthers: () => electron.sendActionToFirstResponder('hideOtherApplications:'),
    minimize: () => {
      const window = electron.window()
      if (window !== null && !window.isDestroyed()) window.minimize()
    }
  }
}

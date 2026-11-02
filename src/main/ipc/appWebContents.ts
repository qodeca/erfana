// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The set of Erfana's own window `webContents` – the identity half of every IPC
 * trust gate (spec 025, 025-NFR-001; solution design 001 § 13 commit 1).
 *
 * WHY IDENTITY AND NOT URL. Until now every trust predicate decided by the
 * sender's URL alone: the bundled `file://…/renderer/index.html`, or the
 * dev-server origin. A URL says what a frame loaded, not who created it. A
 * browser tab that navigated to the renderer entry file would carry exactly
 * that URL and pass every gate. A `webContents` id is minted by Electron when
 * the window is created, so only code in the main process that created the
 * window can put it in this set – a page cannot.
 *
 * The URL check stays in each predicate as an extra condition (a registered
 * window that navigated away is still refused); this set never replaces it.
 *
 * Register a window here only when its renderer is Erfana's own UI and talks
 * to the global `ipcMain`. Hidden helper windows that load user content (PDF
 * export, the image-export harness) and the preview page views are NOT
 * registered: they must never pass the app gate.
 */

/**
 * The part of `Electron.WebContents` this module touches. Structural so the
 * unit tests can pass a small fake instead of a real `webContents`.
 */
export interface AppWebContentsLike {
  readonly id: number
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}

/** Ids of live Erfana window `webContents`. */
const appWebContentsIds = new Set<number>()

/**
 * Add a window's `webContents` to the trusted set. The id is dropped again on
 * the `webContents` 'destroyed' event, so a closed window stops being trusted
 * without the caller having to remember to unregister it.
 *
 * Registering the same `webContents` twice is a no-op (one listener, one
 * entry). A `webContents` that is already destroyed is not added.
 */
export function registerAppWebContents(webContents: AppWebContentsLike): void {
  if (webContents.isDestroyed()) return
  // Read once: the id must be the one removed later, whatever happens to the
  // object by the time 'destroyed' fires.
  const id = webContents.id
  if (appWebContentsIds.has(id)) return
  appWebContentsIds.add(id)
  webContents.once('destroyed', () => {
    appWebContentsIds.delete(id)
  })
}

/**
 * True when `webContents` is one of Erfana's own live windows. A missing
 * (`undefined` / `null`) or destroyed `webContents` is never trusted.
 */
export function isAppWebContents(
  webContents: Pick<AppWebContentsLike, 'id' | 'isDestroyed'> | null | undefined
): boolean {
  if (!webContents) return false
  // Membership first: an unregistered object is refused without calling into
  // it, so a malformed sender is a refusal rather than a TypeError.
  return appWebContentsIds.has(webContents.id) && !webContents.isDestroyed()
}

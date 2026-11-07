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
 * export, the image-export harness), the preview page views and the browser
 * page views are NOT registered: they must never pass the app gate.
 *
 * WINDOW KINDS (spec 025, solution design § 8, panel findings S7 and A16).
 * Each id is recorded with the kind of window it belongs to, and the IPC
 * registry checks every channel against that kind's allow-list
 * (`channelAllowList.ts`): a browser popup host may reach only the
 * `browser-tab:popup*` channels, the screenshot overlay only what it uses.
 * The kind is fixed by the code that created the window; nothing a renderer
 * sends can change it.
 */

/** The kinds of Erfana window whose renderer may use global IPC. */
export const APP_WINDOW_KINDS = ['main', 'screenshotOverlay', 'browserPopup'] as const
export type AppWindowKind = (typeof APP_WINDOW_KINDS)[number]

/**
 * The part of `Electron.WebContents` this module touches. Structural so the
 * unit tests can pass a small fake instead of a real `webContents`.
 */
export interface AppWebContentsLike {
  readonly id: number
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}

/** Ids of live Erfana window `webContents`, each with its window kind. */
const appWebContentsKinds = new Map<number, AppWindowKind>()

/**
 * Add a window's `webContents` to the trusted set as a window of `kind`. The
 * id is dropped again on the `webContents` 'destroyed' event, so a closed
 * window stops being trusted without the caller having to remember to
 * unregister it.
 *
 * Registering the same `webContents` twice is a no-op (one listener, one
 * entry, the first kind kept – a kind never changes after creation). A
 * `webContents` that is already destroyed is not added.
 */
export function registerAppWebContents(webContents: AppWebContentsLike, kind: AppWindowKind): void {
  if (webContents.isDestroyed()) return
  // Read once: the id must be the one removed later, whatever happens to the
  // object by the time 'destroyed' fires.
  const id = webContents.id
  if (appWebContentsKinds.has(id)) return
  appWebContentsKinds.set(id, kind)
  webContents.once('destroyed', () => {
    appWebContentsKinds.delete(id)
  })
}

/**
 * True when `webContents` is one of Erfana's own live windows. A missing
 * (`undefined` / `null`) or destroyed `webContents` is never trusted.
 */
export function isAppWebContents(
  webContents: Pick<AppWebContentsLike, 'id' | 'isDestroyed'> | null | undefined
): boolean {
  return appWebContentsKind(webContents) !== null
}

/**
 * The window kind of one of Erfana's own live windows, or `null` for anything
 * else – a missing, destroyed or never-registered `webContents`.
 */
export function appWebContentsKind(
  webContents: Pick<AppWebContentsLike, 'id' | 'isDestroyed'> | null | undefined
): AppWindowKind | null {
  if (!webContents) return null
  // Membership first: an unregistered object is refused without calling into
  // it, so a malformed sender is a refusal rather than a TypeError.
  const kind = appWebContentsKinds.get(webContents.id)
  if (kind === undefined) return null
  return webContents.isDestroyed() ? null : kind
}

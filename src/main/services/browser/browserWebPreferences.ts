// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The only construction site of a browser page view's `WebPreferences`
 * (spec 025, 025-NFR-001; solution design § 3.2; spec change S-3).
 *
 * Every security-relevant key is pinned on a frozen literal, so a review reads
 * the whole isolation posture in one place and a change is a diff. The
 * constructed value is compared with the literal by
 * `browserWebPreferences.test.ts`: {@link buildBrowserWebPreferences} adds the
 * session and nothing else, so a key slipped in at the construction site fails
 * that test.
 *
 * There is **no `preload`** and no `enableBlinkFeatures` key: the page runs no
 * Erfana code and reaches no IPC (025-NFR-001). `devTools` is on for
 * 025-FR-013. Spell check is off on Linux, which has no OS checker (S-4), so
 * the literal comes in two variants that differ in that one key.
 */
import type { Session, WebPreferences } from 'electron'

/** The 025-NFR-001 keys plus the S-3 additions, spell check on. */
export const BROWSER_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  navigateOnDragDrop: false,
  safeDialogs: true,
  devTools: true,
  disableHtmlFullscreenWindowResize: true,
  focusOnNavigation: false,
  autoplayPolicy: 'document-user-activation-required',
  backgroundThrottling: true,
  images: true,
  javascript: true,
  spellcheck: true
} as const)

/** {@link BROWSER_WEB_PREFERENCES} for Linux: spell check off (S-4). */
export const BROWSER_WEB_PREFERENCES_LINUX = Object.freeze({
  ...BROWSER_WEB_PREFERENCES,
  spellcheck: false
} as const)

/** The pinned literal for `platform`. */
export function browserWebPreferencesFor(
  platform: NodeJS.Platform
): typeof BROWSER_WEB_PREFERENCES | typeof BROWSER_WEB_PREFERENCES_LINUX {
  return platform === 'linux' ? BROWSER_WEB_PREFERENCES_LINUX : BROWSER_WEB_PREFERENCES
}

/** The `WebPreferences` of a browser page view in `session`: the pinned literal plus the session. */
export function buildBrowserWebPreferences(session: Session, platform: NodeJS.Platform): WebPreferences {
  return { ...browserWebPreferencesFor(platform), session }
}

/**
 * The `WebContentsView` options around a page-opened `webContents` (a
 * `window.open` popup, or a `target=_blank` page Erfana adopts as a tab).
 *
 * Electron applies a view's `webPreferences` to an existing `webContents` it
 * wraps (`WebContents::CreateFromWebPreferences` → `SetFromDictionary`), and
 * that call **resets every key to Electron's default first**. A view built
 * with `{ webContents }` alone therefore throws away the frozen settings the
 * window-open handler gave the page: `safeDialogs` falls back to `false`,
 * `autoplayPolicy` to `no-user-gesture-required` and
 * `disableHtmlFullscreenWindowResize` to `false`. Passing the pinned literal
 * again keeps them. The session is not given: an existing `webContents` keeps
 * its own (the opener's).
 *
 * @param contents - The page-opened `webContents`
 * @param platform - The OS (spell check is off on Linux, S-4)
 * @returns The options for `new WebContentsView(…)`
 */
export function adoptedBrowserViewOptions<T>(
  contents: T,
  platform: NodeJS.Platform
): { webContents: T; webPreferences: WebPreferences } {
  return { webContents: contents, webPreferences: { ...browserWebPreferencesFor(platform) } }
}

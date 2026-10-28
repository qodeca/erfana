// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview session policy (Issue #74, work item 21; design §1.2).
 *
 * The single construction site for a preview view's `WebPreferences`, and the
 * runtime hardening of its session. Every security-relevant preference is pinned
 * EXPLICITLY on a frozen literal, so a review reads the whole isolation posture
 * in one place and a regression is a diff, not a silent default flip.
 *
 * The frozen literal is asserted against the CONSTRUCTED value (not against
 * itself): the only build site is `buildPreviewWebPreferences(session)`, whose
 * sole runtime addition is `session`, so a test that omits `session` and
 * compares to `PREVIEW_WEB_PREFERENCES` fails the instant a key is added at the
 * construction site (NEW-2). `preload` is DELIBERATELY absent — asserted by the
 * KEY not being present, never by a value.
 *
 * Two variants, chosen by `htmlPreview.comments.enabled` when the view is
 * built (docs/designs/comments/html-preview-comments.md §3 "Feature flag", §4.2; ADR
 * 0005): flag off is today's literal exactly; flag on differs in TWO keys.
 * `nodeIntegrationInSubFrames: true` gives frames no Node at all under
 * `sandbox: true` – it makes Electron run the (sandboxed, isolated) preload in
 * every sub-frame, which the comment overlay needs to capture tokens, draw
 * pins and swallow clicks inside same-project frames. `additionalArguments`
 * carries {@link PREVIEW_COMMENTS_ARGUMENT}, the preload's only signal to
 * install the overlay at all: without it the preload is today's link and CSP
 * reporter and nothing more, so the flag is a kill switch. The frozen-literal
 * test pins both variants.
 *
 * `hardenPreviewSession` denies every permission, blocks downloads and narrows
 * WebRTC local-IP exposure. It does NOT touch response headers: the CSP has a
 * single owner, the protocol handler's `buildResponseHeaders` (design §2.5,
 * round-4 option b). Re-asserting a CSP here would be a second, hostless owner
 * that could drift out of sync.
 */

import { randomUUID } from 'node:crypto'
import type { Session, WebContents, WebPreferences } from 'electron'

/**
 * Every security-relevant `WebPreferences` value, pinned.
 *
 * `preload` is deliberately NOT here. It is environment-dependent — `__dirname`
 * is `out/main` in a build and the source directory under Vitest — so baking a
 * path into a frozen module-level literal would make a pure constant depend on
 * the build layout. It is supplied per call by {@link buildPreviewWebPreferences}
 * from a path the composition root has resolved and existence-checked
 * (sd-074b §5.2).
 */
export const PREVIEW_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  enableBlinkFeatures: '',
  devTools: false,
  spellcheck: false,
  images: true,
  javascript: true,
  backgroundThrottling: true
} as const)

/**
 * The renderer argument that tells the preview preload to install the comment
 * overlay (`process.argv` in the sandboxed preload). The preload inlines the
 * same string (`src/preload/previewPageComments/constants.ts`); a drift test
 * pins the two together.
 */
export const PREVIEW_COMMENTS_ARGUMENT = '--erfana-hpc'

/**
 * The pinned preferences with HTML Preview comments on: {@link
 * PREVIEW_WEB_PREFERENCES} with `nodeIntegrationInSubFrames: true`, the
 * {@link PREVIEW_COMMENTS_ARGUMENT} renderer argument and every other key
 * unchanged (SEC-22). Sandboxed, so frames run the preload, not Node.
 */
export const PREVIEW_WEB_PREFERENCES_WITH_COMMENTS = Object.freeze({
  ...PREVIEW_WEB_PREFERENCES,
  nodeIntegrationInSubFrames: true,
  additionalArguments: Object.freeze([PREVIEW_COMMENTS_ARGUMENT] as const)
} as const)

/** Per-view choices for {@link buildPreviewWebPreferences}. */
export interface PreviewWebPreferenceOptions {
  /** `htmlPreview.comments.enabled`, read when the view is built. */
  readonly comments?: boolean
}

/**
 * Whether HTML Preview comments are on for a view about to be built. Unwired,
 * or a settings read that throws, counts as off: the safe side is today's preview.
 */
export function commentsFlagOf(comments: { isEnabled(): boolean } | undefined): boolean {
  if (comments === undefined) return false
  try {
    return comments.isEnabled()
  } catch {
    return false
  }
}

/**
 * The ONLY construction site for preview `WebPreferences`.
 *
 * @param session - The sealed partition (design §1.2).
 * @param preloadPath - Absolute path to the built `previewPage.js`. Omitted or
 * `null` means no preload at all, which is a working preview with inert links —
 * the deliberate degradation when the bundle is missing, rather than a crash.
 * @param options - `comments: true` runs the preload in sub-frames too and
 * tells it to install the comment overlay.
 */
export function buildPreviewWebPreferences(
  session: Session,
  preloadPath?: string | null,
  options: PreviewWebPreferenceOptions = {}
): WebPreferences {
  const base: WebPreferences =
    options.comments === true
      ? {
          ...PREVIEW_WEB_PREFERENCES_WITH_COMMENTS,
          // A fresh array: Electron is handed nothing it could share with the frozen literal.
          additionalArguments: [...PREVIEW_WEB_PREFERENCES_WITH_COMMENTS.additionalArguments],
          session
        }
      : { ...PREVIEW_WEB_PREFERENCES, session }
  return preloadPath ? { ...base, preload: preloadPath } : base
}

/**
 * A fresh in-memory partition name (no `persist:` prefix ⇒ `storagePath === null`,
 * design §1.2 storage table). Each preview gets its own so two previews cannot
 * share cache, cookies or any residual state.
 */
export function nextPartitionName(): string {
  return `erfana-preview-${randomUUID()}`
}
// A name is minted only when `PreviewSessionFactory` has no purged partition to
// reuse: Electron cannot destroy a session, and every new name costs handles for
// the life of the process (measured on Windows, 2026-09-03: ~16 per partition).

/**
 * Harden a preview session and its WebContents:
 *   - deny EVERY permission request and check (media, geolocation, clipboard, …),
 *   - prevent any download from starting,
 *   - narrow WebRTC to `disable_non_proxied_udp` (a LOCAL-IP exposure policy —
 *     see design §2.8 risk 3 for what it does and does not achieve).
 *
 * `webContents` is required because `setWebRTCIPHandlingPolicy` lives on
 * `WebContents`, not `Session` (`electron.d.ts:17712`); the design one-liner
 * signature omitted it. Never touches response headers (§1.2).
 *
 * @returns a disposer that resets the handlers and removes the download listener.
 */
export function hardenPreviewSession(session: Session, webContents: WebContents): () => void {
  // Deny every permission — request path (async grants) and check path (sync probes).
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)

  // Block downloads before they start.
  const onWillDownload = (event: Electron.Event): void => {
    event.preventDefault()
  }
  session.on('will-download', onWillDownload)

  // Narrow WebRTC local-IP exposure.
  webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')

  return () => {
    session.setPermissionRequestHandler(null)
    session.setPermissionCheckHandler(null)
    session.removeListener('will-download', onWillDownload)
  }
}

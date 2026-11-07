// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview URL scheme registration (Issue #74, work item 9).
 *
 * `erfana-preview://<opaque-root-token>/<path>` is the ONLY way local files
 * reach the sealed preview page. The scheme must be registered as privileged
 * BEFORE `app.whenReady()` (Electron requires `registerSchemesAsPrivileged`
 * pre-ready, and honours only one call), so this module only names the scheme
 * and its privileges; `registerAppSchemes()` registers it together with the
 * built-in browser's `erfana-local` (design §2.5, §7 item 48; spec 025 ADR 0012).
 */

/**
 * The custom scheme host-of-a-token contract. Lowercase because Chromium
 * canonicalises URL hosts to lowercase, and the token is 32 lowercase hex
 * chars precisely so it round-trips (design §2.1–2.3).
 */
export const PREVIEW_SCHEME = 'erfana-preview'

/**
 * The preview scheme's privileges. Registered by `registerAppSchemes()`
 * (`src/main/services/appSchemes.ts`) in the app's single
 * `registerSchemesAsPrivileged` call, before `app.whenReady()`.
 *
 * Privilege rationale (design §2.5):
 * - `standard`: authority component ⇒ relative URLs resolve (AC6 depends on it).
 * - `secure`: secure context; scheme subresources are not mixed content beside
 *   `https:` assets.
 * - `supportFetchAPI` + `corsEnabled`: the document lives at an opaque origin,
 *   so every fetch, module script and `@font-face` load is cross-origin.
 * - `bypassCSP: false`: bypassing would defeat the embedder's CSP.
 * - `allowServiceWorkers: false`: no persistent, interceptive storage.
 * - `stream: false`: no `Range`/206 in v1; Electron will not synthesise it.
 */
export const PREVIEW_SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  bypassCSP: false,
  allowServiceWorkers: false,
  stream: false
} as const)

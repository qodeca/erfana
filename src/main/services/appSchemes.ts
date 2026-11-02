// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The app's one privileged-scheme registration (spec 025 ADR 0012 decision 2).
 *
 * Electron's `protocol.registerSchemesAsPrivileged` must run before
 * `app.whenReady()` and can be called only once, so every custom scheme the
 * app serves is listed here, in one call:
 *
 * - `erfana-preview` – the HTML Preview's sealed pages, unchanged
 *   (`preview/previewScheme.ts` holds the rationale for its privileges);
 * - `erfana-local` – local files in the built-in browser, `standard` and
 *   `secure` only (`browser/browserLocalScheme.ts`).
 */
import { protocol } from 'electron'
import { PREVIEW_SCHEME, PREVIEW_SCHEME_PRIVILEGES } from './preview/previewScheme'
import { BROWSER_LOCAL_SCHEME, BROWSER_LOCAL_SCHEME_PRIVILEGES } from './browser/browserLocalScheme'

/** Every privileged scheme, in registration order. Frozen so no caller can add one. */
export const APP_PRIVILEGED_SCHEMES = Object.freeze([
  Object.freeze({ scheme: PREVIEW_SCHEME, privileges: PREVIEW_SCHEME_PRIVILEGES }),
  Object.freeze({ scheme: BROWSER_LOCAL_SCHEME, privileges: BROWSER_LOCAL_SCHEME_PRIVILEGES })
])

/** Register every privileged scheme. Must run once, before `app.whenReady()`. */
export function registerAppSchemes(): void {
  // Copies: Electron receives plain objects, the frozen list stays the record
  protocol.registerSchemesAsPrivileged(
    APP_PRIVILEGED_SCHEMES.map(({ scheme, privileges }) => ({ scheme, privileges: { ...privileges } }))
  )
}

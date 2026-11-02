// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `erfana-local:` scheme – the only way a built-in browser tab loads a
 * local file (spec 025, ADR 0012).
 *
 * Commit 4 of the solution design registers the scheme as privileged and makes
 * it dead everywhere it must never work: Erfana's own session answers every
 * `erfana-local:` request with 403. The real handler goes on browser sessions
 * only, through `ses.protocol.handle`, when local files land (commit 11).
 */
import type { Session } from 'electron'
import { logger } from '../LoggingService'

/** Lowercase: Chromium canonicalises scheme names to lowercase. */
export const BROWSER_LOCAL_SCHEME = 'erfana-local'

/**
 * ADR 0012 decision 2: `standard` (an authority, so relative URLs resolve and
 * each folder host is its own origin) and `secure` (a secure context) – and
 * nothing else. No `supportFetchAPI`, `corsEnabled`, `allowServiceWorkers`,
 * `bypassCSP` or `stream`: a local page must not read files by script.
 */
export const BROWSER_LOCAL_SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true
} as const)

/** HTTP status every refused `erfana-local:` request gets. */
const REFUSED_STATUS = 403

/** The part of a `Session` this module touches. */
export interface LocalSchemeRefusalTarget {
  readonly protocol: Pick<Session['protocol'], 'handle'>
}

/**
 * Answer every `erfana-local:` request in `ses` with 403. For sessions that
 * are not browser sessions – Erfana's own default session first of all – so a
 * page there that names the scheme gets a refusal, never a file.
 */
export function refuseLocalScheme(ses: LocalSchemeRefusalTarget): void {
  ses.protocol.handle(BROWSER_LOCAL_SCHEME, () => {
    logger.warn('Refused an erfana-local request outside a browser session')
    return new Response(null, { status: REFUSED_STATUS })
  })
}

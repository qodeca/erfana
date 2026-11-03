// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * **Clear browsing data** and **Forget this project's browser data** (spec
 * 025, 025-FR-023; ADR 0009 decisions 11 and 12).
 *
 * Clear removes what the user ticked, for one project's session only:
 *
 * | Kind | Steps |
 * |---|---|
 * | `cookies` (Cookies and other site data) | cookies, local storage, IndexedDB, service workers, Cache Storage, file systems and WebSQL of the session; the address history (025-FR-063) |
 * | `cache` (Cached files) | the HTTP cache |
 * | `permissions` (Site permissions, certificate exceptions and pop-up exceptions) | saved permissions; certificate exceptions |
 * | `credentials` (Saved sign-in credentials) | saved sign-ins; the in-memory sign-in cache |
 * | `captures` (Captures) | `.erfana/browser/captures/`, through the delete re-guard |
 *
 * Each kind runs as one step under {@link CLEAR_STEP_TIMEOUT_MS} (10 s);
 * a step that times out or fails is reported – the toast names the kind and
 * the reason – and the kinds that were not ticked are never touched. Open
 * connections are closed after every Clear, so the next load meets the
 * server afresh (certificate exceptions and sign-ins included).
 *
 * Forget clears every storage of the session, Erfana's in-memory decisions
 * for the project and its connections – each step bounded the same way, a
 * failure logged and passed over – then deletes `.erfana/browser/` through
 * `BrowserProfileService.deleteBrowserData`, which re-guards every level and
 * defers on Windows what the running session holds open.
 */
import type { ClearDataCategory } from '../../../../shared/ipc/browser-tab-page-schema'
import { TimeoutError, withTimeout } from '../../../utils/withTimeout'
import { logger } from '../../LoggingService'

/** Each clearing step stops after this long (025-FR-023). */
export const CLEAR_STEP_TIMEOUT_MS = 10_000

/**
 * What **Cookies and other site data** removes from the session. Every
 * storage Electron's `clearStorageData` names except the shader cache, which
 * holds compiled GPU programs, not site data.
 */
export const SITE_DATA_STORAGES = Object.freeze([
  'cookies',
  'localstorage',
  'indexdb',
  'serviceworkers',
  'cachestorage',
  'filesystem',
  'websql'
] as const)

/** The part of an Electron `Session` clearing needs. */
export interface ClearableSession {
  clearStorageData(options?: { storages?: Array<(typeof SITE_DATA_STORAGES)[number]> }): Promise<void>
  clearCache(): Promise<void>
  clearAuthCache(): Promise<void>
  closeAllConnections(): Promise<void>
}

/** One project's data, as the clearing steps reach it. */
export interface ClearTarget {
  readonly session: ClearableSession
  clearHistory(): Promise<void>
  clearPermissions(): Promise<void>
  clearCertificates(): Promise<void>
  clearCredentials(): Promise<void>
  deleteCaptures(): Promise<unknown>
}

/** A ticked kind whose step did not finish. */
export interface ClearFailure {
  readonly category: ClearDataCategory
  readonly reason: 'timeout' | 'failed'
}

/** Kinds in the dialog's order, so failures are reported in that order. */
const CATEGORY_ORDER: readonly ClearDataCategory[] = ['cookies', 'cache', 'permissions', 'credentials', 'captures']

/** The step for one kind. */
function stepFor(category: ClearDataCategory, target: ClearTarget): () => Promise<unknown> {
  switch (category) {
    case 'cookies':
      return () =>
        Promise.all([target.session.clearStorageData({ storages: [...SITE_DATA_STORAGES] }), target.clearHistory()])
    case 'cache':
      return () => target.session.clearCache()
    case 'permissions':
      return () => Promise.all([target.clearPermissions(), target.clearCertificates()])
    case 'credentials':
      return () => Promise.all([target.clearCredentials(), target.session.clearAuthCache()])
    case 'captures':
      return () => target.deleteCaptures()
  }
}

/**
 * Run `step` under the step timeout.
 *
 * @returns `null` when it finished, else why not
 */
export async function runStep(what: string, step: () => Promise<unknown>, timeoutMs = CLEAR_STEP_TIMEOUT_MS): Promise<ClearFailure['reason'] | null> {
  try {
    await withTimeout(Promise.resolve().then(step), timeoutMs, what)
    return null
  } catch (error) {
    const reason = error instanceof TimeoutError ? 'timeout' : 'failed'
    logger.warn('A browser data clearing step did not finish', { step: what, reason })
    return reason
  }
}

/**
 * Clear the ticked kinds of `target`; the steps run side by side.
 *
 * @returns the ticked kinds that timed out or failed, in the dialog's order
 */
export async function clearBrowsingData(
  categories: ReadonlySet<ClearDataCategory>,
  target: ClearTarget,
  timeoutMs = CLEAR_STEP_TIMEOUT_MS
): Promise<ClearFailure[]> {
  const ticked = CATEGORY_ORDER.filter((c) => categories.has(c))
  const reasons = await Promise.all(ticked.map((c) => runStep(c, stepFor(c, target), timeoutMs)))
  await runStep('connections', () => target.session.closeAllConnections(), timeoutMs)
  return ticked.flatMap((category, i) => {
    const reason = reasons[i]
    return reason === null ? [] : [{ category, reason }]
  })
}

/**
 * Forget's clearing half: every storage of the session, the HTTP and sign-in
 * caches, Erfana's decisions for the project and the open connections. A step
 * that does not finish is logged and passed over – the folder delete that
 * follows removes what it left on disk.
 */
export async function clearForForget(target: ClearTarget, timeoutMs = CLEAR_STEP_TIMEOUT_MS): Promise<void> {
  await Promise.all([
    runStep('forget: storage', () => target.session.clearStorageData(), timeoutMs),
    runStep('forget: cache', () => target.session.clearCache(), timeoutMs),
    runStep('forget: sign-ins', () => Promise.all([target.session.clearAuthCache(), target.clearCredentials()]), timeoutMs),
    runStep('forget: decisions', () => Promise.all([target.clearPermissions(), target.clearCertificates()]), timeoutMs)
  ])
  await runStep('forget: connections', () => target.session.closeAllConnections(), timeoutMs)
}

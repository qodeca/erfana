// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview storage seal (Issue #74, work item 22; design §1.2).
 *
 * `assertSealed` is a tripwire, not the seal itself: the real seal is the opaque
 * origin from `sandbox allow-scripts` in the CSP, under which storage APIs throw
 * or are unavailable. This assertion pins the second layer — the in-memory
 * partition — so a session accidentally built with a `persist:` partition (which
 * would have a non-null `storagePath`) fails LOUDLY at wiring time instead of
 * silently persisting cache and cookies across previews.
 *
 * `purge` is belt-and-braces before an Erfana-driven reload (the approve path)
 * and the ONLY barrier when a partition is handed to the next preview
 * (`PreviewSessionFactory` recycles partition names, because Electron cannot
 * destroy a session and every new name costs handles for life). The opaque
 * origin seals script-visible storage; the purge covers what it does not: the
 * HTTP cookie jar, the cache, the auth cache, the host-resolver cache, the V8
 * code caches, and every warm socket/TLS connection (`closeAllConnections`).
 * HSTS state cannot be cleared per session and is recorded as accepted in
 * docs/security.md. It is NOT the seal (§1.2 table).
 *
 * The storages are named one by one ({@link PURGED_STORAGES}) rather than
 * cleared with the no-argument form, because on Windows (Electron 39) clearing
 * the `shadercache` of a preview partition never completes inside the app —
 * every other type settles in milliseconds, probed per type on 2026-09-04. The
 * shader cache holds compiled GPU programs, not page data, so leaving it out
 * loses nothing the seal is for, and the purge can finally settle instead of
 * hitting its timeout on every close and approval.
 */

import type { Session } from 'electron'
import { AppError, ErrorCode } from '../../../shared/errors'

/**
 * Assert a preview session is an in-memory, non-persistent partition.
 *
 * @throws AppError(UNKNOWN_ERROR) if `storagePath` is non-null or the partition
 *   reports itself persistent — either means state can outlive the view. This is
 *   an internal wiring invariant that must never fire in a correctly-built view.
 */
export function assertSealed(session: Session): void {
  if (session.storagePath !== null) {
    throw new AppError(
      'Preview session is not in-memory (storagePath is not null)',
      ErrorCode.UNKNOWN_ERROR
    )
  }
  // A persistent partition round-trips storage even when storagePath reads null
  // in some builds; assert the partition identity too.
  if (session.isPersistent()) {
    throw new AppError(
      'Preview session is a persistent partition',
      ErrorCode.UNKNOWN_ERROR
    )
  }
}

/**
 * Every `clearStorageData` storage type except `shadercache` — see the header
 * for why that one is left out. Exported so the test pins the list.
 */
export const PURGED_STORAGES = Object.freeze([
  'cookies',
  'filesystem',
  'indexdb',
  'localstorage',
  'websql',
  'serviceworkers',
  'cachestorage'
] as const)

/**
 * Drop all storage and cache for a preview session. Belt-and-braces before an
 * Erfana-driven reload; the opaque origin is the actual seal (design §1.2).
 */
export async function purge(session: Session): Promise<void> {
  await session.clearStorageData({ storages: [...PURGED_STORAGES] })
  await session.clearCache()
  await session.clearAuthCache()
  await session.clearHostResolverCache()
  await session.clearCodeCaches({})
  // No page is alive at either recycling call site, and the approve path
  // reloads ignoring cache right after — so failing in-flight requests is fine.
  await session.closeAllConnections()
}

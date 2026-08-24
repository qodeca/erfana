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
 * `purge` is belt-and-braces before an Erfana-driven reload (the approve path):
 * `clearStorageData` + `clearCache` drop a cached CDN response that could
 * otherwise survive an approval reload. It is NOT the seal (design §1.2 table).
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
 * Drop all storage and cache for a preview session. Belt-and-braces before an
 * Erfana-driven reload; the opaque origin is the actual seal (design §1.2).
 */
export async function purge(session: Session): Promise<void> {
  await session.clearStorageData()
  await session.clearCache()
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../shared/errors'
import { assertSealed, purge, PURGED_STORAGES } from './PreviewStorageSeal'

interface SealMockOptions {
  storagePath?: string | null
  persistent?: boolean
}

function makeSessionMock(options: SealMockOptions = {}): {
  session: Session
  clearStorageData: ReturnType<typeof vi.fn<() => Promise<void>>>
  clearCache: ReturnType<typeof vi.fn<() => Promise<void>>>
  clearAuthCache: ReturnType<typeof vi.fn<() => Promise<void>>>
  clearHostResolverCache: ReturnType<typeof vi.fn<() => Promise<void>>>
  clearCodeCaches: ReturnType<typeof vi.fn<() => Promise<void>>>
  closeAllConnections: ReturnType<typeof vi.fn<() => Promise<void>>>
} {
  const clearStorageData = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const clearCache = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const clearAuthCache = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const clearHostResolverCache = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const clearCodeCaches = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const closeAllConnections = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const session = {
    storagePath: options.storagePath ?? null,
    isPersistent: () => options.persistent ?? false,
    clearStorageData,
    clearCache,
    clearAuthCache,
    clearHostResolverCache,
    clearCodeCaches,
    closeAllConnections
  } as unknown as Session

  return {
    session,
    clearStorageData,
    clearCache,
    clearAuthCache,
    clearHostResolverCache,
    clearCodeCaches,
    closeAllConnections
  }
}

describe('assertSealed', () => {
  it('passes for an in-memory session (null storagePath, non-persistent)', () => {
    const { session } = makeSessionMock({ storagePath: null, persistent: false })
    expect(() => assertSealed(session)).not.toThrow()
  })

  it('throws when storagePath is non-null', () => {
    const { session } = makeSessionMock({ storagePath: '/var/data/preview' })
    expect(() => assertSealed(session)).toThrow(AppError)
  })

  it('throws when the partition reports itself persistent', () => {
    const { session } = makeSessionMock({ storagePath: null, persistent: true })
    expect(() => assertSealed(session)).toThrow(AppError)
  })
})

describe('purge', () => {
  it('also clears the auth cache, the resolver cache and the code caches — a partition is reused', async () => {
    // The opaque origin seals script-visible storage only. Once a partition can
    // be handed to the NEXT preview, the HTTP-level residue matters too.
    const { session, clearAuthCache, clearHostResolverCache, clearCodeCaches } = makeSessionMock()
    await purge(session)
    expect(clearAuthCache).toHaveBeenCalledTimes(1)
    expect(clearHostResolverCache).toHaveBeenCalledTimes(1)
    expect(clearCodeCaches).toHaveBeenCalledWith({})
  })

  it('closes every warm connection too — the socket pools are per network context', async () => {
    // Recorded as "cannot be cleared from the session API" until the security
    // review found `Session.closeAllConnections()` in the Electron 39 typings.
    const { session, closeAllConnections } = makeSessionMock()
    await purge(session)
    expect(closeAllConnections).toHaveBeenCalledTimes(1)
  })

  it('calls both clearStorageData and clearCache', async () => {
    const { session, clearStorageData, clearCache } = makeSessionMock()

    await purge(session)

    expect(clearStorageData).toHaveBeenCalledTimes(1)
    expect(clearCache).toHaveBeenCalledTimes(1)
  })

  it('names every data-bearing storage explicitly, and leaves only the shader cache out', async () => {
    // Clearing `shadercache` on a preview partition never completes inside the
    // app on Windows (Electron 39; probed per storage type on 2026-09-04), and
    // it holds compiled GPU programs, not page data. Listing the other seven
    // by name keeps the purge complete AND lets it settle. A regression that
    // dropped one of them, or called with no filter again, fails here.
    const { session, clearStorageData } = makeSessionMock()

    await purge(session)

    expect(clearStorageData).toHaveBeenCalledWith({ storages: [...PURGED_STORAGES] })
    expect(PURGED_STORAGES).toEqual([
      'cookies',
      'filesystem',
      'indexdb',
      'localstorage',
      'websql',
      'serviceworkers',
      'cachestorage'
    ])
    expect(PURGED_STORAGES).not.toContain('shadercache')
  })
})

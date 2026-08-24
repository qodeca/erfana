// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../shared/errors'
import { assertSealed, purge } from './PreviewStorageSeal'

interface SealMockOptions {
  storagePath?: string | null
  persistent?: boolean
}

function makeSessionMock(options: SealMockOptions = {}): {
  session: Session
  clearStorageData: ReturnType<typeof vi.fn<() => Promise<void>>>
  clearCache: ReturnType<typeof vi.fn<() => Promise<void>>>
} {
  const clearStorageData = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const clearCache = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const session = {
    storagePath: options.storagePath ?? null,
    isPersistent: () => options.persistent ?? false,
    clearStorageData,
    clearCache
  } as unknown as Session

  return { session, clearStorageData, clearCache }
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
  it('calls both clearStorageData and clearCache', async () => {
    const { session, clearStorageData, clearCache } = makeSessionMock()

    await purge(session)

    expect(clearStorageData).toHaveBeenCalledTimes(1)
    expect(clearCache).toHaveBeenCalledTimes(1)
  })

  it('purges the FULL storage scope — no narrowing options filter', async () => {
    const { session, clearStorageData } = makeSessionMock()

    await purge(session)

    // Called with no arguments: a regression that passed an options filter (e.g.
    // { storages: ['cookies'] }) would leave IndexedDB/cache behind and fail here.
    expect(clearStorageData).toHaveBeenCalledWith()
  })
})

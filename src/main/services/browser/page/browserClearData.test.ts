// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Clear browsing data and Forget's clearing half (025-FR-023; ADR 0009
 * decision 12): each ticked kind removes only its own data, every step stops
 * after 10 s, and a step that fails or times out is reported by kind.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import type { ClearDataCategory } from '../../../../shared/ipc/browser-tab-page-schema'
import { clearBrowsingData, clearForForget, CLEAR_STEP_TIMEOUT_MS, runStep, SITE_DATA_STORAGES, type ClearTarget } from './browserClearData'

function fakeTarget() {
  const session = {
    clearStorageData: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    clearAuthCache: vi.fn(async () => undefined),
    closeAllConnections: vi.fn(async () => undefined)
  }
  const target = {
    session,
    clearHistory: vi.fn(async () => undefined),
    clearPermissions: vi.fn(async () => undefined),
    clearCertificates: vi.fn(async () => undefined),
    clearCredentials: vi.fn(async () => undefined),
    deleteCaptures: vi.fn(async () => 'deleted')
  } satisfies ClearTarget
  /** What each kind touched, by name. */
  const touched = (): string[] =>
    Object.entries({ ...session, ...target, session: undefined })
      .filter(([, fn]) => typeof fn === 'function' && (fn as ReturnType<typeof vi.fn>).mock.calls.length > 0)
      .map(([name]) => name)
      .filter((name) => name !== 'closeAllConnections')
      .sort()
  return { session, target, touched }
}

const ALONE: ReadonlyArray<[ClearDataCategory, string[]]> = [
  ['cookies', ['clearHistory', 'clearStorageData']],
  ['cache', ['clearCache']],
  ['permissions', ['clearCertificates', 'clearPermissions']],
  ['credentials', ['clearAuthCache', 'clearCredentials']],
  ['captures', ['deleteCaptures']]
]

afterEach(() => vi.useRealTimers())

describe('clearBrowsingData', () => {
  it.each(ALONE)('025-AC-023 %s alone removes only its own data', async (category, expected) => {
    const { target, touched, session } = fakeTarget()
    expect(await clearBrowsingData(new Set([category]), target)).toEqual([])
    expect(touched()).toEqual(expected)
    expect(session.closeAllConnections).toHaveBeenCalledTimes(1)
  })

  it('025-AC-023 Cookies and other site data clears the site storages and the history, not the shader cache', async () => {
    const { target, session } = fakeTarget()
    await clearBrowsingData(new Set(['cookies']), target)
    expect(session.clearStorageData).toHaveBeenCalledWith({ storages: [...SITE_DATA_STORAGES] })
    expect(SITE_DATA_STORAGES).toEqual(
      expect.arrayContaining(['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'])
    )
    expect(SITE_DATA_STORAGES).not.toContain('shadercache')
    expect(target.clearHistory).toHaveBeenCalledTimes(1)
  })

  it('025-AC-023 reports a step that fails and one that times out after 10 s, and leaves unticked data alone', async () => {
    vi.useFakeTimers()
    const { target, session } = fakeTarget()
    session.clearCache.mockImplementation(() => new Promise(() => undefined))
    target.clearCredentials.mockRejectedValue(new Error('disk'))
    const pending = clearBrowsingData(new Set<ClearDataCategory>(['captures', 'credentials', 'cache']), target)
    await vi.advanceTimersByTimeAsync(CLEAR_STEP_TIMEOUT_MS)
    expect(await pending).toEqual([
      { category: 'cache', reason: 'timeout' },
      { category: 'credentials', reason: 'failed' }
    ])
    expect(target.deleteCaptures).toHaveBeenCalledTimes(1)
    expect(session.clearStorageData).not.toHaveBeenCalled()
    expect(target.clearPermissions).not.toHaveBeenCalled()
  })

  it('a step that throws synchronously counts as failed', async () => {
    expect(
      await runStep('x', () => {
        throw new Error('sync')
      })
    ).toBe('failed')
  })
})

describe('clearForForget', () => {
  it('clears every storage, both caches, the decisions and the connections, and passes a stuck step over', async () => {
    vi.useFakeTimers()
    const { target, session } = fakeTarget()
    session.clearCache.mockImplementation(() => new Promise(() => undefined))
    const pending = clearForForget(target)
    await vi.advanceTimersByTimeAsync(CLEAR_STEP_TIMEOUT_MS)
    await pending
    expect(session.clearStorageData).toHaveBeenCalledWith()
    expect(session.clearAuthCache).toHaveBeenCalled()
    expect(target.clearCredentials).toHaveBeenCalled()
    expect(target.clearPermissions).toHaveBeenCalled()
    expect(target.clearCertificates).toHaveBeenCalled()
    expect(session.closeAllConnections).toHaveBeenCalled()
    expect(target.deleteCaptures).not.toHaveBeenCalled()
  })
})

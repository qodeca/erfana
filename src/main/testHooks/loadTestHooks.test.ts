// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The gate into the test hooks (spec 025 solution design § 12, T3): both the
 * build flag and the run-time lock must be open, and a failed install is
 * logged instead of breaking start-up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { logError, installTestHooks } = vi.hoisted(() => ({
  logError: vi.fn(),
  installTestHooks: vi.fn()
}))
vi.mock('../services/LoggingService', () => ({ logger: { error: logError } }))
vi.mock('./index', () => ({ installTestHooks }))

import { loadTestHooks, testHooksAllowed } from './loadTestHooks'

beforeEach(() => {
  logError.mockReset()
  installTestHooks.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('testHooksAllowed', () => {
  it.each([
    [false, '1', true],
    [true, '1', false],
    [false, '0', false],
    [false, undefined, false],
    [false, 'true', false]
  ])('isPackaged=%s, ERFANA_E2E_TEST_HOOKS=%s → %s', (isPackaged, value, expected) => {
    expect(testHooksAllowed(isPackaged, { ERFANA_E2E_TEST_HOOKS: value })).toBe(expected)
  })

  it('reads the app and the process environment by default', () => {
    vi.stubEnv('ERFANA_E2E_TEST_HOOKS', '1')
    try {
      expect(testHooksAllowed()).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('loadTestHooks', () => {
  it('never loads the hooks in a build without the flag, even with the run-time lock open', async () => {
    const allowed = vi.fn(() => true)
    await expect(loadTestHooks(allowed)).resolves.toBe(false)
    expect(allowed).not.toHaveBeenCalled()
    expect(installTestHooks).not.toHaveBeenCalled()
  })

  it('does not load the hooks in an e2e build when the run-time lock is closed', async () => {
    vi.stubGlobal('__ERFANA_TEST_HOOKS__', true)
    await expect(loadTestHooks(() => false)).resolves.toBe(false)
    expect(installTestHooks).not.toHaveBeenCalled()
  })

  it('installs the hooks when both locks are open', async () => {
    vi.stubGlobal('__ERFANA_TEST_HOOKS__', true)
    await expect(loadTestHooks(() => true)).resolves.toBe(true)
    expect(installTestHooks).toHaveBeenCalledTimes(1)
  })

  it('logs a failed install and resolves false instead of rejecting', async () => {
    vi.stubGlobal('__ERFANA_TEST_HOOKS__', true)
    const failure = new Error('install failed')
    installTestHooks.mockImplementation(() => {
      throw failure
    })
    await expect(loadTestHooks(() => true)).resolves.toBe(false)
    expect(logError).toHaveBeenCalledWith('Test hooks failed to install', failure)
  })

  it('wraps a thrown non-Error before logging it', async () => {
    vi.stubGlobal('__ERFANA_TEST_HOOKS__', true)
    installTestHooks.mockImplementation(() => {
      throw 'plain string'
    })
    await expect(loadTestHooks(() => true)).resolves.toBe(false)
    expect(logError).toHaveBeenCalledWith('Test hooks failed to install', new Error('plain string'))
  })
})

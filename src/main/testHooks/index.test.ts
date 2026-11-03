// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The test-hook surface (spec 025 solution design § 12, T3): installed once on
 * a global, carrying the sentinel the bundle check looks for. That the
 * sentinel matches `scripts/check-no-test-hooks.mjs` is checked by that
 * script's own test.
 */
import { describe, expect, it, vi } from 'vitest'

// The default dependencies load the browser hook, which imports Electron; these tests pass their own.
vi.mock('./browserHook', () => ({ createBrowserTestHook: vi.fn() }))
vi.mock('../services/browser/browserAppSetup', () => ({ getBrowserRuntime: vi.fn() }))
import type { ClockTestHook } from './clockHook'
import type { BrowserTestHook } from './browserHook'
import {
  TEST_HOOKS_GLOBAL_KEY,
  TEST_HOOK_SENTINEL,
  createTestHooks,
  installTestHooks,
  type TestHookDependencies
} from './index'

const clockHook: ClockTestHook = {
  now: () => 0,
  advancedMs: () => 0,
  advance: async () => {}
}

const browserHook = {} as BrowserTestHook

function deps(): TestHookDependencies {
  return { installClock: vi.fn(() => clockHook), createBrowser: vi.fn(() => browserHook) }
}

describe('test hooks', () => {
  it('carries the sentinel the bundle check searches for', () => {
    expect(createTestHooks(deps()).sentinel).toBe(TEST_HOOK_SENTINEL)
  })

  it('builds every hook into a frozen object', () => {
    const dependencies = deps()
    const hooks = createTestHooks(dependencies)
    expect(hooks.clock).toBe(clockHook)
    expect(hooks.browser).toBe(browserHook)
    expect(dependencies.installClock).toHaveBeenCalledTimes(1)
    expect(dependencies.createBrowser).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(hooks)).toBe(true)
  })

  it('installs the hooks on the target global once and refuses a second install', () => {
    const target: Record<string, unknown> = {}
    const hooks = installTestHooks(target, deps())
    expect(target[TEST_HOOKS_GLOBAL_KEY]).toBe(hooks)

    const second = deps()
    expect(() => installTestHooks(target, second)).toThrow(/already installed/)
    expect(second.installClock).not.toHaveBeenCalled()
    expect(target[TEST_HOOKS_GLOBAL_KEY]).toBe(hooks)
  })
})

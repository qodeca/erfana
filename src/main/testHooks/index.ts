// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The main-process test hooks (spec 025 solution design § 12, T3).
 *
 * Compiled only into an e2e build (`electron-vite build --mode e2e`, which
 * defines `__ERFANA_TEST_HOOKS__` as `true`) and loaded only by
 * `loadTestHooks.ts`, through a dynamic import behind that flag and the
 * runtime gate. A test reaches the hooks through `app.evaluate` on
 * `globalThis.__erfanaTestHooks` – never through an IPC channel, so a page
 * cannot reach them even in a test build.
 *
 * `TEST_HOOK_SENTINEL` rides on the installed object, so it is in every build
 * that bundles this module; `scripts/check-no-test-hooks.mjs` fails a
 * production build that contains it.
 *
 * To add a hook: give it a field in {@link TestHooks} and build it in
 * {@link createTestHooks}.
 */
import { installClockTestHook, type ClockTestHook } from './clockHook'
import { createBrowserTestHook, type BrowserTestHook } from './browserHook'
import { createBrowserInputTestHook, type BrowserInputTestHook } from './browserInputHook'
import { createBrowserSiteTestHook, type BrowserSiteTestHook } from './browserSiteHook'
import { createBrowserPageTestHook, type BrowserPageTestHook } from './browserPageHook'
import { createBrowserPopupTestHook, type BrowserPopupTestHook } from './browserPopupHook'
import { createBrowserPickTestHook, type BrowserPickTestHook } from './browserPickHook'
import { getBrowserRuntime } from '../services/browser/browserAppSetup'

/** The string `scripts/check-no-test-hooks.mjs` looks for in a production build. */
export const TEST_HOOK_SENTINEL = 'ERFANA_BROWSER_TEST_HOOK_SENTINEL'

/** The `globalThis` key the hooks live under. */
export const TEST_HOOKS_GLOBAL_KEY = '__erfanaTestHooks'

/** Every hook, by name. */
export interface TestHooks {
  readonly clock: ClockTestHook
  /** Built-in browser: tabs, the input harness, reads (spec 025 § 12, T2). */
  readonly browser: BrowserTestHook
  /** Built-in browser key and mouse routing (spec 025 commit 13). */
  readonly browserInput: BrowserInputTestHook
  /** Built-in browser site behaviour: the test CA (spec 025 commits 12c–d, probe 10c). */
  readonly site: BrowserSiteTestHook
  /** Built-in browser page features: load errors, crash, zoom, presets, Clear, history (spec 025 commit 12h). */
  readonly page: BrowserPageTestHook
  /** Built-in browser popups, leave-page prompt and right-click menu (spec 025 commits 12e–g). */
  readonly popup: BrowserPopupTestHook
  /** Built-in browser pick and send: highlight, targets, capture faults, expiry, bench (spec 025 commits 14–15). */
  readonly pick: BrowserPickTestHook
}

/** What `globalThis.__erfanaTestHooks` holds. */
export interface InstalledTestHooks extends TestHooks {
  readonly sentinel: typeof TEST_HOOK_SENTINEL
}

/** What building the hooks needs from the app; tests pass their own. */
export interface TestHookDependencies {
  readonly installClock: () => ClockTestHook
  readonly createBrowser: () => BrowserTestHook
  readonly createBrowserInput?: () => BrowserInputTestHook
  readonly createSite?: () => BrowserSiteTestHook
  readonly createPage?: () => BrowserPageTestHook
  readonly createPopup?: () => BrowserPopupTestHook
  readonly createPick?: () => BrowserPickTestHook
}

const defaultDependencies: TestHookDependencies = {
  installClock: () => installClockTestHook(),
  createBrowser: () => createBrowserTestHook(getBrowserRuntime),
  createBrowserInput: () => createBrowserInputTestHook(getBrowserRuntime)
}

/** Builds every hook. */
export function createTestHooks(
  deps: TestHookDependencies = defaultDependencies
): InstalledTestHooks {
  return Object.freeze({
    sentinel: TEST_HOOK_SENTINEL,
    clock: deps.installClock(),
    browser: deps.createBrowser(),
    browserInput: (deps.createBrowserInput ?? (() => createBrowserInputTestHook(getBrowserRuntime)))(),
    site: (deps.createSite ?? (() => createBrowserSiteTestHook(getBrowserRuntime)))(),
    page: (deps.createPage ?? (() => createBrowserPageTestHook(getBrowserRuntime)))(),
    popup: (deps.createPopup ?? (() => createBrowserPopupTestHook(getBrowserRuntime)))(),
    pick: (deps.createPick ?? (() => createBrowserPickTestHook(getBrowserRuntime)))()
  })
}

/**
 * Builds the hooks and puts them on `target[TEST_HOOKS_GLOBAL_KEY]`.
 *
 * @throws Error when hooks are already installed on `target`.
 */
export function installTestHooks(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
  deps: TestHookDependencies = defaultDependencies
): InstalledTestHooks {
  if (TEST_HOOKS_GLOBAL_KEY in target) {
    throw new Error(`Test hooks are already installed on ${TEST_HOOKS_GLOBAL_KEY}`)
  }
  const hooks = createTestHooks(deps)
  target[TEST_HOOKS_GLOBAL_KEY] = hooks
  return hooks
}

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

/** The string `scripts/check-no-test-hooks.mjs` looks for in a production build. */
export const TEST_HOOK_SENTINEL = 'ERFANA_BROWSER_TEST_HOOK_SENTINEL'

/** The `globalThis` key the hooks live under. */
export const TEST_HOOKS_GLOBAL_KEY = '__erfanaTestHooks'

/** Every hook, by name. */
export interface TestHooks {
  readonly clock: ClockTestHook
}

/** What `globalThis.__erfanaTestHooks` holds. */
export interface InstalledTestHooks extends TestHooks {
  readonly sentinel: typeof TEST_HOOK_SENTINEL
}

/** What building the hooks needs from the app; tests pass their own. */
export interface TestHookDependencies {
  readonly installClock: () => ClockTestHook
}

const defaultDependencies: TestHookDependencies = {
  installClock: () => installClockTestHook()
}

/** Builds every hook. */
export function createTestHooks(
  deps: TestHookDependencies = defaultDependencies
): InstalledTestHooks {
  return Object.freeze({
    sentinel: TEST_HOOK_SENTINEL,
    clock: deps.installClock()
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

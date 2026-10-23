// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one `window.__erfanaTest` object every e2e test hook installs into.
 *
 * Each hook module (terminal, editor) provides its own readers through
 * {@link provideTestHook}. The object always carries the FULL surface, with
 * "nothing registered" defaults, so a test that reads one hook never finds the
 * object half-built because another hook happened to install first.
 *
 * The switch comes from the preload (`window.api.testHooks.enabled`, read
 * through `services/testHooksGateway`), never from a global the page could
 * set. It is true only when the main process launched this window with the
 * test-hook flag, which it does only for an unpackaged app with
 * `ERFANA_E2E_TEST_HOOKS=1` (`buildAdditionalArguments` in src/main/index.ts).
 * In every other run nothing is installed.
 */
import { hasBridge } from '../services/bridgePresence'
import { testHooksGateway } from '../services/testHooksGateway'

/** The installed hook object, as declared in src/preload/index.d.ts. */
export type ErfanaTestHooks = NonNullable<Window['__erfanaTest']>

/** Whether the launcher switched the test hooks on for this window (a unit test may install no bridge). */
export function hooksEnabled(): boolean {
  return hasBridge('testHooks') && testHooksGateway.enabled === true
}

const surface: ErfanaTestHooks = {
  terminalText: () => null,
  terminalCursor: () => null,
  editorValue: () => null
}

/**
 * Put one reader on `window.__erfanaTest` (and the object on `window`). The
 * caller checks {@link hooksEnabled} first; this does not.
 */
export function provideTestHook<K extends keyof ErfanaTestHooks>(name: K, reader: ErfanaTestHooks[K]): void {
  surface[name] = reader
  window.__erfanaTest = surface
}

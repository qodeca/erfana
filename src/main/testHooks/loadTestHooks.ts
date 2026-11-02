// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The only way into the main-process test hooks (spec 025 solution design
 * § 12, T3). This file ships in every build; the hooks themselves do not.
 *
 * Two locks, both required:
 * 1. Build time – `__ERFANA_TEST_HOOKS__` is `true` only in an e2e build
 *    (`electron-vite build --mode e2e`). In every other build it is the
 *    literal `false`, so the bundler drops the dynamic import below and the
 *    hook modules never reach the output (`npm run check:no-test-hooks`).
 * 2. Run time – an unpackaged app started with `ERFANA_E2E_TEST_HOOKS=1`, the
 *    same gate as the renderer and comment hooks (`src/main/index.ts`).
 *
 * Keep the import dynamic and inside the flag check: a static import of
 * `./index`, or of anything it exports, would put the hooks in production.
 */
import { app } from 'electron'
import { logger } from '../services/LoggingService'

/** The run-time lock: an unpackaged app started with `ERFANA_E2E_TEST_HOOKS=1`. */
export function testHooksAllowed(
  isPackaged: boolean = app.isPackaged,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return !isPackaged && env.ERFANA_E2E_TEST_HOOKS === '1'
}

/**
 * Installs the test hooks when both locks are open. Call once at start-up,
 * before any module schedules a timer on `mainClock`. Resolves `true` when the
 * hooks were installed; never rejects – a failure is logged, and the test that
 * needs a hook fails on its absence.
 */
export async function loadTestHooks(allowed: () => boolean = testHooksAllowed): Promise<boolean> {
  if (__ERFANA_TEST_HOOKS__ && allowed()) {
    try {
      const { installTestHooks } = await import('./index')
      installTestHooks()
      return true
    } catch (error) {
      logger.error(
        'Test hooks failed to install',
        error instanceof Error ? error : new Error(String(error))
      )
      return false
    }
  }
  return false
}

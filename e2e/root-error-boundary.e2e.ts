// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E coverage for the root error boundary (#60 F8, design §2.8).
 *
 * Crash injection is launcher-only: `ERFANA_E2E_FORCE_CRASH=1` in the launching
 * environment makes the main process append `--erfana-force-crash` to
 * `webPreferences.additionalArguments` (unpackaged builds only), the preload
 * re-exposes it as `window.__ERFANA_FORCE_CRASH__`, and `ForcedCrash` in
 * `App.tsx` throws during render. The renderer cannot set the flag itself.
 *
 * The point of the scenario is the symptom the issue reported: a crash must
 * produce the recovery screen, NOT a blank window.
 *
 * Restart is deliberately never clicked — it relaunches the app mid-test.
 *
 * @see docs/design/design-issue-60.md §2.8
 */

import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import * as path from 'path'
import { TEST_IDS, byTestId, createTempUserDataDir } from './utils/helpers'

const APP_ENTRY = path.join(__dirname, '..')

/**
 * Base launch environment with the crash flag explicitly removed.
 *
 * The variable must never leak in from the developer's shell — the negative
 * test would then assert the wrong thing and pass for the wrong reason.
 */
function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, NODE_ENV: 'development' }
  delete env.ERFANA_E2E_FORCE_CRASH
  return env
}

async function launchApp(
  userDataDir: string,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<ElectronApplication> {
  return electron.launch({
    args: [APP_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...baseEnv(), ...extraEnv }
  })
}

async function closeApp(electronApp: ElectronApplication): Promise<void> {
  // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
  await new Promise((resolve) => setTimeout(resolve, 100))
  await electronApp.close()
}

test.describe('Root error boundary', () => {
  test('should show the recovery fallback instead of a blank window when the renderer throws', async () => {
    const { userDataDir, cleanup } = await createTempUserDataDir('root-error-crash')

    try {
      const electronApp = await launchApp(userDataDir, { ERFANA_E2E_FORCE_CRASH: '1' })

      try {
        const window = await electronApp.firstWindow()
        await window.waitForLoadState('domcontentloaded')

        // The fallback container replaces the whole app tree.
        const fallback = byTestId(window, TEST_IDS.ROOT_ERROR_BOUNDARY)
        await expect(fallback).toBeVisible({ timeout: 15000 })

        // The reported symptom, asserted directly: the window is not blank.
        const bodyText = await window.evaluate(() => document.body.innerText.trim())
        expect(bodyText.length).toBeGreaterThan(0)
        const rootChildCount = await window.evaluate(
          () => document.getElementById('root')?.childElementCount ?? 0
        )
        expect(rootChildCount).toBeGreaterThan(0)

        // The app tree is gone — the boundary rendered instead of it.
        await expect(byTestId(window, TEST_IDS.ACTIVITY_BAR)).toHaveCount(0)

        // Details start collapsed and the toggle expands the region.
        const toggle = byTestId(window, TEST_IDS.ROOT_ERROR_DETAILS_TOGGLE)
        const detailsRegion = byTestId(window, TEST_IDS.ROOT_ERROR_DETAILS)
        await expect(toggle).toBeVisible()
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')
        await expect(detailsRegion).toBeHidden()

        await toggle.click()

        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
        await expect(detailsRegion).toBeVisible()

        // Recovery actions are present. Restart is asserted but NEVER clicked —
        // activating it would relaunch the app in the middle of the test.
        await expect(byTestId(window, TEST_IDS.ROOT_ERROR_BTN_COPY)).toBeVisible()
        await expect(byTestId(window, TEST_IDS.ROOT_ERROR_BTN_LOGS)).toBeVisible()
        await expect(byTestId(window, TEST_IDS.ROOT_ERROR_BTN_RESTART)).toBeVisible()
      } finally {
        await closeApp(electronApp)
      }
    } finally {
      await cleanup()
    }
  })

  test('should render the normal app when the crash flag is not set', async () => {
    const { userDataDir, cleanup } = await createTempUserDataDir('root-error-no-crash')

    try {
      const electronApp = await launchApp(userDataDir)

      try {
        const window = await electronApp.firstWindow()
        await window.waitForLoadState('domcontentloaded')

        await expect(byTestId(window, TEST_IDS.ACTIVITY_BAR)).toBeVisible({ timeout: 15000 })
        await expect(byTestId(window, TEST_IDS.ROOT_ERROR_BOUNDARY)).toHaveCount(0)
      } finally {
        await closeApp(electronApp)
      }
    } finally {
      await cleanup()
    }
  })
})

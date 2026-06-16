// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'path'
import { TEST_IDS, byTestId, createTempUserDataDir } from './utils/helpers'

test.describe('Erfana App Launch', () => {
  test('should launch and display main window with testids', async () => {
    const { userDataDir, cleanup } = await createTempUserDataDir('app-launch-testids')

    try {
      // Launch Electron app in dev mode with isolated user data directory
      const electronApp = await electron.launch({
        args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
        env: {
          ...process.env,
          NODE_ENV: 'development'
        }
      })

      // Get the first window
      const window = await electronApp.firstWindow()

      // Wait for app to be ready
      await window.waitForLoadState('domcontentloaded')

      // Verify activity bar testid exists
      const activityBar = byTestId(window, TEST_IDS.ACTIVITY_BAR)
      await expect(activityBar).toBeVisible({ timeout: 10000 })

      // Verify files button testid
      const filesButton = byTestId(window, TEST_IDS.ACTIVITY_BAR_BTN_FILES)
      await expect(filesButton).toBeVisible()

      // Verify settings button testid
      const settingsButton = byTestId(window, TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS)
      await expect(settingsButton).toBeVisible()

      // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await electronApp.close()
    } finally {
      await cleanup()
    }
  })

  test('should have unique testids in DOM', async () => {
    const { userDataDir, cleanup } = await createTempUserDataDir('app-launch-unique')

    try {
      const electronApp = await electron.launch({
        args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
        env: {
          ...process.env,
          NODE_ENV: 'development'
        }
      })

      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      // Get all testids
      const testIds = await window.evaluate(() => {
        const elements = document.querySelectorAll('[data-testid]')
        return Array.from(elements).map((el) => el.getAttribute('data-testid'))
      })

      // Verify no duplicates (excluding dynamic hash-based testids)
      const staticTestIds = testIds.filter((id) => id && !id.match(/-[a-f0-9]{8}$/))
      const uniqueStaticIds = new Set(staticTestIds)
      expect(staticTestIds.length).toBe(uniqueStaticIds.size)

      // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await electronApp.close()
    } finally {
      await cleanup()
    }
  })
})

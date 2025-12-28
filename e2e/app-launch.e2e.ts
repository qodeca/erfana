import { test, expect, _electron as electron } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { TEST_IDS, byTestId } from './utils/helpers'

/**
 * Creates a temporary user data directory for test isolation.
 * Returns the path and a cleanup function.
 */
async function createTempUserDataDir(
  testName: string
): Promise<{ userDataDir: string; cleanup: () => Promise<void> }> {
  const e2eTempDir = path.join(__dirname, '..', '.e2e-temp')
  await fs.promises.mkdir(e2eTempDir, { recursive: true })

  const userDataDir = await fs.promises.mkdtemp(path.join(e2eTempDir, `app-launch-${testName}-`))

  return {
    userDataDir,
    cleanup: async () => {
      await fs.promises.rm(userDataDir, { recursive: true, force: true })
    }
  }
}

test.describe('Erfana App Launch', () => {
  test('should launch and display main window with testids', async () => {
    const { userDataDir, cleanup } = await createTempUserDataDir('testids')

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

      // Clean up - delay to let pending electron-log operations complete
      await new Promise((resolve) => setTimeout(resolve, 100))
      await electronApp.close()
    } finally {
      await cleanup()
    }
  })

  test('should have unique testids in DOM', async () => {
    const { userDataDir, cleanup } = await createTempUserDataDir('unique')

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

      await new Promise((resolve) => setTimeout(resolve, 100))
      await electronApp.close()
    } finally {
      await cleanup()
    }
  })
})

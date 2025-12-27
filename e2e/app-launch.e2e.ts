import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

test.describe('Erfana App Launch', () => {
  test('should launch and display main window with testids', async () => {
    // Launch Electron app in dev mode
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..')],
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    })

    // Get the first window
    const window = await electronApp.firstWindow()

    // Wait for app to be ready
    await window.waitForLoadState('domcontentloaded')

    // Verify activity bar testid exists
    const activityBar = window.locator('[data-testid="activity-bar"]')
    await expect(activityBar).toBeVisible({ timeout: 10000 })

    // Verify files button testid
    const filesButton = window.locator('[data-testid="activity-bar-btn-files"]')
    await expect(filesButton).toBeVisible()

    // Verify settings button testid
    const settingsButton = window.locator('[data-testid="activity-bar-btn-settings"]')
    await expect(settingsButton).toBeVisible()

    // Clean up
    await electronApp.close()
  })

  test('should have unique testids in DOM', async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..')],
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
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

    await electronApp.close()
  })
})

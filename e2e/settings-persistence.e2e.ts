// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Settings overlay — the controls, and whether a change survives a restart.
 *
 * Only the Logging section had any end-to-end coverage, and nothing at all
 * checked persistence. That is the half that actually breaks: settings live in
 * two different places (electron-store in the main process for app settings,
 * `localStorage` in the renderer for layout), and a change that looks applied
 * but is never written back is invisible until the user restarts and finds
 * their preference gone.
 *
 * So every persistence test here launches the app TWICE against the same
 * `--user-data-dir`, changes something in the first run, and asserts it in the
 * second. There is no other way to test this; a single-launch test can only
 * prove the toggle moved.
 *
 * These tests own their launches rather than using the composed fixtures,
 * because the fixtures give one app per test — the same reason
 * `root-error-boundary.e2e.ts` opts out.
 *
 * ISOLATION, and why it needs saying: global settings do NOT live under the
 * Electron user-data directory. `GlobalSettingsService` writes
 * `~/.erfana/settings.json`, derived from `os.homedir()`, so
 * `--user-data-dir` isolates nothing here — a test that flips a toggle would
 * rewrite the developer's own settings and collide with every other worker.
 * Each launch below therefore gets its own HOME (and USERPROFILE, which is
 * what `os.homedir()` reads on Windows) inside the test's temp directory.
 *
 * Note the shared fixtures deliberately do NOT do this: `logTail.ts` reads
 * `~/.erfana/logs/main.log` from the real home, so redirecting HOME globally
 * would break the specs that tail the log.
 *
 * @see src/renderer/src/components/Settings/SettingsOverlay.tsx
 * @see src/renderer/src/stores/useGlobalSettingsStore.ts
 * @see src/renderer/src/stores/useActivityBarStore.ts
 */

import { test, expect, _electron as electron, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import * as path from 'path'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId, waitForTestId, waitForTestIdHidden } from './utils/locators'
import { createTempUserDataDir } from './utils/helpers'

const APP_ROOT = path.join(__dirname, '..')

/**
 * A settings sandbox: an isolated user-data dir AND an isolated home, so
 * `~/.erfana/settings.json` resolves inside the test rather than the
 * developer's account.
 */
interface SettingsSandbox {
  userDataDir: string
  fakeHome: string
  cleanup: () => Promise<void>
}

async function createSettingsSandbox(label: string): Promise<SettingsSandbox> {
  const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(label)
  const fakeHome = await mkdtemp(path.join(tmpdir(), `erfana-home-${label}-`))

  return {
    userDataDir,
    fakeHome,
    cleanup: async () => {
      await rm(fakeHome, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
      await cleanupUserData()
    }
  }
}

/**
 * Launch the app inside a sandbox, hand the window to `body`, and always close
 * afterwards. Call it twice with the same sandbox to test a restart.
 */
async function withApp(
  sandbox: SettingsSandbox,
  body: (window: Page, app: ElectronApplication) => Promise<void>
): Promise<void> {
  const app = await electron.launch({
    args: [APP_ROOT, `--user-data-dir=${sandbox.userDataDir}`],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      // `os.homedir()` reads HOME on POSIX and USERPROFILE on Windows; set
      // both so the settings file lands in the sandbox on every platform.
      HOME: sandbox.fakeHome,
      USERPROFILE: sandbox.fakeHome
    }
  })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await waitForTestId(window, TEST_IDS.ACTIVITY_BAR, { timeout: 15_000 })
    await body(window, app)
  } finally {
    // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await app.close().catch(() => undefined)
  }
}

async function openSettings(window: Page): Promise<void> {
  await byTestId(window, TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).click()
  await waitForTestId(window, TEST_IDS.SETTINGS_OVERLAY, { timeout: 10_000 })
}

async function closeSettings(window: Page): Promise<void> {
  await byTestId(window, TEST_IDS.SETTINGS_BTN_CLOSE).click()
  await waitForTestIdHidden(window, TEST_IDS.SETTINGS_OVERLAY, { timeout: 10_000 })
}

test.describe('Settings overlay – controls', () => {
  test('should show every section and open and close cleanly', async () => {
    const sandbox = await createSettingsSandbox('settings-sections')
    try {
      await withApp(sandbox, async (window) => {
        await openSettings(window)

        await expect(byTestId(window, TEST_IDS.SETTINGS_SECTION_EDITOR)).toBeVisible()
        await expect(byTestId(window, TEST_IDS.SETTINGS_SECTION_GIT)).toBeVisible()
        await expect(byTestId(window, TEST_IDS.SETTINGS_SECTION_LOGGING)).toBeVisible()
        await expect(byTestId(window, TEST_IDS.SETTINGS_SECTION_TRANSCRIPTION)).toBeVisible()
        await expect(byTestId(window, TEST_IDS.SETTINGS_SECTION_HTML_PREVIEW)).toBeVisible()

        await closeSettings(window)
      })
    } finally {
      await sandbox.cleanup()
    }
  })

  test('should close on Escape', async () => {
    const sandbox = await createSettingsSandbox('settings-escape')
    try {
      await withApp(sandbox, async (window) => {
        await openSettings(window)
        await window.keyboard.press('Escape')
        await waitForTestIdHidden(window, TEST_IDS.SETTINGS_OVERLAY, { timeout: 10_000 })
      })
    } finally {
      await sandbox.cleanup()
    }
  })

  test('should enable the polling interval only while polling is on', async () => {
    const sandbox = await createSettingsSandbox('settings-polling-dep')
    try {
      await withApp(sandbox, async (window) => {
        await openSettings(window)

        const toggle = byTestId(window, TEST_IDS.SETTINGS_TOGGLE_POLLING)
        const interval = byTestId(window, TEST_IDS.SETTINGS_SELECT_POLLING_INTERVAL)

        // Polling is on by default, so the interval is meaningful.
        await expect(toggle).toBeChecked()
        await expect(interval).toBeEnabled()

        await toggle.uncheck()

        // An interval that stays editable while polling is off offers a
        // setting that does nothing.
        await expect(interval).toBeDisabled()
      })
    } finally {
      await sandbox.cleanup()
    }
  })
})

test.describe('Settings overlay – persistence across a restart', () => {
  test('should remember the editor line-break preference', async () => {
    const sandbox = await createSettingsSandbox('settings-linebreaks')
    try {
      await withApp(sandbox, async (window) => {
        await openSettings(window)
        const toggle = byTestId(window, TEST_IDS.SETTINGS_TOGGLE_LINE_BREAKS)
        await expect(toggle).not.toBeChecked()
        await toggle.check()
        await expect(toggle).toBeChecked()
        await closeSettings(window)
      })

      await withApp(sandbox, async (window) => {
        await openSettings(window)
        await expect(byTestId(window, TEST_IDS.SETTINGS_TOGGLE_LINE_BREAKS)).toBeChecked({
          timeout: 10_000
        })
      })
    } finally {
      await sandbox.cleanup()
    }
  })

  test('should remember that git polling was turned off', async () => {
    const sandbox = await createSettingsSandbox('settings-polling')
    try {
      await withApp(sandbox, async (window) => {
        await openSettings(window)
        const toggle = byTestId(window, TEST_IDS.SETTINGS_TOGGLE_POLLING)
        await expect(toggle).toBeChecked()
        await toggle.uncheck()
        await expect(toggle).not.toBeChecked()
        await closeSettings(window)
      })

      await withApp(sandbox, async (window) => {
        await openSettings(window)
        await expect(byTestId(window, TEST_IDS.SETTINGS_TOGGLE_POLLING)).not.toBeChecked({
          timeout: 10_000
        })
      })
    } finally {
      await sandbox.cleanup()
    }
  })

  test('should remember the chosen log level', async () => {
    const sandbox = await createSettingsSandbox('settings-loglevel')
    try {
      await withApp(sandbox, async (window) => {
        await openSettings(window)
        const select = byTestId(window, TEST_IDS.SETTINGS_SELECT_LOG_LEVEL)
        await select.selectOption('warn')
        await expect(select).toHaveValue('warn')
        await closeSettings(window)
      })

      await withApp(sandbox, async (window) => {
        await openSettings(window)
        await expect(byTestId(window, TEST_IDS.SETTINGS_SELECT_LOG_LEVEL)).toHaveValue('warn', {
          timeout: 10_000
        })
      })
    } finally {
      await sandbox.cleanup()
    }
  })

  test('should remember that the HTML preview was disabled', async () => {
    const sandbox = await createSettingsSandbox('settings-htmlpreview')
    try {
      let wasChecked = false

      await withApp(sandbox, async (window) => {
        await openSettings(window)
        const toggle = byTestId(window, TEST_IDS.SETTINGS_TOGGLE_HTML_PREVIEW)
        wasChecked = await toggle.isChecked()
        if (wasChecked) {
          await toggle.uncheck()
        } else {
          await toggle.check()
        }
        await closeSettings(window)

        await openSettings(window)
        // Reopening the overlay in the same run must already show the new
        // value — a store that only updates on reload would hide the bug the
        // restart assertion below is really about.
        await expect(byTestId(window, TEST_IDS.SETTINGS_TOGGLE_HTML_PREVIEW)).toBeChecked({
          checked: !wasChecked
        })
        await closeSettings(window)
      })

      // Sequential, never nested: two Electron instances sharing one
      // `--user-data-dir` would race on the settings store.
      await withApp(sandbox, async (window) => {
        await openSettings(window)
        await expect(byTestId(window, TEST_IDS.SETTINGS_TOGGLE_HTML_PREVIEW)).toBeChecked({
          checked: !wasChecked,
          timeout: 10_000
        })
      })
    } finally {
      await sandbox.cleanup()
    }
  })
})

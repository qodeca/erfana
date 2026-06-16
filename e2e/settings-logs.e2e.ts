// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E tests for the "Logs folder" feature in the Settings overlay.
 *
 * Verifies the Logging section displays the logs folder path
 * and provides an "Open" button to reveal the folder.
 */

import { sep } from 'node:path'

import { test, expect } from './fixtures/index'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'
import { openSettings } from './utils/helpers'

test.describe('Settings overlay – Logs folder', () => {
  test('should display the Logging section with logs folder path', async ({ window }) => {
    await openSettings(window)

    // Verify the Logging section is visible
    const loggingSection = byTestId(window, TEST_IDS.SETTINGS_SECTION_LOGGING)
    await expect(loggingSection).toBeVisible()

    // Verify the logs folder path is displayed and contains the expected path segment
    const logsFolderPath = byTestId(window, TEST_IDS.SETTINGS_LOGS_FOLDER_PATH)
    await expect(logsFolderPath).toBeVisible()
    // Use platform separator – macOS/Linux render `.erfana/logs`,
    // Windows renders `.erfana\logs`.
    await expect(logsFolderPath).toContainText(`.erfana${sep}logs`)
  })

  test('should display a clickable Open button for logs folder', async ({ window }) => {
    await openSettings(window)

    // Verify the Open button exists and is enabled
    const openLogsBtn = byTestId(window, TEST_IDS.SETTINGS_BTN_OPEN_LOGS)
    await expect(openLogsBtn).toBeVisible()
    await expect(openLogsBtn).toBeEnabled()

    // Click the button – verify it does not crash the app
    // (We cannot verify Finder/Explorer opens; shell.openPath is a system call)
    await openLogsBtn.click()

    // After clicking, the settings overlay should still be visible (no crash, no unexpected close)
    const settingsOverlay = byTestId(window, TEST_IDS.SETTINGS_OVERLAY)
    await expect(settingsOverlay).toBeVisible()
  })
})

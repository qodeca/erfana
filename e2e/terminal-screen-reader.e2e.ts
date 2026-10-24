// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal screen-reader mode (lens review [23]), end to end: the Settings
 * override reaches the running xterm instance, which adds or removes its
 * accessibility tree (`.xterm-accessibility-tree`, the text a screen reader
 * reads) without a restart.
 *
 * Auto follows what this machine's OS reports, so the test asks main for that
 * state instead of assuming no screen reader is running.
 *
 * The fixtures' home is worker-scoped, so the setting is put back to Auto at
 * the end; otherwise the next test in this worker would start with it on.
 */
import { test, expect } from './fixtures/index'
import { TerminalPage } from './pages/terminal.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'
import { openSettings, closeSettings } from './utils/helpers'
import type { Api } from '../src/preload/index'

test.describe('terminal screen-reader mode', () => {
  test('Settings On and Off switch the running terminal\'s accessibility tree live', async ({ windowWithTestProject: page }) => {
    const terminal = new TerminalPage(page)
    await terminal.open()
    await terminal.waitForPrompt()

    const tree = byTestId(page, TEST_IDS.TERMINAL_PANEL).locator('.xterm-accessibility-tree')
    const select = byTestId(page, TEST_IDS.SETTINGS_SELECT_SCREEN_READER_MODE)
    const osReportsScreenReader = await page.evaluate(
      async () => (await (window.api as Api).terminal.getScreenReaderSupport()).enabled
    )

    try {
      // Auto: whatever the OS reports on this machine
      await expect(tree).toHaveCount(osReportsScreenReader ? 1 : 0)

      await openSettings(page)
      await expect(select).toHaveValue('auto')
      await select.selectOption('on')
      await closeSettings(page)

      await expect(tree).toHaveCount(1)
      // The shell prompt is in the tree as text, which is what a screen reader reads
      await expect.poll(async () => ((await tree.textContent()) ?? '').trim().length).toBeGreaterThan(0)

      await openSettings(page)
      await select.selectOption('off')
      await closeSettings(page)

      await expect(tree).toHaveCount(0)
    } finally {
      await page.evaluate(() => (window.api as Api).globalSettings.set('terminal', { screenReaderMode: 'auto' }))
    }
  })
})

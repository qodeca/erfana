// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser pick and send, renderer UI (spec 025 commit 19): the pick
 * row and its toggle, the prompt-actions panel over the page's still image,
 * Esc, the target chooser, the shell guard's banner, and the still image
 * under More and the address suggestions (ADR 0011).
 *
 * Driven through Erfana's DOM (`BrowserPickUi`); the page's pointer and keys
 * through the main-side input hooks. Condition-based waits only. Each surface
 * is saved under `test-results/browser-tab-ui/` for the visual check (not
 * committed).
 *
 * Titles carry no AC id: these prove the renderer half only; the main-side
 * halves stay in browser-pick and browser-capture.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { BrowserTabUiPage, type BrowserPanelUi } from './pages/browser-tab-ui.page'
import { BrowserPickUi } from './pages/browser-pick-ui.page'

const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results', 'browser-tab-ui')
const WAIT_MS = 15_000

async function shot(window: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  await window.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) })
}

/** Load `url` through the address bar and wait until the page takes input. */
async function loadPage(panel: BrowserPanelUi, url: string): Promise<void> {
  await panel.load(url)
  await panel.waitForState({ committedUrl: url, loading: false })
  const page = await panel.page()
  await page.waitForLoaded(url)
  await page.waitForInputReady()
}

test.describe('built-in browser pick and send (renderer UI)', () => {
  test('the pick row toggles pick mode; a pick opens the panel over the still image; Esc closes it and picking goes on', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const pick = new BrowserPickUi(panel, appWithTestProject)
    await expect(pick.row).toBeVisible()
    await expect(pick.pickButton).toHaveAttribute('aria-disabled', 'true')

    await loadPage(panel, browserServers.sites.static.url('/elements.html'))
    await expect(pick.pickButton).not.toHaveAttribute('aria-disabled', 'true')
    await pick.pickButton.click()
    await expect(pick.pickButton).toHaveAttribute('aria-pressed', 'true')
    await expect(pick.status).toContainText('Picking')
    await shot(windowWithTestProject, 'pick-row-on')

    await pick.confirm('#save-label', 'span#save-label ')
    await expect(pick.still).toBeVisible()
    await expect(pick.actions.getByRole('navigation', { name: 'Element path' })).toContainText('span#save-label')
    await expect(pick.action('Explain')).toBeFocused()
    await shot(windowWithTestProject, 'pick-panel-over-still')

    await windowWithTestProject.keyboard.press('Escape')
    await expect(pick.actions).toHaveCount(0, { timeout: WAIT_MS })
    await expect(pick.still).toHaveCount(0, { timeout: WAIT_MS })
    await expect(pick.pickButton).toHaveAttribute('aria-pressed', 'true')
    await pick.pickButton.click()
    await expect(pick.pickButton).toHaveAttribute('aria-pressed', 'false')
  })

  test('Ask… opens the dialog in place of the panel; Back returns; the target chooser lists the terminal; a send to a non-agent shows the guard', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const pick = new BrowserPickUi(panel, appWithTestProject)
    await loadPage(panel, browserServers.sites.static.url('/elements.html'))

    await pick.target.click()
    const menu = panel.menu('Target terminal')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Open last capture' })).toHaveAttribute('aria-disabled', 'true')
    await expect(pick.still).toBeVisible()
    await expect(menu).toHaveCSS('opacity', '1')
    await shot(windowWithTestProject, 'pick-target-menu')
    await windowWithTestProject.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(pick.still).toHaveCount(0, { timeout: WAIT_MS })

    await pick.pickButton.click()
    await pick.confirm('#save-label', 'span#save-label ')
    await pick.action('Ask').click()
    await expect(pick.dialog).toBeVisible()
    await expect(pick.actions).toHaveCount(0)
    const field = pick.dialog.getByRole('textbox', { name: 'Your question' })
    await expect(field).toBeFocused()
    await pick.dialog.getByRole('button', { name: 'Send' }).click()
    await expect(pick.dialog.getByRole('alert')).toHaveText('Type your question before sending.')
    await shot(windowWithTestProject, 'pick-dialog-empty')
    await pick.dialog.getByRole('button', { name: 'Back to actions' }).click()
    await expect(pick.actions).toBeVisible()

    // The app's terminal (or none) runs no agent: main's guard refuses and the panel keeps the pick.
    await pick.action('Explain').click()
    await expect(pick.actions.getByRole('alert')).toContainText(/^No agent is running/, { timeout: WAIT_MS })
    await expect(pick.actions).toBeVisible()
    await shot(windowWithTestProject, 'pick-guard')
    await windowWithTestProject.keyboard.press('Escape')
    await expect(pick.actions).toHaveCount(0, { timeout: WAIT_MS })
  })

  test('More and the address suggestions open over the page\'s still image, which goes when they close', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const pick = new BrowserPickUi(panel, appWithTestProject)
    await loadPage(panel, browserServers.sites.static.url('/elements.html'))

    await panel.tool('More').click()
    await expect(panel.menu('More')).toBeVisible()
    await expect(pick.still).toBeVisible()
    await expect(panel.menu('More')).toHaveCSS('opacity', '1')
    await shot(windowWithTestProject, 'more-over-still')
    await windowWithTestProject.keyboard.press('Escape')
    await expect(panel.menu('More')).toHaveCount(0)
    await expect(pick.still).toHaveCount(0, { timeout: WAIT_MS })

    await panel.addressBar.click()
    await panel.addressBar.fill('how to pick an element')
    const list = panel.root.getByRole('listbox', { name: 'Suggestions' })
    await expect(list).toBeVisible({ timeout: WAIT_MS })
    await expect(list.getByRole('option', { name: 'Search DuckDuckGo for "how to pick an element"' })).toBeVisible()
    await expect(panel.addressBar).toHaveAttribute('aria-expanded', 'true')
    await expect(pick.still).toBeVisible()
    await shot(windowWithTestProject, 'suggestions-over-still')
    await panel.addressBar.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(pick.still).toHaveCount(0, { timeout: WAIT_MS })
  })
})

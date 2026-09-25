// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `window`: the quit confirmation, a tab's right-click menu and the
 * activity bars. Guide pages: how-to/work-in-several-windows.md,
 * reference/the-erfana-window.md, reference/menus.md.
 */

import { expect, test } from '@playwright/test'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { blurAll, launch, openFile, openProject, visible } from '../lib/app'
import { anySelected, drawTitleTooltip, removeDrawnTooltips, shot } from '../lib/shots'
import { ptyLength, typeLine, waitForShellPrompt } from '../lib/terminal'

const ROWS = ['several-windows/quit-confirmation', 'the-window/tab-menu', 'the-window/activity-bars']

test('window', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch()
  const { page, app } = cap
  try {
    await openProject(cap)
    await openFile(cap, 'handbook/getting-involved.md')
    await openFile(cap, 'handbook/compost-guide.md')
    await blurAll(page)
    // Both activity-bar tooltips at once, for the picture (the app shows one
    // at a time; the row's state says so). Drawn: see drawTitleTooltip.
    await drawTitleTooltip(page, page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL), 'capture-tip-terminal')
    await drawTitleTooltip(page, page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_FILES), 'capture-tip-project')
    await shot(cap, 'the-window/activity-bars', { keepHover: true })
    await removeDrawnTooltips(page)

    const tab = page.locator('.editor-tab', { hasText: 'compost-guide.md' })
    await tab.click({ button: 'right' })
    const menu = page.getByTestId(TEST_IDS.CONTEXT_MENU)
    await expect(menu).toBeVisible()
    await shot(cap, 'the-window/tab-menu', { crop: [tab, menu], pad: 12 })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // Quit with an unsaved file and a terminal typed into moments ago. The
    // quit request is the one the main process sends on Cmd+Q; Cancel keeps
    // the app running.
    const from = await ptyLength(page)
    await typeLine(page, 'ls handbook')
    await waitForShellPrompt(page, { from })
    await openFile(cap, 'handbook/getting-involved.md', 'split')
    await visible(page, TEST_IDS.EDITOR_MONACO).locator('.view-line').first().click({ position: { x: 1, y: 4 } })
    await page.keyboard.press('End')
    await page.keyboard.type(' (draft)')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('quit:requested', { reason: 'close' }))
    const dialog = page.getByTestId(TEST_IDS.DIALOG_CONTAINER)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('active terminal')
    await shot(cap, 'several-windows/quit-confirmation', { crop: dialog, pad: 16 })
    await page.getByTestId(TEST_IDS.DIALOG_BTN_CANCEL).click()
  } finally {
    await cap.close()
  }
})

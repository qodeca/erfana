// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: one Escape closes only the topmost dialog or overlay (#229).
 *
 * Before the shared overlay stack, every open dialog and the Settings overlay
 * listened for Escape on `document` themselves, so one press closed all of
 * them – in the shipping case, dismissing the Cmd+Q quit prompt also cancelled
 * a running transcription underneath it.
 *
 * The stacked confirm prompts are raised through the app's own imperative
 * dialog API (`showGlobalDialog` in `dialogService.ts`, which listens for the
 * `app:dialog` window event), so they are real DialogManager ConfirmDialogs at
 * the z-indices the app hands out – the same path the quit prompt takes.
 */

import { test, expect } from './fixtures/index'
import type { Page } from '@playwright/test'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'
import { DialogPage } from './pages/dialog.page'
import { ProjectTreePage } from './pages/project-tree.page'

/** Raise a ConfirmDialog through the app's imperative dialog API. */
async function raiseConfirm(page: Page, title: string): Promise<void> {
  await page.evaluate((dialogTitle) => {
    window.dispatchEvent(
      new CustomEvent('app:dialog', {
        detail: { type: 'confirm', config: { title: dialogTitle, message: `${dialogTitle}?` } }
      })
    )
  }, title)
}

test.describe('Escape closes only the topmost dialog (#229)', () => {
  test('Escape on a prompt over Settings leaves Settings open', async ({ window }) => {
    const dialog = new DialogPage(window)
    const settings = byTestId(window, TEST_IDS.SETTINGS_OVERLAY)
    await new ProjectTreePage(window).openSettings()

    await raiseConfirm(window, 'Stacked prompt')
    await dialog.waitForConfirm('Stacked prompt')

    await dialog.dismissWithEscape()
    await expect(settings).toBeVisible()

    // The next Escape belongs to Settings, now the topmost overlay.
    await window.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
  })

  test('Escape on two stacked prompts closes them one at a time', async ({ window }) => {
    const dialog = new DialogPage(window)

    await raiseConfirm(window, 'Lower prompt')
    await dialog.waitForConfirm('Lower prompt')
    await raiseConfirm(window, 'Upper prompt')
    await expect(dialog.confirmDialog()).toHaveCount(2)

    await window.keyboard.press('Escape')
    await expect(dialog.confirmDialog()).toHaveCount(1)
    await expect(dialog.confirmTitle()).toHaveText('Lower prompt')

    await dialog.dismissWithEscape()
  })
})

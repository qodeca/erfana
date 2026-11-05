// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Reach a toolbar button wherever the toolbar overflow put it (#451, #461, #462).
 *
 * A `ToolbarOverflow` row renders only the buttons that fit; the rest are items
 * of its "More actions" (…) menu, with the row button's test id plus
 * `-overflow-item`. Which side a button lands on depends on the panel width –
 * at the default window the terminal header already holds Lock scroll, Restart
 * and Scroll to bottom in the menu (#462), and the Markdown toolbar Preview only
 * and both exports (#461) – so a test that means "use this action" goes through
 * these helpers instead of clicking the row button directly.
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { TOOLBAR_OVERFLOW_TEST_IDS } from '../../src/renderer/src/constants/toolbarOverflowTestids'
import { byTestId } from './locators'

/** The menu item that stands for row button `testId` once it has moved. */
export function overflowItem(page: Page, testId: string): Locator {
  return byTestId(page, `${testId}-overflow-item`)
}

/**
 * Wait until `toolbar` shows `testId` either as a row button or behind its
 * "More actions" button, and say which.
 */
async function placement(page: Page, toolbar: Locator, testId: string): Promise<'row' | 'menu'> {
  const inRow = byTestId(page, testId)
  const more = toolbar.getByTestId(TOOLBAR_OVERFLOW_TEST_IDS.MORE)
  await expect(inRow.or(more).first()).toBeVisible({ timeout: 10_000 })
  return (await inRow.count()) > 0 ? 'row' : 'menu'
}

/** Open `toolbar`'s "More actions" menu and return the item for `testId`. */
async function openItem(page: Page, toolbar: Locator, testId: string): Promise<Locator> {
  await toolbar.getByTestId(TOOLBAR_OVERFLOW_TEST_IDS.MORE).click()
  const item = overflowItem(page, testId)
  await expect(item).toBeVisible({ timeout: 10_000 })
  return item
}

/** Click toolbar action `testId` in `toolbar`, from the row or from its "More actions" menu. */
export async function clickToolbarAction(page: Page, toolbar: Locator, testId: string): Promise<void> {
  if ((await placement(page, toolbar, testId)) === 'row') {
    await byTestId(page, testId).click()
    return
  }
  await (await openItem(page, toolbar, testId)).click()
}

/**
 * Read a state of toolbar action `testId` – pressed / checked, or disabled –
 * from the row button, or from its menu item (the menu is opened and closed
 * again with Escape).
 */
export async function readToolbarAction(
  page: Page,
  toolbar: Locator,
  testId: string
): Promise<{ checked: boolean; disabled: boolean }> {
  if ((await placement(page, toolbar, testId)) === 'row') {
    const button = byTestId(page, testId)
    const cls = (await button.getAttribute('class')) ?? ''
    return {
      checked: (await button.getAttribute('aria-pressed')) === 'true' || cls.split(/\s+/).includes('active'),
      disabled: await button.isDisabled()
    }
  }
  const item = await openItem(page, toolbar, testId)
  const state = {
    checked: (await item.getAttribute('aria-checked')) === 'true',
    disabled: (await item.getAttribute('aria-disabled')) === 'true'
  }
  await page.keyboard.press('Escape')
  await expect(item).toHaveCount(0)
  return state
}

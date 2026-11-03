// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's pick and send UI (spec 025, commit 19): the pick
 * row, the prompt-actions panel and the instruction dialog over the page's
 * still image, and the target chooser – driven the way a user drives them,
 * through Erfana's DOM, by role and accessible name.
 *
 * The page's own pointer and keys go through {@link PickDriver} (main-side
 * input hooks): the native page is not part of Erfana's DOM. Condition-based
 * waits only.
 *
 * ```ts
 * const pick = new BrowserPickUi(panel, app)
 * await pick.pickButton.click()
 * await pick.confirm('#save-label', 'span#save-label ')
 * ```
 */
import { expect, type ElectronApplication, type Locator } from '@playwright/test'
import { BROWSER_TEST_IDS } from '../../src/renderer/src/components/Panels/BrowserPanel/browserTestIds'
import type { BrowserPanelUi } from './browser-tab-ui.page'
import { PickDriver, PICK_WAIT_MS } from './browser-pick.page'

export class BrowserPickUi {
  constructor(
    readonly panel: BrowserPanelUi,
    private readonly app: ElectronApplication
  ) {}

  get row(): Locator {
    return this.panel.root.getByTestId(BROWSER_TEST_IDS.PICK_ROW)
  }

  get pickButton(): Locator {
    return this.row.getByRole('button', { name: 'Pick element', exact: true })
  }

  /** The pick row's status slot (a polite live region). */
  get status(): Locator {
    return this.panel.root.getByTestId(BROWSER_TEST_IDS.PICK_STATUS)
  }

  /** The pick row's target button. */
  get target(): Locator {
    return this.row.getByRole('button', { name: /target terminal/ })
  }

  get still(): Locator {
    return this.panel.root.getByTestId(BROWSER_TEST_IDS.STILL)
  }

  get actions(): Locator {
    return this.panel.root.getByTestId(BROWSER_TEST_IDS.PROMPT_ACTIONS)
  }

  get dialog(): Locator {
    return this.panel.root.getByTestId(BROWSER_TEST_IDS.INSTRUCTION_DIALOG)
  }

  /** An action of the panel (Explain, Ask, Change, Prompt). */
  action(name: string): Locator {
    return this.actions.getByRole('button', { name, exact: true })
  }

  /** The pointer and keys inside the page. */
  async driver(): Promise<PickDriver> {
    return new PickDriver(this.app, this.panel.window, await this.panel.page())
  }

  /** With pick mode on, hover `selector`, press Return in the page, and wait for the panel. */
  async confirm(selector: string, labelPrefix: string): Promise<void> {
    const driver = await this.driver()
    await expect.poll(async () => (await driver.state()).active, { timeout: PICK_WAIT_MS }).toBe(true)
    await driver.hover(await driver.rect(selector), labelPrefix)
    await driver.key('Return')
    await expect(this.actions).toBeVisible({ timeout: PICK_WAIT_MS })
  }
}

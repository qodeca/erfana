/**
 * Project tree Page Object Model.
 *
 * Encapsulates tree navigation, file clicks, and folder toggling.
 * Does NOT include openProject/openProjectViaUI – those require
 * ElectronApplication and remain standalone functions in helpers.ts.
 *
 * @see e2e/utils/helpers.ts - Backward-compatible adapter
 */

import { Page, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId, byDynamicTestId, waitForTestId, waitForTestIdHidden } from '../utils/locators'

export class ProjectTreePage {
  constructor(private readonly page: Page) {}

  async openProjectTree(): Promise<void> {
    await byTestId(this.page, TEST_IDS.ACTIVITY_BAR_BTN_FILES).click()
    await waitForTestId(this.page, TEST_IDS.PROJECT_TREE)
  }

  // TODO(spec-018): Extract to SettingsPage or AppPage when scope grows
  async openSettings(): Promise<void> {
    await byTestId(this.page, TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).click()
    await waitForTestId(this.page, TEST_IDS.SETTINGS_OVERLAY)
  }

  async closeSettings(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await waitForTestIdHidden(this.page, TEST_IDS.SETTINGS_OVERLAY)
  }

  async clickFileInTree(filePath: string): Promise<void> {
    const node = byDynamicTestId(this.page, TEST_IDS.PROJECT_TREE_NODE, filePath)
    await node.click()
  }

  async toggleFolder(folderPath: string): Promise<void> {
    const toggle = byDynamicTestId(this.page, TEST_IDS.PROJECT_TREE_TOGGLE, folderPath)
    await toggle.click()
  }

  async clickFileByName(fileName: string): Promise<void> {
    const fileNode = this.page
      .locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
      .filter({ hasText: fileName })

    await expect(fileNode).toBeVisible({ timeout: 5000 })
    await fileNode.click()

    await waitForTestId(this.page, TEST_IDS.EDITOR_CONTENT, { timeout: 10000 })
  }
}

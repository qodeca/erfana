// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Mermaid diagram Page Object Model.
 *
 * Encapsulates diagram toolbar, viewer, and zoom interactions.
 *
 * @see e2e/utils/helpers.ts - Backward-compatible adapter
 */

import { Page, Locator } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId, waitForTestId, waitForTestIdHidden } from '../utils/locators'

export class MermaidPage {
  constructor(private readonly page: Page) {}

  getToolbar(): Locator {
    return byTestId(this.page, TEST_IDS.MERMAID_TOOLBAR)
  }

  getViewer(): Locator {
    return byTestId(this.page, TEST_IDS.DIAGRAM_VIEWER)
  }

  async hoverDiagram(index = 0): Promise<void> {
    const preview = byTestId(this.page, TEST_IDS.EDITOR_PREVIEW)
    const diagram = preview.locator('.mermaid').nth(index)
    await diagram.hover()
    await waitForTestId(this.page, TEST_IDS.MERMAID_TOOLBAR)
  }

  async setDirection(direction: 'TB' | 'BT' | 'LR' | 'RL'): Promise<void> {
    await byTestId(this.page, TEST_IDS.MERMAID_DIRECTION_BTN).click()
    await byTestId(this.page, `${TEST_IDS.MERMAID_DIRECTION_BTN}-${direction}`).click()
  }

  async openViewer(): Promise<void> {
    await byTestId(this.page, TEST_IDS.MERMAID_BTN_EXPAND).click()
    await waitForTestId(this.page, TEST_IDS.DIAGRAM_VIEWER)
  }

  async closeViewer(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await waitForTestIdHidden(this.page, TEST_IDS.DIAGRAM_VIEWER)
  }

  async zoomIn(): Promise<void> {
    await byTestId(this.page, TEST_IDS.CHAT_BTN_ZOOM_IN).click()
  }

  async zoomOut(): Promise<void> {
    await byTestId(this.page, TEST_IDS.CHAT_BTN_ZOOM_OUT).click()
  }

  async fitToView(): Promise<void> {
    await byTestId(this.page, TEST_IDS.CHAT_BTN_FIT).click()
  }

  async resetZoom(): Promise<void> {
    await byTestId(this.page, TEST_IDS.CHAT_BTN_RESET).click()
  }

  async openChat(): Promise<void> {
    await byTestId(this.page, TEST_IDS.DIAGRAM_VIEWER_BTN_CHAT).click()
    await waitForTestId(this.page, TEST_IDS.CHAT_PANEL)
  }

  async sendChatMessage(message: string): Promise<void> {
    const textarea = byTestId(this.page, TEST_IDS.CHAT_TEXTAREA)
    await textarea.fill(message)
    await byTestId(this.page, TEST_IDS.CHAT_BTN_SEND).click()
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Monaco editor Page Object Model.
 *
 * Encapsulates editor interactions with KeyboardHelper dependency injection
 * for platform-aware shortcuts.
 *
 * @see e2e/utils/helpers.ts - Backward-compatible adapter
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { KeyboardHelper } from './keyboard.helper'
import { byTestId, waitForTestId, waitForTestIdHidden } from '../utils/locators'

export class MonacoPage {
  constructor(
    private readonly page: Page,
    private readonly keyboard: KeyboardHelper
  ) {}

  getEditor(): Locator {
    return byTestId(this.page, TEST_IDS.EDITOR_MONACO)
  }

  async focus(): Promise<void> {
    const editor = this.getEditor().locator('.monaco-editor')
    await editor.click({ force: true })
    const cursor = this.getEditor().locator('.monaco-editor .cursor')
    await expect(cursor).toBeVisible({ timeout: 2000 })
  }

  async setContent(content: string): Promise<void> {
    await this.focus()
    await this.keyboard.selectAll()
    await this.page.keyboard.type(content)
  }

  async appendContent(content: string): Promise<void> {
    await this.focus()
    const modifier = await this.keyboard.getModifier()
    await this.page.keyboard.press(`${modifier}+End`)
    await this.page.keyboard.type(content)
  }

  async getContent(): Promise<string> {
    await this.focus()
    await this.keyboard.selectAll()
    await this.keyboard.copy()
    return this.page.evaluate(() => navigator.clipboard.readText())
  }

  async selectAll(): Promise<void> {
    await this.focus()
    await this.keyboard.selectAll()
  }

  async openCommandPalette(): Promise<void> {
    await this.focus()
    await this.page.keyboard.press('F1')
  }

  async executeCommand(command: string): Promise<void> {
    await this.openCommandPalette()
    await this.page.keyboard.type(command)
    await this.page.keyboard.press('Enter')
  }

  async openSearch(): Promise<void> {
    await this.focus()
    await this.keyboard.find()
    await waitForTestId(this.page, TEST_IDS.SEARCH_BAR)
  }

  async closeSearch(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await waitForTestIdHidden(this.page, TEST_IDS.SEARCH_BAR)
  }

  async search(query: string): Promise<void> {
    await this.openSearch()
    const searchInput = byTestId(this.page, TEST_IDS.SEARCH_BAR_INPUT)
    await searchInput.fill(query)
  }

  async nextMatch(): Promise<void> {
    await byTestId(this.page, TEST_IDS.SEARCH_BAR_BTN_NEXT).click()
  }

  async prevMatch(): Promise<void> {
    await byTestId(this.page, TEST_IDS.SEARCH_BAR_BTN_PREV).click()
  }

  async waitForReady(): Promise<void> {
    await waitForTestId(this.page, TEST_IDS.EDITOR_MONACO)
    const textarea = this.getTextArea()
    await expect(textarea).toBeAttached({ timeout: 10000 })
  }

  getTextArea(): Locator {
    return this.getEditor().locator('.monaco-editor textarea')
  }

  /**
   * The rendered editor text, read straight from Monaco's own line elements.
   *
   * Prefer this over {@link getContent} whenever the assertion is about
   * content that the APP changed (a reload from disk, a tab switch, a
   * programmatic edit). `getContent` routes through select-all + copy, and
   * this app deliberately remaps copy to the MAIN-process clipboard
   * (`monacoClipboardCommands`, so the sandbox stays on) — which means the
   * renderer's `navigator.clipboard.readText()` can hand back the PREVIOUS
   * copy. A stale read makes an assertion pass against the old buffer, which
   * is worse than failing.
   *
   * The trade-off is that Monaco virtualizes: only lines near the viewport are
   * in the DOM. That is fine for asserting a phrase in a short fixture, and
   * wrong for asserting a whole long document.
   *
   * @returns Visible line text, newline-joined
   */
  async visibleText(): Promise<string> {
    // Monaco pads with non-breaking spaces; normalise them so a plain-text
    // assertion matches. Written as an escape, not a literal — a raw NBSP in
    // source trips the `no-irregular-whitespace` lint rule.
    const text = await this.getEditor().locator('.view-lines').innerText()
    return text.replace(/\u00a0/g, ' ')
  }

  async waitForCursor(): Promise<void> {
    const cursor = this.getEditor().locator('.monaco-editor .cursor')
    await expect(cursor).toBeVisible({ timeout: 2000 })
  }
}

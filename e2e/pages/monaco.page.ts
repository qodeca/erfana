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
    // `force` skips Playwright's own visibility wait, and a click on a Monaco that
    // has not laid out yet lands nowhere. Wait for it explicitly: on a slow host
    // (Linux container) it takes longer than the click needs to arrive.
    await expect(editor).toBeVisible({ timeout: 4000 })
    // Visible is not laid out. Right after a view-mode switch Monaco is still
    // building its text area, and on a slow Windows host a click that lands then
    // presses on the bare frame and releases over the freshly laid-out lines,
    // and Monaco turns that into a selection of all of line 1. Wait until
    // the text area exists and holds still for two rendered frames – the frames
    // in which Monaco applies its own layout. A window covered by another one
    // renders no frames on Windows, so bring it to the front first, and give
    // up on a check after 1 s so the poll retries instead of hanging.
    await this.page.bringToFront()
    await expect
      .poll(
        () =>
          editor.evaluate(
            (el) =>
              new Promise<boolean>((resolve) => {
                const lines = el.querySelector('.view-lines')
                if (!lines) return resolve(false)
                const a = lines.getBoundingClientRect()
                setTimeout(() => resolve(false), 1000)
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    const b = lines.getBoundingClientRect()
                    resolve(
                      a.width > 0 && a.height > 0 &&
                        a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
                    )
                  })
                )
              })
          ),
        { timeout: 10_000 }
      )
      .toBe(true)
    // `focused` is Monaco's own focus class. The cursor element is not a stable
    // signal: it blinks (visibility toggles every ~500 ms), and on Linux/xvfb a
    // 2 s `toBeVisible` poll can land only on hidden phases. A click that arrives
    // while Monaco is still re-laying out is lost, so click again until it takes.
    await expect(async () => {
      await editor.click({ force: true })
      await expect(editor).toHaveClass(/\bfocused\b/, { timeout: 1000 })
    }).toPass({ timeout: 4000 })
  }

  // Both writers use `insertText`, NOT `keyboard.type`. `type()` sends one
  // keystroke per character, and Monaco drops some of them during its re-layout
  // cycles — reliably so on Windows, where a run of this suite turned
  // 'manually saved' into 'mnulysvd'. `insertText` delivers the whole string as
  // a single input event, the way a paste does. Same reasoning, and the same
  // remedy, as third-party-components.e2e.ts.
  async setContent(content: string): Promise<void> {
    await this.focus()
    await this.keyboard.selectAll()
    await this.page.keyboard.insertText(content)
  }

  async appendContent(content: string): Promise<void> {
    await this.focus()
    const modifier = await this.keyboard.getModifier()
    await this.page.keyboard.press(`${modifier}+End`)
    await this.page.keyboard.insertText(content)
  }

  /**
   * Insert text at the cursor and return at once.
   *
   * Unlike {@link appendContent} it does not click, wait for the cursor or move
   * to the end of the document: the editor must already have focus (a prior
   * `focus()` or `appendContent()`). For specs that act within a fraction of a
   * second of the edit, where the wait itself would let the 2 s autosave win.
   */
  async typeWithoutWaiting(content: string): Promise<void> {
    await this.page.keyboard.insertText(content)
  }

  /**
   * The whole document, read straight from the Monaco model of this editor.
   *
   * Through the app's e2e test hook (`window.__erfanaTest.editorValue`,
   * installed only for an unpackaged app launched with
   * `ERFANA_E2E_TEST_HOOKS=1`, which every fixture launch sets), scoped to the
   * element {@link getEditor} resolves. Unlike the select-all + copy +
   * clipboard read it replaces (lens review finding 37), it does not touch the
   * focus, the selection or the machine-wide clipboard, so it can neither
   * return a stale copy nor disturb what the test is doing. Not virtualised
   * either: every line is in the model, unlike {@link visibleText}.
   *
   * @throws when no live editor is in the container (the hook is off, or the
   * editor has not mounted yet) – a thrown read makes an `expect.poll` try
   * again rather than pass on an empty string.
   */
  async getContent(): Promise<string> {
    const value = await this.getEditor().evaluate((el) => window.__erfanaTest?.editorValue(el) ?? null)
    if (value === null) {
      throw new Error(
        'MonacoPage.getContent: no live Monaco model in the editor (not mounted yet, or the e2e test hooks are off – ERFANA_E2E_TEST_HOOKS=1)'
      )
    }
    return value
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
   * What the user SEES, as opposed to {@link getContent}, which reads the
   * model. Use it when the assertion is about the rendered lines.
   *
   * The trade-off is that Monaco virtualizes: only lines near the viewport are
   * in the DOM. That is fine for asserting a phrase in a short fixture, and
   * wrong for asserting a whole long document – read the model with
   * {@link getContent} for that.
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
    // Attached in a focused editor, not visible: the cursor blinks, so its visibility
    // flips by design.
    const cursor = this.getEditor().locator('.monaco-editor.focused .cursor')
    await expect(cursor).toBeAttached({ timeout: 2000 })
  }
}

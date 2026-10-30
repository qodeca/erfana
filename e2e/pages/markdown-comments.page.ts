// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments Page Object Model (spec 024 commit 13).
 *
 * Unlike the HTML Preview, the Markdown Preview is drawn in the renderer's
 * own DOM: targets are real `[data-line-start]` elements in
 * `.markdown-preview-content`, and the outline, the icons and the mode tab sit
 * in the overlay layer beside the preview, never inside it (024-FR-024). So
 * every step here is a plain Playwright action on the window – no frame
 * evaluation, no main-side panel state.
 *
 * The drawer, the menu and the comment window are the shared components the
 * HTML Preview uses; the window and the menu are portals, one at a time.
 *
 * @see src/renderer/src/components/Editor/markdownComments/useMarkdownComments.tsx
 * @see src/renderer/src/components/Comments/overlay/useCommentOverlayHost.ts
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { EditorPanelPage } from './editor-panel.page'

/** How long a list, a write or a re-render may take on a cold Windows runner. */
export const MD_COMMENT_BUDGET_MS = 15_000

export class MarkdownCommentsPage {
  readonly editor: EditorPanelPage

  constructor(private readonly page: Page) {
    this.editor = new EditorPanelPage(page)
  }

  // ---------------------------------------------------------------------------
  // Structure
  // ---------------------------------------------------------------------------

  /** The rendered Markdown (the scroller, a tab stop while comments are live). */
  preview(): Locator {
    return this.editor.previewPane()
  }

  /** The rendered content: what export, copy and Find read. */
  content(): Locator {
    return this.preview().locator('.markdown-preview-content')
  }

  /** A target by its tag and the file line it starts on. */
  target(tag: string, line: number): Locator {
    return this.content().locator(`${tag}[data-line-start="${line}"]`)
  }

  modeButton(): Locator {
    return this.editor.toolbar().getByTestId(TEST_IDS.COMMENT_TOOL_MODE)
  }

  listButton(): Locator {
    return this.editor.toolbar().getByTestId(TEST_IDS.COMMENT_TOOL_LIST)
  }

  overlay(): Locator {
    return this.page.getByTestId(TEST_IDS.COMMENT_HOST_OVERLAY)
  }

  icons(): Locator {
    return this.overlay().getByTestId(TEST_IDS.COMMENT_HOST_ICON)
  }

  modeTab(): Locator {
    return this.overlay().getByTestId(TEST_IDS.COMMENT_HOST_MODE_TAB)
  }

  announce(): Locator {
    return this.overlay().getByTestId(TEST_IDS.COMMENT_ANNOUNCE)
  }

  pausedBand(): Locator {
    return this.page.getByTestId(TEST_IDS.COMMENT_HOST_PAUSED)
  }

  drawer(): Locator {
    return this.page.getByTestId(TEST_IDS.COMMENT_DRAWER)
  }

  /** The comment window (a portal). */
  window(): Locator {
    return this.page.getByTestId(TEST_IDS.COMMENT_WINDOW)
  }

  /** The comment-mode menu (a portal). */
  menu(): Locator {
    return this.page.getByTestId(TEST_IDS.COMMENT_CONTEXT_MENU)
  }

  /** The floating Comment button over a selection (C-16). */
  selectionButton(): Locator {
    return this.overlay().getByTestId(TEST_IDS.COMMENT_SELECTION_BUTTON)
  }

  /** A drawer filter cell (C-15, OD-04). */
  filter(which: 'open' | 'resolved' | 'cantEdit'): Locator {
    const ids = {
      open: TEST_IDS.COMMENT_FILTER_OPEN,
      resolved: TEST_IDS.COMMENT_FILTER_RESOLVED,
      cantEdit: TEST_IDS.COMMENT_FILTER_CANT_EDIT
    }
    return this.drawer().getByTestId(ids[which])
  }

  /** The drawer's sort menu button (C-15). */
  sortButton(): Locator {
    return this.drawer().getByTestId(TEST_IDS.COMMENT_DRAWER_SORT)
  }

  /** The drawer's "Show comment icons and underlines" checkbox (C-20). */
  iconsCheckbox(): Locator {
    return this.drawer().getByTestId(TEST_IDS.COMMENT_DRAWER_SHOW_ICONS)
  }

  /** The texts of the ranges the comment mark paints now (CSS Custom Highlight API). */
  async markedWords(): Promise<string[]> {
    return this.page.evaluate(() => {
      const highlight = CSS.highlights.get('erf-comment')
      return highlight === undefined ? [] : [...highlight].map(range => (range as Range).toString())
    })
  }

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  /** The tools are up and the first list has been read (the toggle is no longer waiting). */
  async waitForComments(): Promise<void> {
    await expect(this.modeButton()).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await expect(this.overlay()).toBeAttached({ timeout: MD_COMMENT_BUDGET_MS })
    await expect(this.preview()).toHaveAttribute('tabindex', '0', { timeout: MD_COMMENT_BUDGET_MS })
  }

  /** Comment mode on with the toolbar toggle. */
  /**
   * Select the first occurrence of `words` inside the target, as a drag
   * would leave it, and return the selection's last line box in page pixels.
   */
  async selectWords(tag: string, line: number, words: string): Promise<{ x: number; y: number; right: number }> {
    const box = await this.target(tag, line).evaluate((el, wanted) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = (node as Text).data.indexOf(wanted)
        if (at === -1) continue
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + wanted.length)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        const rects = range.getClientRects()
        const last = rects[rects.length - 1]
        return { x: last.left + last.width / 2, y: last.top + last.height / 2, right: last.right }
      }
      throw new Error(`"${wanted}" is not in the target`)
    }, words)
    return box
  }

  async modeOn(): Promise<void> {
    await expect(this.modeButton()).not.toHaveAttribute('aria-disabled', 'true', { timeout: MD_COMMENT_BUDGET_MS })
    if ((await this.modeButton().getAttribute('aria-pressed')) !== 'true') await this.modeButton().click()
    await expect(this.modeButton()).toHaveAttribute('aria-pressed', 'true')
    await expect(this.modeTab()).toBeVisible()
  }

  /**
   * In an open new-comment window: answer the identity step when it shows,
   * type `text` and Save; wait until the window has closed and the polite
   * region says where the comment went.
   */
  /** Take the one-time identity step if the window shows it, and wait for the new-comment view. */
  async passIdentity(name: string): Promise<void> {
    const win = this.window()
    await expect(win).toHaveAttribute('data-view', /^(identity|new)$/, { timeout: MD_COMMENT_BUDGET_MS })
    if ((await win.getAttribute('data-view')) === 'identity') {
      await this.page.getByTestId('comment-identity-name').fill(name)
      await this.page.getByTestId('comment-identity-continue').click()
    }
    await expect(win).toHaveAttribute('data-view', 'new', { timeout: MD_COMMENT_BUDGET_MS })
  }

  async saveNewComment(text: string, file: string, name: string): Promise<void> {
    const win = this.window()
    await this.passIdentity(name)
    await this.page.getByTestId('comment-new-field').fill(text)
    await this.page.getByTestId('comment-save').click()
    await expect(win).toHaveCount(0, { timeout: MD_COMMENT_BUDGET_MS })
    await expect(this.announce()).toHaveText(`Comment saved to ${file}.`, { timeout: MD_COMMENT_BUDGET_MS })
  }

  /** Open a message's `…` menu in the window and choose `item`. */
  async messageAction(index: number, item: 'Edit' | 'Delete…'): Promise<void> {
    await this.window().getByTestId('comment-message-actions').nth(index).click()
    await this.page.getByRole('menuitem', { name: item }).click()
  }
}

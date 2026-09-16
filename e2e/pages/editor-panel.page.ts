// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown editor panel Page Object Model — the toolbar, the four view modes,
 * and the file-status indicators.
 *
 * The one thing every spec touching the editor needs to know: a file opens in
 * **preview** mode (`MarkdownEditorPanel` seeds `viewMode` to `'preview'`), so
 * Monaco is not in the DOM until the view is switched. Four existing specs
 * each rediscovered that and clicked the view-mode button inline; this POM is
 * where that knowledge now lives.
 *
 * The status indicators are three separate testids inside one permanently
 * mounted live region, and only the active one is rendered. Assert their
 * presence, never their absence-by-emptiness.
 *
 * @see src/renderer/src/components/Panels/MarkdownEditorPanel.tsx
 * @see src/renderer/src/components/Editor/MarkdownEditorPanel/components/MarkdownToolbar.tsx
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'

/** The four layouts the toolbar can switch between. */
export type ViewMode = 'editor' | 'preview' | 'split' | 'split-horizontal'

const VIEW_MODE_TESTIDS: Record<ViewMode, string> = {
  editor: TEST_IDS.VIEW_MODE_BTN_EDITOR,
  preview: TEST_IDS.VIEW_MODE_BTN_PREVIEW,
  split: TEST_IDS.VIEW_MODE_BTN_SPLIT,
  'split-horizontal': TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL
}

/** Toolbar formatting actions, keyed by the testid each button carries. */
const FORMAT_TESTIDS = {
  bold: TEST_IDS.TOOLBAR_BTN_BOLD,
  italic: TEST_IDS.TOOLBAR_BTN_ITALIC,
  strikethrough: TEST_IDS.TOOLBAR_BTN_STRIKETHROUGH,
  code: TEST_IDS.TOOLBAR_BTN_CODE,
  link: TEST_IDS.TOOLBAR_BTN_LINK,
  image: TEST_IDS.TOOLBAR_BTN_IMAGE,
  heading: TEST_IDS.TOOLBAR_BTN_HEADING,
  list: TEST_IDS.TOOLBAR_BTN_LIST,
  orderedList: TEST_IDS.TOOLBAR_BTN_LIST_ORDERED
} as const

export type FormatAction = keyof typeof FORMAT_TESTIDS

export class EditorPanelPage {
  constructor(private readonly page: Page) {}

  // ---------------------------------------------------------------------------
  // Structure
  // ---------------------------------------------------------------------------

  /** The whole editor panel body. Present in every view mode. */
  content(): Locator {
    return byTestId(this.page, TEST_IDS.EDITOR_CONTENT)
  }

  toolbar(): Locator {
    return byTestId(this.page, TEST_IDS.MARKDOWN_TOOLBAR)
  }

  /** The Monaco host. Absent in preview-only mode. */
  editorPane(): Locator {
    return byTestId(this.page, TEST_IDS.EDITOR_MONACO)
  }

  /** The rendered markdown. Absent in editor-only mode. */
  previewPane(): Locator {
    return byTestId(this.page, TEST_IDS.EDITOR_PREVIEW)
  }

  /** Wait for the panel chrome to mount, whichever view mode it lands in. */
  async waitForReady(): Promise<void> {
    await expect(this.content()).toBeVisible({ timeout: 10_000 })
    await expect(this.toolbar()).toBeVisible({ timeout: 10_000 })
  }

  // ---------------------------------------------------------------------------
  // View modes
  // ---------------------------------------------------------------------------

  viewModeButton(mode: ViewMode): Locator {
    return byTestId(this.page, VIEW_MODE_TESTIDS[mode])
  }

  /**
   * Switch view mode and wait for the panes that mode implies.
   *
   * Waiting on the panes rather than on the button's `active` class is
   * deliberate: the class is styling, the mounted panes are the contract.
   */
  async setViewMode(mode: ViewMode): Promise<void> {
    await this.viewModeButton(mode).click()

    const wantsEditor = mode !== 'preview'
    const wantsPreview = mode !== 'editor'

    if (wantsEditor) {
      await expect(this.editorPane()).toBeVisible({ timeout: 10_000 })
    } else {
      await expect(this.editorPane()).toHaveCount(0, { timeout: 10_000 })
    }

    if (wantsPreview) {
      await expect(this.previewPane()).toBeVisible({ timeout: 10_000 })
    } else {
      await expect(this.previewPane()).toHaveCount(0, { timeout: 10_000 })
    }
  }

  /** True when the toolbar marks this mode as the current one. */
  async isViewModeActive(mode: ViewMode): Promise<boolean> {
    const cls = (await this.viewModeButton(mode).getAttribute('class')) ?? ''
    return cls.split(/\s+/).includes('active')
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  formatButton(action: FormatAction): Locator {
    return byTestId(this.page, FORMAT_TESTIDS[action])
  }

  async format(action: FormatAction): Promise<void> {
    await this.formatButton(action).click()
  }

  searchButton(): Locator {
    return byTestId(this.page, TEST_IDS.TOOLBAR_BTN_SEARCH)
  }

  exportPdfButton(): Locator {
    return byTestId(this.page, TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)
  }

  exportDocxButton(): Locator {
    return byTestId(this.page, TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)
  }

  // ---------------------------------------------------------------------------
  // File status indicators
  // ---------------------------------------------------------------------------

  /** The `●` shown while the buffer differs from disk. */
  modifiedIndicator(): Locator {
    return byTestId(this.page, TEST_IDS.MODIFIED_INDICATOR)
  }

  /** "Auto-saving..." — present only while a save is in flight. */
  autosaveIndicator(): Locator {
    return byTestId(this.page, TEST_IDS.AUTOSAVE_INDICATOR)
  }

  /** "Reloaded from disk" — transient, and clears itself. */
  reloadIndicator(): Locator {
    return byTestId(this.page, TEST_IDS.RELOAD_INDICATOR)
  }

  /** The document statistics footer. */
  statsBar(): Locator {
    return byTestId(this.page, TEST_IDS.DOCUMENT_STATS_BAR)
  }

  statWords(): Locator {
    return byTestId(this.page, TEST_IDS.STATS_WORDS)
  }

  statCharacters(): Locator {
    return byTestId(this.page, TEST_IDS.STATS_CHARACTERS)
  }

  statLines(): Locator {
    return byTestId(this.page, TEST_IDS.STATS_LINES)
  }

  statReadingTime(): Locator {
    return byTestId(this.page, TEST_IDS.STATS_READING_TIME)
  }

  statSelection(): Locator {
    return byTestId(this.page, TEST_IDS.STATS_SELECTION)
  }

  // ---------------------------------------------------------------------------
  // File-changed-on-disk notification
  // ---------------------------------------------------------------------------

  conflictNotification(): Locator {
    return byTestId(this.page, TEST_IDS.FILE_CONFLICT_NOTIFICATION)
  }

  conflictReloadButton(): Locator {
    return byTestId(this.page, TEST_IDS.FILE_CONFLICT_BTN_RELOAD)
  }

  conflictKeepButton(): Locator {
    return byTestId(this.page, TEST_IDS.FILE_CONFLICT_BTN_KEEP)
  }

  conflictDismissButton(): Locator {
    return byTestId(this.page, TEST_IDS.FILE_CONFLICT_BTN_DISMISS)
  }
}

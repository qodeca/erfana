// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's renderer UI (spec 025, commit 17): the New browser
 * tab tool, the browser editor tabs, the navigation row, the address bar, the
 * empty tab and the page area – driven the way a user drives them, through
 * Erfana's DOM. Controls are found by role and accessible name; the panel,
 * the page placeholder and the editor tab by `BROWSER_TEST_IDS`.
 *
 * Main-side facts (which tabs exist, whether a page is attached) come from the
 * test hooks through {@link BrowserTabPage}; the page's own content through
 * {@link BrowserPagePage}. Condition-based waits only.
 *
 * ```ts
 * const ui = new BrowserTabUiPage(app, window)
 * const tab = await ui.openWithButton()
 * await tab.load('localhost:5173')
 * ```
 */
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { BROWSER_TEST_IDS } from '../../src/renderer/src/components/Panels/BrowserPanel/browserTestIds'
import { BrowserTabPage } from './browser-tab.page'
import { BrowserPagePage, type HookTab } from './browser-page.page'

const UI_WAIT_MS = 15_000

/** One browser panel in the editor area. */
export class BrowserPanelUi {
  constructor(
    readonly window: Page,
    readonly root: Locator,
    private readonly tabs: BrowserTabPage
  ) {}

  /** Main's tab id, once the panel hosts one. */
  async tabId(): Promise<string> {
    await expect(this.root).toHaveAttribute('data-browser-tab-id', /^browser-tab-\d+$/, {
      timeout: UI_WAIT_MS
    })
    return (await this.root.getAttribute('data-browser-tab-id'))!
  }

  get addressBar(): Locator {
    return this.root.getByRole('textbox', { name: 'Address and search' })
  }

  get navigation(): Locator {
    return this.root.getByRole('group', { name: 'Navigation' })
  }

  button(name: string): Locator {
    return this.navigation.getByRole('button', { name, exact: true })
  }

  get placeholder(): Locator {
    return this.root.getByTestId(BROWSER_TEST_IDS.PAGE_PLACEHOLDER)
  }

  get refused(): Locator {
    return this.root.getByTestId(BROWSER_TEST_IDS.REFUSED)
  }

  get emptyHint(): Locator {
    return this.root.getByText(/Load your app, then click/)
  }

  /** Type `text` into the address bar and press Enter. */
  async load(text: string): Promise<void> {
    await this.addressBar.click()
    await this.addressBar.fill(text)
    await this.addressBar.press('Enter')
  }

  /** Wait until main reports `expected` for this panel's tab. */
  async waitForState(expected: Parameters<BrowserTabPage['waitForState']>[1]): Promise<void> {
    await this.tabs.waitForState(await this.tabId(), expected)
  }

  /** The page inside this tab, for reads through the main-side hooks. */
  async page(): Promise<BrowserPagePage> {
    return this.tabs.page(await this.tabId())
  }

  /** Main's view of this tab (test hook). */
  async hookTab(): Promise<HookTab> {
    const tabId = await this.tabId()
    const found = (await this.tabs.tabs()).find(tab => tab.tabId === tabId)
    if (found === undefined) throw new Error(`Main holds no ${tabId}`)
    return found
  }

  /** Wait until main has (or has not) the page view attached to the window. */
  async waitForAttached(attached: boolean): Promise<void> {
    await expect
      .poll(async () => (await this.hookTab()).attached, { timeout: UI_WAIT_MS })
      .toBe(attached)
  }
}

export class BrowserTabUiPage {
  readonly tabs: BrowserTabPage

  constructor(
    readonly app: ElectronApplication,
    readonly window: Page
  ) {
    this.tabs = new BrowserTabPage(app, window)
  }

  /** The New browser tab tool in the editor strip. */
  get newTabButton(): Locator {
    return this.window.getByRole('button', { name: 'New browser tab', exact: true })
  }

  /** Every browser panel, in DOM order. */
  get panels(): Locator {
    return this.window.getByTestId(BROWSER_TEST_IDS.PANEL)
  }

  /** Every browser editor tab, in tab-strip order. */
  get editorTabs(): Locator {
    return this.window.getByTestId(BROWSER_TEST_IDS.EDITOR_TAB)
  }

  /** The panel that is drawn now (dockview keeps hidden ones mounted). */
  visiblePanel(): BrowserPanelUi {
    return new BrowserPanelUi(this.window, this.panels.locator('visible=true'), this.tabs)
  }

  /** Click New browser tab and wait for the new panel to host a tab. */
  async openWithButton(): Promise<BrowserPanelUi> {
    await this.tabs.installRecorder()
    const before = await this.panels.count()
    await this.newTabButton.click()
    await expect(this.panels).toHaveCount(before + 1, { timeout: UI_WAIT_MS })
    const panel = this.visiblePanel()
    await panel.tabId()
    return panel
  }

  /** Close every browser editor tab, through their close buttons. */
  async closeAll(): Promise<void> {
    while ((await this.editorTabs.count()) > 0) {
      const count = await this.editorTabs.count()
      const tab = this.editorTabs.first()
      await tab.hover()
      await tab.getByRole('button', { name: /^Close / }).click()
      await expect(this.editorTabs).toHaveCount(count - 1, { timeout: UI_WAIT_MS })
    }
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's renderer UI (spec 025, commits 17–18): the New
 * browser tab tool, the browser editor tabs, the navigation row, the address
 * bar and its chips, the strip rows, the find row, More, the page menu, the
 * Erfana pages and the page area – driven the way a user drives them, through
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
    return this.root.getByRole('combobox', { name: 'Address and search' })
  }

  get navigation(): Locator {
    return this.root.getByRole('group', { name: 'Navigation' })
  }

  /** The address bar's resting display (drawn over the input while it is not edited). */
  get addressDisplay(): Locator {
    return this.root.locator('.erf-brw-address__display')
  }

  /** The registrable domain in the resting display. */
  get addressDomain(): Locator {
    return this.addressDisplay.locator('.erf-brw-address__domain')
  }

  /** The parts of the resting display, in DOM order (scheme, subdomain, domain, port, path). */
  get addressParts(): Locator {
    return this.addressDisplay.locator(':scope > span')
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

  /** The strip above the page (commit 18). */
  get strip(): Locator {
    return this.root.getByTestId(BROWSER_TEST_IDS.STRIP)
  }

  /** The strip row of `kind` (`popupBlocked`, `leavePage`, …). */
  stripRow(kind: string): Locator {
    return this.strip.locator(`[data-strip-kind="${kind}"]`)
  }

  /**
   * Press a strip row's button once its input guard is over (OD-6): the
   * button drops `aria-disabled` when the renderer's guard ends, and main's
   * own guard runs on the same real time (its test clock only adds offsets).
   */
  async answerRow(kind: string, name: string): Promise<void> {
    const button = this.stripRow(kind).getByRole('button', { name, exact: true })
    await expect(button).not.toHaveAttribute('aria-disabled', 'true', { timeout: UI_WAIT_MS })
    await button.click()
  }

  /** The chips at the end of the address bar. */
  get chips(): Locator {
    return this.root.getByTestId(BROWSER_TEST_IDS.CHIPS)
  }

  /** The find row and its field. */
  get findRow(): Locator {
    return this.root.getByTestId(BROWSER_TEST_IDS.FIND_ROW)
  }

  get findField(): Locator {
    return this.findRow.getByRole('searchbox', { name: 'Find in page' })
  }

  /** The find count as drawn ("2 of 3"). */
  get findCount(): Locator {
    return this.findRow.locator('.erf-brw-find__count')
  }

  /** A toolbar control anywhere on the navigation row (More and Open in system browser sit outside the group). */
  tool(name: string): Locator {
    return this.root.getByRole('button', { name, exact: true })
  }

  /** The Erfana page's heading (load error, certificate, crashed). */
  get pageHeading(): Locator {
    return this.root.getByRole('heading', { level: 2 })
  }

  /** A menu drawn by Erfana (portal: outside the panel), by its accessible name. */
  menu(name: string): Locator {
    return this.window.getByRole('menu', { name, exact: true })
  }

  /** Open **More** and choose `item`. */
  async chooseMore(item: string | RegExp): Promise<void> {
    await this.tool('More').click()
    await this.menu('More').getByRole('menuitem', { name: item }).click()
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

  /** Run File › New browser tab from the application menu, as a mouse user would. */
  async openFromAppMenu(): Promise<BrowserPanelUi> {
    await this.tabs.installRecorder()
    const before = await this.panels.count()
    await this.app.evaluate(({ Menu, BrowserWindow }) => {
      const file = Menu.getApplicationMenu()?.items.find(item => item.label === 'File')
      const item = file?.submenu?.items.find(entry => entry.label === 'New browser tab')
      if (item === undefined) throw new Error('File › New browser tab is missing')
      const win = BrowserWindow.getAllWindows().find(w => w.isFocused()) ?? BrowserWindow.getAllWindows()[0]
      // A menu click, not the accelerator.
      item.click({ triggeredByAccelerator: false } as unknown as KeyboardEvent, win, win?.webContents)
    })
    await expect(this.panels).toHaveCount(before + 1, { timeout: UI_WAIT_MS })
    const panel = this.visiblePanel()
    await panel.tabId()
    return panel
  }

  /**
   * Resize Erfana's window until `panel` is `width` CSS px wide. When the
   * editor area stops shrinking at the other panels' minimum sizes, the panel
   * itself is held to `width`.
   */
  async setPanelWidth(panel: BrowserPanelUi, width: number): Promise<void> {
    const panelWidth = async (): Promise<number> => (await panel.root.boundingBox())?.width ?? 0
    const delta = Math.round((await panelWidth()) - width)
    if (delta !== 0) {
      await this.app.evaluate(({ BrowserWindow }, d) => {
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible())
        if (win === undefined) throw new Error('No visible window')
        win.setMinimumSize(200, 200)
        const [w, h] = win.getContentSize()
        win.setContentSize(w - d, h)
      }, delta)
      // Until the layout settles: two reads in a row agree.
      let last = -1
      await expect
        .poll(
          async () => {
            const now = await panelWidth()
            const settled = now === last
            last = now
            return settled
          },
          { timeout: UI_WAIT_MS, intervals: [100, 200, 300] }
        )
        .toBe(true)
    }
    if (Math.abs((await panelWidth()) - width) > 1) {
      await panel.root.evaluate((el, w) => {
        const root = el as HTMLElement
        root.style.width = `${w}px`
        root.style.flex = '0 0 auto'
      }, width)
    }
    await expect.poll(panelWidth, { timeout: UI_WAIT_MS }).toBeCloseTo(width, 0)
  }

  /** The newest popup window's host page (its origin strip), once one is open. */
  async popupHost(count = 1): Promise<Page> {
    const hosts = (): Page[] => this.app.windows().filter(w => w.url().includes('#browser-popup'))
    await expect.poll(() => hosts().length, { timeout: UI_WAIT_MS }).toBeGreaterThanOrEqual(count)
    return hosts()[count - 1]!
  }

  /** The read-only address field of a popup's origin strip. */
  popupAddress(host: Page): Locator {
    return host.getByRole('textbox', { name: 'Pop-up window address' })
  }

  /** The browser editor tab whose panel hosts `tabId`. */
  editorTabFor(index: number): Locator {
    return this.editorTabs.nth(index)
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

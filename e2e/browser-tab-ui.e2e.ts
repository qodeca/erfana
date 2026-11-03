// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser, renderer UI (spec 025 commit 17): the New browser tab
 * tool, the navigation row and address bar, the empty tab, several tabs, the
 * toolbar's Tab order, and the native-view guard with settings and a toast
 * over a browser tab (left from commit 16).
 *
 * Driven through Erfana's DOM (`BrowserTabUiPage`); main-side facts through
 * the test hooks. Condition-based waits only.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { test, expect } from './fixtures/browserHarness'
import { BrowserTabUiPage } from './pages/browser-tab-ui.page'
import { SEARCH_URL_PREFIX } from '../src/shared/browser/addressInput'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { ProjectTreePage } from './pages/project-tree.page'

/** Where the lead's visual check finds the panel screenshot (not committed). */
const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results', 'browser-tab-ui')

test.describe('built-in browser tab UI', () => {
  test('025-AC-001 the New browser tab button opens an empty tab with the address bar focused', async ({
    appWithTestProject,
    windowWithTestProject
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    for (let round = 1; round <= 2; round++) {
      const panel = await ui.openWithButton()
      await expect(ui.editorTabs).toHaveCount(round)
      await expect(panel.addressBar).toBeFocused()
      await expect(panel.addressBar).toHaveValue('')
      await expect(panel.emptyHint).toBeVisible()
      await expect(ui.editorTabs.nth(round - 1)).toContainText('New browser tab')
    }
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
    await windowWithTestProject.screenshot({ path: path.join(SCREENSHOT_DIR, 'empty-tab.png') })
  })

  test('025-AC-002 typed text loads an address, a search, or is refused inline', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const port = browserServers.sites.static.httpPort

    // localhost:{port} loads over http://, and the page is shown on its area.
    await panel.load(`localhost:${port}/index.html`)
    const indexUrl = `http://localhost:${port}/index.html`
    await panel.waitForState({ committedUrl: indexUrl, loading: false })
    await (await panel.page()).waitForLoaded(indexUrl)
    await panel.waitForAttached(true)
    await expect(panel.addressBar).toHaveValue(indexUrl)
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
    await windowWithTestProject.screenshot({ path: path.join(SCREENSHOT_DIR, 'loaded-page.png') })

    // After a redirect the bar shows the final address.
    await panel.load(`localhost:${port}/__redirect?to=/page-b.html`)
    const finalUrl = `http://localhost:${port}/page-b.html`
    await panel.waitForState({ committedUrl: finalUrl, loading: false })
    await expect(panel.addressBar).toHaveValue(finalUrl)

    // A refused scheme shows the inline message and is never searched.
    await panel.load('javascript:alert(1)')
    await expect(panel.refused).toContainText("Browser tabs can't open javascript: addresses.")
    await expect(panel.addressBar).toHaveAttribute('aria-invalid', 'true')
    await panel.waitForState({ committedUrl: finalUrl })
    await panel.addressBar.press('End')
    await panel.addressBar.press('Backspace')
    await expect(panel.refused).toHaveCount(0)

    // Words become a DuckDuckGo search (the sealed network fails it; the bar names it).
    await panel.load('button padding')
    await panel.waitForState({ committedUrl: `${SEARCH_URL_PREFIX}button%20padding` })
  })

  test('025-AC-004 three browser tabs each show their own page title', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const { sites } = browserServers
    const pages = ['/index.html', '/page-b.html', '/plain.html'].map(p => sites.static.url(p))
    const titles: string[] = []
    for (const url of pages) {
      const panel = await ui.openWithButton()
      await panel.load(url)
      await panel.waitForState({ committedUrl: url, loading: false })
      const page = await panel.page()
      await page.waitForLoaded(url)
      titles.push(await page.eval<string>('document.title'))
    }
    await expect(ui.editorTabs).toHaveCount(3)
    for (const [index, title] of titles.entries()) {
      // A page without a title shows its host, never a path.
      const expected = title === '' ? sites.static.host : title
      await expect(ui.editorTabs.nth(index)).toContainText(expected)
      await expect(ui.editorTabs.nth(index)).not.toContainText('.html')
    }

    // Each tab shows its own page when selected; hidden ones are detached, not closed.
    await ui.editorTabs.first().click()
    const first = ui.visiblePanel()
    await expect(first.addressBar).toHaveValue(pages[0])
    await first.waitForAttached(true)
    expect((await ui.tabs.tabs()).filter(tab => tab.attached)).toHaveLength(1)

    // Closing an editor tab closes its tab in main.
    const before = (await ui.tabs.tabs()).length
    await ui.editorTabs.nth(1).hover()
    await ui.editorTabs
      .nth(1)
      .getByRole('button', { name: /^Close / })
      .click()
    await expect(ui.editorTabs).toHaveCount(2)
    await expect.poll(async () => (await ui.tabs.tabs()).length).toBe(before - 1)
  })

  test('025-AC-053 Tab walks the navigation row in design order, skipping disabled Back and Forward', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const { sites } = browserServers
    await panel.load(sites.static.url('/index.html'))
    await panel.waitForState({ committedUrl: sites.static.url('/index.html'), loading: false })

    // No history: Shift+Tab from the field reaches Reload, never Back or Forward.
    await panel.addressBar.focus()
    await windowWithTestProject.keyboard.press('Shift+Tab')
    await expect(panel.button('Reload')).toBeFocused()
    await windowWithTestProject.keyboard.press('Tab')
    await expect(panel.addressBar).toBeFocused()
    await windowWithTestProject.keyboard.press('Tab')
    await expect(panel.button('DevTools')).toBeFocused()

    // With history, Back joins the order and works with Enter.
    await panel.load(sites.static.url('/page-b.html'))
    await panel.waitForState({
      committedUrl: sites.static.url('/page-b.html'),
      canGoBack: true,
      loading: false
    })
    await panel.addressBar.focus()
    await windowWithTestProject.keyboard.press('Shift+Tab')
    await windowWithTestProject.keyboard.press('Shift+Tab')
    await expect(panel.button('Back')).toBeFocused()
    await windowWithTestProject.keyboard.press('Enter')
    await panel.waitForState({ committedUrl: sites.static.url('/index.html'), loading: false })
  })

  test('settings and a toast over a browser tab are visible', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const url = browserServers.sites.static.url('/index.html')
    await panel.load(url)
    await panel.waitForState({ committedUrl: url, loading: false })
    await panel.waitForAttached(true)

    // Settings: the guard hides the page, so the overlay is not painted over.
    const tree = new ProjectTreePage(windowWithTestProject)
    await tree.openSettings()
    await panel.waitForAttached(false)
    await expect(windowWithTestProject.getByTestId(TEST_IDS.SETTINGS_OVERLAY)).toBeVisible()
    await tree.closeSettings()
    await panel.waitForAttached(true)

    // A toast: it places itself beside the page, or the page is hidden under it.
    await windowWithTestProject.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('app:toast', {
          detail: { title: 'Over a browser tab', message: 'Visible', type: 'info', duration: 0 }
        })
      )
    )
    const toast = windowWithTestProject
      .getByTestId(`${TEST_IDS.TOAST}-info`)
      .filter({ hasText: 'Over a browser tab' })
    await expect(toast).toBeVisible()
    await expect
      .poll(async () => {
        const [box, page, hook] = [
          await toast.boundingBox(),
          await panel.placeholder.boundingBox(),
          await panel.hookTab()
        ]
        if (box === null || page === null) return false
        const overlaps =
          box.x < page.x + page.width &&
          page.x < box.x + box.width &&
          box.y < page.y + page.height &&
          page.y < box.y + box.height
        return !overlaps || !hook.attached
      })
      .toBe(true)
  })
})

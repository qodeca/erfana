// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser, renderer chrome (spec 025 commit 18): the strip rows
 * (pop-up blocked, leave page), the address-bar chips, the find row, More and
 * its dialogs, the page right-click menu, the Erfana pages (load error,
 * certificate, crashed), the popup's origin strip and File › New browser tab.
 *
 * Driven through Erfana's DOM (`BrowserTabUiPage`); main-side facts through
 * the test hooks. Condition-based waits only. Each new surface is saved under
 * `test-results/browser-tab-ui/` for the visual check (not committed).
 *
 * A title starts with an AC id only for the part of that criterion the test
 * proves through the UI; the main-side halves stay in their own specs.
 */
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { BrowserTabUiPage, type BrowserPanelUi } from './pages/browser-tab-ui.page'

const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results', 'browser-tab-ui')
const WAIT_MS = 15_000
const IS_MAC = process.platform === 'darwin'
const MOD = IS_MAC ? 'meta' : 'control'

async function shot(window: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  await window.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) })
}

/** Call `<group>.<name>(...args)` on the main-process hooks. */
async function hook<T>(app: ElectronApplication, group: string, name: string, ...args: unknown[]): Promise<T> {
  return (await app.evaluate(
    async (_electron, [g, n, a]) => {
      const hooks = (globalThis as unknown as { __erfanaTestHooks?: Record<string, Record<string, (...x: unknown[]) => unknown>> })
        .__erfanaTestHooks
      if (!hooks?.[g as string]) throw new Error('Test hooks are not installed (build with npm run build:e2e)')
      return hooks[g as string]![n as string]!(...(a as unknown[]))
    },
    [group, name, args] as const
  )) as T
}

/** A loopback port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** Load `url` through the address bar and wait until the page takes input. */
async function loadPage(panel: BrowserPanelUi, url: string): Promise<void> {
  await panel.load(url)
  await panel.waitForState({ committedUrl: url, loading: false })
  const page = await panel.page()
  await page.waitForLoaded(url)
  await page.waitForInputReady()
}

/** The centre of `selector` in page CSS px. */
async function centre(panel: BrowserPanelUi, selector: string): Promise<{ x: number; y: number }> {
  return (await panel.page()).eval(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
  )
}

/** Record what `shell.openExternal` is asked to open, instead of opening it. */
async function stubExternalOpen(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __externalOpens: string[] }
    g.__externalOpens = []
    shell.openExternal = async (target: string) => {
      g.__externalOpens.push(target)
    }
  })
}

const externalOpens = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { __externalOpens: string[] }).__externalOpens)

test.describe('built-in browser tab chrome', () => {
  test('025-AC-011 "Pop-up blocked" shows in the strip, not the toolbar, and Allow once opens one', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    await loadPage(panel, browserServers.sites.static.url('/popups.html'))
    const tabsBefore = (await ui.tabs.tabs()).length

    await (await panel.page()).eval('window.__fixture.openMany(6)')
    const row = panel.stripRow('popupBlocked')
    await expect(row).toBeVisible({ timeout: WAIT_MS })
    await expect(row).toHaveAccessibleName(/^Pop-up blocked – .+ tried to open a new tab or window\.$/)
    await expect(row.getByRole('button', { name: 'Always allow for this site', exact: true })).toBeVisible()
    // The prompt and its answers are in the strip; the toolbar holds only the chip that points at it.
    const chip = panel.chips.getByRole('button', { name: 'Pop-up blocked, show options' })
    await expect(chip).toBeVisible()
    await expect(panel.navigation.getByRole('button', { name: /^(Allow once|Always allow for this site|Dismiss)$/ })).toHaveCount(0)
    await shot(windowWithTestProject, 'strip-popup-blocked')
    await chip.click()
    await expect(row).toBeFocused()

    await panel.answerRow('popupBlocked', 'Allow once')
    await expect.poll(async () => (await ui.tabs.tabs()).length, { timeout: WAIT_MS }).toBe(tabsBefore + 1)
  })

  test('025-AC-075 Ctrl/Cmd+W on a beforeunload page asks "Leave this page?"; Stay keeps the editor tab, Leave closes it', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    await loadPage(panel, browserServers.sites.static.url('/dialogs.html'))
    const page = await panel.page()
    const tabId = await panel.tabId()
    // Chromium asks only after a user gesture on the page.
    await page.clickSelector('#beforeunload')
    await page.waitFor(`document.getElementById('beforeunload').checked === true`, 'beforeunload armed')

    await page.key('w', [MOD])
    const row = panel.stripRow('leavePage')
    await expect(row).toBeVisible({ timeout: WAIT_MS })
    await expect(windowWithTestProject.getByRole('alertdialog', { name: /^Leave this page\?/ })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Stay', exact: true })).toBeFocused()
    await shot(windowWithTestProject, 'strip-leave-page')

    // Stay: main keeps the tab, so the editor tab stays.
    await panel.answerRow('leavePage', 'Stay')
    await expect(row).toHaveCount(0, { timeout: WAIT_MS })
    await expect(ui.editorTabs).toHaveCount(1)
    expect((await ui.tabs.tabs()).some((t) => t.tabId === tabId)).toBe(true)

    // Asked again through the editor tab's close button; Leave closes it.
    await ui.editorTabs.first().hover()
    await ui.editorTabs.first().getByRole('button', { name: /^Close / }).click()
    await expect(row).toBeVisible({ timeout: WAIT_MS })
    await panel.answerRow('leavePage', 'Leave')
    await expect(ui.editorTabs).toHaveCount(0, { timeout: WAIT_MS })
    await expect.poll(async () => (await ui.tabs.tabs()).some((t) => t.tabId === tabId), { timeout: WAIT_MS }).toBe(false)
  })

  test('025-AC-076 the load-error page names the address and the error with Reload focused; Reload loads once the server is up', async ({
    appWithTestProject,
    windowWithTestProject
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const port = await closedPort()
    await panel.load(`localhost:${port}`)
    await expect(panel.pageHeading).toHaveText('localhost refused to connect', { timeout: WAIT_MS })
    await expect(panel.root.getByText('Is your dev server running? Start it in a terminal, then press Reload.')).toBeVisible()
    await expect(panel.root.getByText(`localhost:${port}`, { exact: false }).first()).toBeVisible()
    await expect(panel.root.getByText('ERR_CONNECTION_REFUSED (-102)')).toBeVisible()
    const reload = panel.root.getByRole('button', { name: 'Reload', exact: true }).last()
    await expect(reload).toBeFocused()
    await shot(windowWithTestProject, 'page-load-error')

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><title>up</title><h1 id="up">up</h1>')
    })
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    try {
      await reload.click()
      await expect(panel.pageHeading).toHaveCount(0, { timeout: WAIT_MS })
      await (await panel.page()).waitFor(`document.getElementById('up') !== null`, 'the page loaded after Reload')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test('025-AC-021 the certificate page names the host and the error; Proceed anyway loads the page after the guard', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const url = browserServers.certServers.selfSigned.url('/')
    await panel.load(url)
    await expect(panel.pageHeading).toHaveText(/^selfsigned\.test(:\d+)? has a certificate Erfana can't trust$/, { timeout: WAIT_MS })
    await expect(panel.root.getByRole('button', { name: 'Back to safety' })).toBeFocused()
    const proceed = panel.root.getByRole('button', { name: /^Proceed anyway to selfsigned\.test/ })
    await expect(proceed).toBeVisible()
    await panel.root.getByText('More about this error').click()
    await expect(panel.root.getByText(/^ERR_CERT_\w+ \(-\d+\)$/)).toBeVisible()
    // The failed address stays named: in the bar, in the editor tab and in the details.
    await expect(panel.addressBar).toHaveValue(/selfsigned\.test/)
    await expect(ui.editorTabs.first()).toContainText('selfsigned.test')
    await expect(ui.editorTabs.first()).not.toContainText('New browser tab')
    await expect(panel.root.locator('details').getByText(/selfsigned\.test/)).toBeVisible()
    await shot(windowWithTestProject, 'page-certificate')

    await expect(proceed).not.toHaveAttribute('aria-disabled', 'true', { timeout: WAIT_MS })
    await proceed.click()
    await expect(panel.pageHeading).toHaveCount(0, { timeout: WAIT_MS })
    await panel.waitForState({ erfanaPage: null, loading: false })
  })

  test('025-AC-072 a crashed tab shows "This page crashed" with Reload, and Reload loads the page', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const url = browserServers.sites.static.url('/index.html')
    await loadPage(panel, url)
    const { webContentsId } = await panel.hookTab()
    await appWithTestProject.evaluate(({ webContents }, id) => {
      webContents.fromId(id)?.forcefullyCrashRenderer()
    }, webContentsId)
    await expect(panel.pageHeading).toHaveText('This page crashed', { timeout: WAIT_MS })
    await shot(windowWithTestProject, 'page-crashed')
    await panel.root.getByRole('button', { name: 'Reload', exact: true }).last().click()
    await expect(panel.pageHeading).toHaveCount(0, { timeout: WAIT_MS })
    await (await panel.page()).waitForLoaded(url)
  })

  test('025-AC-008 Ctrl/Cmd+F finds "needle" 1 of 3, Enter and Shift+Enter step; the zoom keys go 110%, 125% and back to 100%', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    await loadPage(panel, browserServers.sites.static.url('/find.html'))
    const page = await panel.page()

    await page.key('f', [MOD])
    await expect(panel.findField).toBeFocused({ timeout: WAIT_MS })
    await panel.findField.pressSequentially('needle')
    await expect(panel.findCount).toHaveText('1 of 3', { timeout: WAIT_MS })
    await panel.findField.press('Enter')
    await expect(panel.findCount).toHaveText('2 of 3', { timeout: WAIT_MS })
    await panel.findField.press('Shift+Enter')
    await expect(panel.findCount).toHaveText('1 of 3', { timeout: WAIT_MS })
    await shot(windowWithTestProject, 'find-row')
    await panel.findField.press('Escape')
    await expect(panel.findRow).toHaveCount(0)

    await page.waitForInputReady()
    const zoomChip = panel.chips.getByRole('button', { name: /% zoom, reset to 100%$/ })
    await page.key('=', [MOD])
    await expect(zoomChip).toHaveText('110%', { timeout: WAIT_MS })
    await page.key('=', [MOD])
    await expect(zoomChip).toHaveText('125%', { timeout: WAIT_MS })
    await shot(windowWithTestProject, 'chip-zoom')
    await page.key('0', [MOD])
    await expect(zoomChip).toHaveCount(0, { timeout: WAIT_MS })
  })

  test('025-AC-023 More holds Clear browsing data and Forget; the dialog opens with the defaults ticked and none ticked blocks Clear', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    await loadPage(panel, browserServers.sites.static.url('/index.html'))

    await panel.tool('More').click()
    const more = panel.menu('More')
    await expect(more.getByRole('menuitem', { name: 'Clear browsing data…' })).toBeVisible()
    await expect(more.getByRole('menuitem', { name: "Forget this project's browser data…" })).toBeVisible()
    await expect(more).toHaveCSS('opacity', '1')
    await shot(windowWithTestProject, 'more-menu')
    await more.getByRole('menuitem', { name: 'Clear browsing data…' }).click()

    const dialog = windowWithTestProject.getByRole('dialog', { name: 'Clear browsing data' })
    await expect(dialog).toBeVisible()
    const ticked = async (name: string): Promise<boolean> => dialog.getByRole('checkbox', { name }).isChecked()
    expect(await ticked('Cookies and other site data')).toBe(true)
    expect(await ticked('Cached files')).toBe(true)
    expect(await ticked('Captures')).toBe(true)
    expect(await ticked('Site permissions, certificate exceptions and pop-up exceptions')).toBe(false)
    expect(await ticked('Saved sign-in credentials')).toBe(false)
    await shot(windowWithTestProject, 'dialog-clear-data')
    for (const name of ['Cookies and other site data', 'Cached files', 'Captures']) await dialog.getByRole('checkbox', { name }).uncheck()
    const clear = dialog.getByRole('button', { name: 'Clear', exact: true })
    await expect(clear).toHaveAttribute('aria-disabled', 'true')
    await expect(clear).toHaveAccessibleDescription('Tick at least one kind of data.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)

    // Forget asks first; Cancel keeps everything.
    await panel.chooseMore("Forget this project's browser data…")
    const confirm = windowWithTestProject.getByRole('dialog', { name: "Forget this project's browser data?" })
    await expect(confirm).toBeVisible()
    await shot(windowWithTestProject, 'dialog-forget')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(ui.editorTabs).toHaveCount(1)
  })

  test('025-AC-074 the page menu opens Erfana-drawn on a right-click and Open link in new tab opens it; the toolbar opens the address in the system browser', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const url = browserServers.sites.static.url('/plain.html')
    await loadPage(panel, url)
    const page = await panel.page()
    await page.eval(`document.body.innerHTML = '<a id="link" href="/page-b.html?via=menu" style="display:inline-block;padding:20px">A link</a>'; 0`)
    const at = await centre(panel, '#link')
    await hook(appWithTestProject, 'popup', 'clickButton', page.tabId, at.x, at.y, 'right')

    const menu = panel.menu('Page actions')
    await expect(menu).toBeVisible({ timeout: WAIT_MS })
    await expect(menu).toHaveAccessibleDescription(/^localhost$|\.test$|^127\.0\.0\.1$/)
    // The menu fades in; capture it once settled.
    await expect(menu).toHaveCSS('opacity', '1')
    await shot(windowWithTestProject, 'menu-page-actions')
    const before = (await ui.tabs.tabs()).length
    await menu.getByRole('menuitem', { name: /^Open link in new tab/ }).click()
    await expect(menu).toHaveCount(0)
    await expect.poll(async () => (await ui.tabs.tabs()).some((t) => t.url.includes('via=menu')), { timeout: WAIT_MS }).toBe(true)
    expect((await ui.tabs.tabs()).length).toBe(before + 1)

    await stubExternalOpen(appWithTestProject)
    await ui.editorTabs.first().click()
    await panel.waitForState({ committedUrl: url })
    await ui.visiblePanel().tool('Open in system browser').click()
    await expect.poll(() => externalOpens(appWithTestProject), { timeout: WAIT_MS }).toContain(url)
  })

  test("025-AC-011 the popup window's origin strip shows its host, read-only", async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    await loadPage(panel, browserServers.sites.static.url('/popups.html', { host: 'staging.test' }))
    const at = await centre(panel, '#open-auth')
    await hook(appWithTestProject, 'popup', 'clickButton', await panel.tabId(), at.x, at.y, 'left')

    await expect.poll(() => appWithTestProject.windows().some((w) => w.url().includes('#browser-popup')), { timeout: WAIT_MS }).toBe(true)
    const host = appWithTestProject.windows().find((w) => w.url().includes('#browser-popup'))!
    const address = host.getByRole('textbox', { name: 'Pop-up window address' })
    await expect(address).toHaveValue(/staging\.test(:\d+)?\/popup-child\.html/, { timeout: WAIT_MS })
    await expect(address).toHaveAttribute('readonly', '')
    await shot(host, 'popup-strip')
  })

  test('File › New browser tab opens an empty browser tab from the application menu', async ({ appWithTestProject, windowWithTestProject }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openFromAppMenu()
    await expect(ui.editorTabs).toHaveCount(1)
    await expect(panel.addressBar).toHaveValue('')
    await expect(panel.emptyHint).toBeVisible()
  })
})

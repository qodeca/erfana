// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser, the ways in from the rest of Erfana (spec 025 commit 20):
 * a terminal link opens a browser tab and Cmd/Ctrl-click the system browser
 * (025-AC-009); **Open in browser tab** in the HTML preview (025-AC-010); the
 * confirmation before text dropped from outside Erfana reaches the terminal
 * (S-17); and the hung-page row as the user sees it, with **Reload**.
 *
 * Driven through Erfana's DOM and the terminal POM; main-side facts through
 * the test hooks. `shell.openExternal` is stubbed in main, so no system
 * browser ever opens. Condition-based waits only. Surfaces are saved under
 * `test-results/browser-tab-ui/` for the visual check (not committed).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { TerminalPage } from './pages/terminal.page'
import { BrowserTabUiPage } from './pages/browser-tab-ui.page'
import { HtmlPreviewPage } from './pages/html-preview.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results', 'browser-tab-ui')
const WAIT_MS = 15_000
const PREVIEW_FILE = 'site/page.html'

async function shot(window: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  await window.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) })
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

/** The terminal's drawing area (xterm's `.xterm-screen`). */
function terminalScreen(window: Page): Locator {
  return window.getByTestId(TEST_IDS.TERMINAL_INSTANCE).locator('.xterm-screen').first()
}

/**
 * Clear the screen and print `url` alone on its first row, so the link sits
 * at a known place whatever the cell size: the top-left corner of the screen.
 */
async function printLinkOnFirstRow(window: Page, terminal: { sendCommand(c: string): Promise<void>; waitForOutputLine(l: string): Promise<void> }, url: string): Promise<void> {
  await terminal.sendCommand(`printf '\\033[2J\\033[H%s\\n' '${url}'`)
  await terminal.waitForOutputLine(url)
  await expect(terminalScreen(window)).toBeVisible()
}

/**
 * Hover the link on the first row until xterm's link layer shows the pointer,
 * then click it (with `modifier` held, when given).
 */
async function clickFirstRowLink(window: Page, modifier: 'Meta' | 'Control' | null): Promise<void> {
  const box = await terminalScreen(window).boundingBox()
  if (box === null) throw new Error('The terminal screen has no box')
  const x = box.x + 24
  const y = box.y + 4
  const xterm = window.getByTestId(TEST_IDS.TERMINAL_INSTANCE).locator('.xterm').first()
  let step = 0
  await expect
    .poll(async () => {
      step += 1
      await window.mouse.move(x + (step % 3), y)
      // xterm marks its screen element (inside `.xterm`) while a link is under the pointer.
      return xterm.evaluate(el => el.classList.contains('xterm-cursor-pointer') || el.querySelector('.xterm-cursor-pointer') !== null)
    }, { timeout: WAIT_MS, message: 'xterm shows the link pointer' })
    .toBe(true)
  if (modifier !== null) await window.keyboard.down(modifier)
  await window.mouse.down()
  await window.mouse.up()
  if (modifier !== null) await window.keyboard.up(modifier)
}

/** Dispatch a text drop from outside the window onto the terminal. */
async function dropTextOnTerminal(window: Page, text: string): Promise<void> {
  await window.getByTestId(TEST_IDS.TERMINAL_INSTANCE).locator('.xterm').first().evaluate((target, dropped) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', dropped)
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
    }
  }, text)
}

test.describe('built-in browser, opened from the rest of Erfana', () => {
  test.use({
    testProjectFiles: {
      [PREVIEW_FILE]: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview page</title></head><body><h1>Preview page</h1></body></html>\n'
    }
  })

  test('025-AC-009 a plain click on a terminal link opens a browser tab; Cmd/Ctrl-click opens the system browser instead', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    await stubExternalOpen(appWithTestProject)
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    await ui.tabs.installRecorder()
    const terminalPage = new TerminalPage(windowWithTestProject)
    await terminalPage.open()
    const url = browserServers.sites.static.url('/index.html')

    await printLinkOnFirstRow(windowWithTestProject, terminalPage, url)
    await clickFirstRowLink(windowWithTestProject, null)
    await expect(ui.editorTabs).toHaveCount(1, { timeout: WAIT_MS })
    const panel = ui.visiblePanel()
    await panel.waitForState({ committedUrl: url, loading: false })
    await expect(panel.addressBar).toHaveValue(url)
    expect(await externalOpens(appWithTestProject)).toEqual([])
    await shot(windowWithTestProject, 'terminal-link-tab')

    const other = browserServers.sites.static.url('/page-b.html')
    await printLinkOnFirstRow(windowWithTestProject, terminalPage, other)
    await clickFirstRowLink(windowWithTestProject, process.platform === 'darwin' ? 'Meta' : 'Control')
    await expect.poll(() => externalOpens(appWithTestProject), { timeout: WAIT_MS }).toEqual([other])
    await expect(ui.editorTabs).toHaveCount(1)
  })

  test('025-AC-010 Open in browser tab in the HTML preview opens the file in a browser tab as a file:// address; a tree click still opens the preview', async ({
    appWithTestProject,
    windowWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    // `open` clicks the tree row and waits for a live preview of that file.
    await preview.open(PREVIEW_FILE)
    const tool = windowWithTestProject.getByRole('button', { name: 'Open page.html in a browser tab', exact: true })
    await expect(tool).toBeVisible({ timeout: WAIT_MS })
    await tool.click()

    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    await expect(ui.panels).toHaveCount(1, { timeout: WAIT_MS })
    const panel = ui.visiblePanel()
    await expect(panel.addressBar).toHaveValue(/^file:\/\/.*\/site\/page\.html$/, { timeout: WAIT_MS })
    const page = await panel.page()
    await page.waitFor(`document.title === 'Preview page' && document.readyState === 'complete'`, 'the file loaded')
    expect(await page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[^/]+\/page\.html$/)
    await shot(windowWithTestProject, 'open-in-browser-tab')
  })

  test('text dropped on the terminal from outside Erfana asks first when it holds a line break (S-17)', async ({
    windowWithTestProject
  }) => {
    const terminalPage = new TerminalPage(windowWithTestProject)
    await terminalPage.open()
    const marker = `DROPPED_${Date.now()}`
    const dialog = windowWithTestProject.getByRole('dialog', { name: 'Drop text from outside Erfana?' })

    await dropTextOnTerminal(windowWithTestProject, `echo ${marker}\n`)
    await expect(dialog).toBeVisible({ timeout: WAIT_MS })
    await expect(dialog).toContainText(`echo ${marker}⏎`)
    await shot(windowWithTestProject, 'terminal-drop-confirm')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect((await terminalPage.readScreen()).lines.join('\n')).not.toContain(marker)

    await dropTextOnTerminal(windowWithTestProject, `echo ${marker}\n`)
    await expect(dialog).toBeVisible({ timeout: WAIT_MS })
    await dialog.getByRole('button', { name: 'Drop', exact: true }).click()
    await terminalPage.waitForOutput(`echo ${marker}`)

    // One line with no control character goes straight in.
    await dropTextOnTerminal(windowWithTestProject, ` ${marker}-plain`)
    await terminalPage.waitForOutput(`${marker}-plain`)
    await expect(dialog).toHaveCount(0)
  })

  test('a hung page shows "This page is not responding." in the strip, and Reload brings the page back', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    test.setTimeout(90_000)
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const url = browserServers.sites.static.url('/hang.html')
    await panel.load(url)
    await panel.waitForState({ committedUrl: url, loading: false })
    const page = await panel.page()
    await page.waitForLoaded(url)

    // The fixture loops on its main thread; the row shows once the page stops answering.
    await page.eval('window.__fixture.hang(60000)')
    const row = panel.stripRow('hung')
    await expect(row).toContainText('This page is not responding.', { timeout: 30_000 })
    await expect(row.getByRole('button', { name: 'Wait', exact: true })).toBeVisible()
    await shot(windowWithTestProject, 'hung-row')

    await panel.answerRow('hung', 'Reload')
    await expect(row).toHaveCount(0, { timeout: 30_000 })
    await page.waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && document.getElementById('done').textContent === ''`, 'the page reloaded')
  })
})

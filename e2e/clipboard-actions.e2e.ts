// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: copy, cut, paste and delete wherever they make sense (#463, part 2).
 *
 * - The project tree's Delete key deletes the focused item after the same
 *   confirmation the menu's Delete asks; Cancel deletes nothing.
 * - Paste is offered on a FILE row and lands in that file's folder.
 * - A Settings text field, which has no menu of its own, gets the app-level
 *   Cut / Copy / Paste / Delete menu, and its Delete removes the selection.
 * - The HTML preview's right-click menu (#463, part 3) ends with Copy
 *   selection: on selected words it copies them – main runs the page's own
 *   Copy command – and without a selection it is shown, disabled.
 *
 * Condition-based waits only: POM waits, `expect.poll` and auto-waiting.
 */

import { join } from 'path'
import { stat } from 'fs/promises'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { DialogPage } from './pages/dialog.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { byTestId } from './utils/locators'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import {
  CommentChrome,
  dragInPage,
  mouseAt,
  openCommentPage,
  resetCommentSettings,
  waitForBox,
  waitForViewShown
} from './pages/html-preview.comments-ui'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'

const SEED = {
  'README.md': '# Readme\n\nRoot document.\n',
  'notes.md': '# Notes\n\nTo be deleted.\n',
  'docs/guide.md': '# Guide\n\nNested document.\n'
}

test.use({ testProjectFiles: SEED })

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** The Delete key the tree honours on every platform. */
const DELETE_KEY = 'Delete'

test.describe('Project tree – Delete key (#463)', () => {
  test('Delete on a focused file asks first, then deletes it', async ({ windowWithTestProject: page, testProject }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)
    const target = join(testProject.path, 'notes.md')

    const row = tree.fileRow('notes.md')
    await row.focus()
    await expect(row).toBeFocused()
    await page.keyboard.press(DELETE_KEY)

    await dialog.waitForConfirm('Delete File')
    await expect(dialog.confirmMessage()).toContainText('notes.md')
    expect(await exists(target)).toBe(true)

    await dialog.accept()
    await tree.waitForFileGone('notes.md')
    await expect.poll(() => exists(target)).toBe(false)
  })

  test('Cancel in the confirmation deletes nothing', async ({ windowWithTestProject: page, testProject }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)

    const row = tree.fileRow('README.md')
    await row.focus()
    await expect(row).toBeFocused()
    await page.keyboard.press(DELETE_KEY)

    await dialog.waitForConfirm('Delete File')
    await dialog.decline()
    await expect(tree.fileRow('README.md')).toBeVisible()
    expect(await exists(join(testProject.path, 'README.md'))).toBe(true)
  })

  test('the tree menu shows the shortcut hints', async ({ windowWithTestProject: page }) => {
    const tree = new ProjectTreePage(page)

    await tree.openContextMenu(tree.fileRow('README.md'))

    for (const label of ['Cut', 'Copy', 'Delete']) {
      await expect(tree.contextMenuItem(label)).toHaveAttribute('aria-keyshortcuts', /.+/)
    }
    await page.keyboard.press('Escape')
    await expect(tree.contextMenu()).toHaveCount(0)
  })

  test('Paste on a file row pastes into that file\'s folder', async ({ windowWithTestProject: page, testProject }) => {
    const tree = new ProjectTreePage(page)

    await tree.runContextMenuAction(tree.fileRow('README.md'), 'Copy')
    await tree.expandTo(['docs'])
    await tree.runContextMenuAction(tree.fileRow('docs/guide.md'), 'Paste')

    await tree.waitForFile('docs/README.md')
    await expect.poll(() => exists(join(testProject.path, 'docs', 'README.md'))).toBe(true)
  })
})

/** Show the OpenAI API-key field, the Settings text field with no menu of its own. */
async function openApiKeyField(page: Page) {
  const tree = new ProjectTreePage(page)
  await tree.openSettings()
  const backend = byTestId(page, TEST_IDS.SETTINGS_SELECT_TRANSCRIPTION_BACKEND)
  await expect(backend).toBeEnabled()
  await backend.selectOption('openai')
  const field = byTestId(page, TEST_IDS.SETTINGS_INPUT_API_KEY)
  await expect(field).toBeVisible()
  return field
}

async function writeSystemClipboard(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
}

test.describe('Settings text field – the app-level text menu (#463)', () => {
  // A value under the key's 8-character minimum, so blurring the field never saves it.
  const PROBE = 'abc'

  test('right-click opens Cut / Copy / Paste / Delete; Paste and Delete edit the field', async ({
    windowWithTestProject: page,
    appWithTestProject: app
  }) => {
    const tree = new ProjectTreePage(page)
    const field = await openApiKeyField(page)
    await writeSystemClipboard(app, PROBE)

    // Empty field: Paste is the only enabled item; a password never lets text out.
    await field.click({ button: 'right' })
    const menu = tree.contextMenu()
    await expect(menu).toBeVisible()
    for (const label of ['Cut', 'Copy', 'Paste', 'Delete']) {
      await expect(tree.contextMenuItem(label)).toHaveAttribute('aria-keyshortcuts', /.+/)
    }
    await expect(tree.contextMenuItem('Cut')).toHaveAttribute('aria-disabled', 'true')
    await expect(tree.contextMenuItem('Copy')).toHaveAttribute('aria-disabled', 'true')
    await expect(tree.contextMenuItem('Delete')).toHaveAttribute('aria-disabled', 'true')

    await tree.contextMenuItem('Paste').click()
    await expect(menu).toHaveCount(0)
    await expect(field).toHaveValue(PROBE)

    // Select it all, then Delete removes the selection.
    await field.focus()
    await field.evaluate((el: HTMLInputElement) => el.select())
    await field.click({ button: 'right' })
    await expect(tree.contextMenuItem('Delete')).not.toHaveAttribute('aria-disabled', 'true')
    await tree.contextMenuItem('Delete').click()
    await expect(field).toHaveValue('')

    await tree.closeSettings()
  })

  test('Shift+F10 opens the same menu under the field', async ({ windowWithTestProject: page }) => {
    const tree = new ProjectTreePage(page)
    const field = await openApiKeyField(page)

    await field.focus()
    await page.keyboard.press('Shift+F10')
    await expect(tree.contextMenu()).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(tree.contextMenu()).toHaveCount(0)
    await expect(field).toBeFocused()
    await tree.closeSettings()
  })
})

const HTML_PAGE = 'clipboard/copy.html'
const HTML_TITLE = '-CLIP-COPY-'
const HTML_TARGET = HtmlPreviewPage.target(HTML_PAGE)
const HTML_LINE = 'We ship the beta to ten customers by Friday.'
/** What the system clipboard holds before the copy, so a copy that did nothing is caught. */
const CLIPBOARD_SENTINEL = 'clipboard-sentinel-Kp4Zr'

/** One wide monospace line, so a drag across its first half stays on it. */
const HTML_TEXT = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8">',
  `  <title>${HTML_TITLE}</title>`,
  '  <style>body { margin: 40px; } p { margin: 0 0 24px; font: 20px/1.6 monospace; white-space: nowrap; }</style>',
  '</head>',
  '<body>',
  `  <p id="ship">${HTML_LINE}</p>`,
  '  <p id="other">Nothing to see in this line at all.</p>',
  '</body>',
  '</html>',
  ''
].join('\n')

async function readSystemClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText())
}

/** The hint the menu exposes to assistive tech on this host. */
const COPY_KEYSHORTCUT = process.platform === 'darwin' ? 'Meta+C' : 'Control+C'

test.describe('HTML preview – Copy selection in the right-click menu (#463)', () => {
  test.use({ testProjectFiles: { [HTML_PAGE]: HTML_TEXT } })

  test.afterEach(async ({ windowWithTestProject }) => {
    await resetCommentSettings(windowWithTestProject)
  })

  test('on selected words Copy selection copies them; elsewhere it is shown, disabled', async ({
    windowWithTestProject: page,
    appWithTestProject: app
  }) => {
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'copy.html')
    await writeSystemClipboard(app, CLIPBOARD_SENTINEL)

    // Comment mode instruments a page with no comments yet, so a right-click opens Erfana's menu.
    const panelId = await openCommentPage(preview, app, HTML_PAGE, HTML_TITLE)
    await chrome.modeOn(app, panelId, HTML_TARGET)
    await waitForViewShown(app, HTML_TARGET)

    // No selection: the item is there, greyed out, with its hint.
    const other = await waitForBox(app, 'other', HTML_TARGET)
    const away = { x: Math.round(other.left + 40), y: Math.round(other.top + other.height / 2) }
    expect(await mouseAt(app, away, 'right', HTML_TARGET), 'no preview to right-click').toBe(true)
    await expect(chrome.menu()).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    const idleCopy = chrome.menu().getByTestId(TEST_IDS.CONTEXT_MENU_ITEM_COPY)
    await expect(idleCopy).toHaveAccessibleName('Copy selection')
    await expect(idleCopy).toHaveAttribute('aria-disabled', 'true')
    await expect(idleCopy).toHaveAttribute('aria-keyshortcuts', COPY_KEYSHORTCUT)
    await page.keyboard.press('Escape')
    await expect(chrome.menu()).toHaveCount(0)

    // Select the first half of the line, then right-click on the words.
    await waitForViewShown(app, HTML_TARGET)
    const box = await waitForBox(app, 'ship', HTML_TARGET)
    const y = Math.round(box.top + box.height / 2)
    const from = { x: Math.round(box.left + 2), y }
    const to = { x: Math.round(box.left + box.width * 0.45), y }
    expect(await dragInPage(app, from, to, HTML_TARGET), 'no preview to drag in').toBe(true)
    const on = { x: Math.round((from.x + to.x) / 2), y }
    expect(await mouseAt(app, on, 'right', HTML_TARGET), 'no preview to right-click').toBe(true)
    await expect(chrome.menu()).toHaveAttribute('aria-label', 'Selection', { timeout: PREVIEW_BUDGET_MS })

    const copy = chrome.menu().getByTestId(TEST_IDS.CONTEXT_MENU_ITEM_COPY)
    await expect(copy).not.toHaveAttribute('aria-disabled', 'true')
    await expect(copy).toHaveAttribute('aria-keyshortcuts', COPY_KEYSHORTCUT)
    await copy.click()
    await expect(chrome.menu()).toHaveCount(0)

    // The words went from the page to the system clipboard, and nothing else did.
    await expect
      .poll(() => readSystemClipboard(app), { timeout: PREVIEW_BUDGET_MS, message: 'the clipboard never changed' })
      .not.toBe(CLIPBOARD_SENTINEL)
    const copied = await readSystemClipboard(app)
    expect(copied.length).toBeGreaterThan(0)
    expect(HTML_LINE.startsWith(copied.trim()), `copied ${JSON.stringify(copied)}`).toBe(true)
    // No comment window opened in its place.
    await expect(chrome.window()).toHaveCount(0)
  })
})

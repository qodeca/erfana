// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: the project tree's Cmd/Ctrl+C / X / V act on the tree only when the
 * keystroke belongs to the tree ([27], lens review of v0.21.0).
 *
 * The tree listens for its clipboard shortcuts on `window`, and clicking a
 * folder leaves it selected indefinitely. The handler skipped only inputs,
 * textareas and contentEditable, so after clicking a folder, selecting text
 * anywhere else that is not an input – a dialog message, the markdown preview –
 * and pressing Cmd+C copied the FOLDER into the tree clipboard and
 * `preventDefault()`ed the native copy: the text never reached the system
 * clipboard.
 *
 * Why Playwright's key press is a faithful probe here: on macOS Playwright
 * sends Meta+C as a keydown carrying Chromium's `copy:` editing command, so
 * the copy happens only when the page does NOT cancel the keydown – the same
 * rule the app menu's Copy accelerator follows in Electron.
 *
 * The dialog is a real DialogManager ConfirmDialog, raised through the app's
 * `app:dialog` window event (the path `escape-topmost-dialog.e2e.ts` uses).
 */

import { join } from 'path'
import { stat } from 'fs/promises'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { DialogPage } from './pages/dialog.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { toastWithText } from './utils/toast'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

const SEED = {
  'README.md': '# Readme\n\nRoot document.\n',
  'docs/guide.md': '# Guide\n\nNested document.\n'
}

test.use({ testProjectFiles: SEED })

/**
 * The system clipboard is shared by every Playwright worker on the machine,
 * so each test copies its OWN sentence: a value another test wrote can then
 * only make an assertion fail, never make it pass.
 */
function messageFor(probe: string): string {
  return `Select this sentence and copy it (${probe})`
}

/** Raise a ConfirmDialog through the app's imperative dialog API. */
async function raiseConfirm(page: Page, title: string, message: string): Promise<void> {
  await page.evaluate(
    ({ dialogTitle, dialogMessage }) => {
      window.dispatchEvent(
        new CustomEvent('app:dialog', {
          detail: { type: 'confirm', config: { title: dialogTitle, message: dialogMessage } }
        })
      )
    },
    { dialogTitle: title, dialogMessage: message }
  )
}

/** Select the full text of the dialog's message, as a mouse drag would. */
async function selectConfirmMessage(page: Page): Promise<string> {
  return page.evaluate((testId) => {
    const node = document.querySelector(`[data-testid="${testId}"]`)
    if (!node) throw new Error('confirm message not found')
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    if (!selection) throw new Error('no selection object')
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString()
  }, TEST_IDS.DIALOG_CONFIRM_MESSAGE)
}

async function readSystemClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText())
}

async function writeSystemClipboard(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test.describe('Tree clipboard shortcuts stay with the tree ([27])', () => {
  // One worker, in order (not 'serial', which would skip the rest after a
  // failure): the tests share one system clipboard (see messageFor).
  test.describe.configure({ mode: 'default' })

  test('control: with no folder selected, Cmd/Ctrl+C copies selected dialog text', async ({
    windowWithTestProject: page,
    appWithTestProject: app
  }) => {
    const MESSAGE = messageFor('control')
    // Proves the probe itself: if this fails, the harness cannot copy at all
    // and the tests below would be measuring nothing.
    const dialog = new DialogPage(page)
    await writeSystemClipboard(app, 'clipboard-before')

    await raiseConfirm(page, 'Control probe', MESSAGE)
    await dialog.waitForConfirm('Control probe')
    await selectConfirmMessage(page)
    await page.keyboard.press('ControlOrMeta+c')

    await expect.poll(() => readSystemClipboard(app), { timeout: 5_000 }).toBe(MESSAGE)
    await dialog.dismissWithEscape()
  })

  test('Cmd/Ctrl+C on selected dialog text copies the text, not the clicked folder', async ({
    windowWithTestProject: page,
    appWithTestProject: app
  }) => {
    const MESSAGE = messageFor('copy')
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)

    await tree.folderRow('docs').click()
    await writeSystemClipboard(app, 'clipboard-before')

    await raiseConfirm(page, 'Copy probe', MESSAGE)
    await dialog.waitForConfirm('Copy probe')
    expect(await selectConfirmMessage(page)).toBe(MESSAGE)

    await page.keyboard.press('ControlOrMeta+c')

    await expect.poll(() => readSystemClipboard(app), { timeout: 5_000 }).toBe(MESSAGE)
    await expect(toastWithText(page, '"docs" ready to paste')).toHaveCount(0)

    await dialog.dismissWithEscape()
  })

  test('Cmd/Ctrl+X outside the tree does not cut the clicked folder', async ({
    windowWithTestProject: page,
    appWithTestProject: app
  }) => {
    const MESSAGE = messageFor('cut')
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)

    await tree.folderRow('docs').click()
    await writeSystemClipboard(app, 'clipboard-before')
    await raiseConfirm(page, 'Cut probe', MESSAGE)
    await dialog.waitForConfirm('Cut probe')
    await selectConfirmMessage(page)

    await page.keyboard.press('ControlOrMeta+x')
    // Ordering barrier: the tree's handler runs synchronously inside the
    // keydown, so by the time the NEXT shortcut's effect is observable, a
    // cut toast from the first one would already be on screen.
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => readSystemClipboard(app), { timeout: 5_000 }).toBe(MESSAGE)

    await expect(toastWithText(page, '"docs" ready to move')).toHaveCount(0)

    await dialog.dismissWithEscape()
  })

  test('Cmd/Ctrl+V outside the tree does not paste into the clicked folder', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const MESSAGE = messageFor('paste')
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)

    // Put README.md on the TREE clipboard, then select the target folder.
    await tree.runContextMenuAction(tree.fileRow('README.md'), 'Copy')
    await tree.folderRow('docs').click()

    await raiseConfirm(page, 'Paste probe', MESSAGE)
    await dialog.waitForConfirm('Paste probe')
    await page.keyboard.press('ControlOrMeta+v')

    // Ordering barrier, as above: a Cmd+C whose result is observable lands
    // after the paste's keydown handler has already run (and, if it pasted,
    // started the IPC copy).
    await writeSystemClipboard(app, 'clipboard-before')
    await selectConfirmMessage(page)
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => readSystemClipboard(app), { timeout: 5_000 }).toBe(MESSAGE)
    await dialog.dismissWithEscape()

    // The control: with focus back on the tree, the same shortcut DOES paste.
    // Waiting for that paste is what makes the absence check below honest –
    // had the in-dialog Cmd+V pasted too, this one would hit a name conflict
    // and raise the Replace prompt instead of completing.
    await tree.folderRow('docs').click()
    await page.keyboard.press('ControlOrMeta+v')
    const pasted = join(testProject.path, 'docs', 'README.md')
    await expect.poll(() => exists(pasted), { timeout: 10_000 }).toBe(true)
    await expect(dialog.confirmDialog()).toHaveCount(0)
  })

  test('Cmd/Ctrl+C with focus on the tree still copies the clicked folder', async ({
    windowWithTestProject: page
  }) => {
    const tree = new ProjectTreePage(page)

    await tree.folderRow('docs').click()
    await page.keyboard.press('ControlOrMeta+c')

    await expect(toastWithText(page, '"docs" ready to paste')).toBeVisible({ timeout: 5_000 })
  })
})

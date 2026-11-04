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

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: keyboard access fixed in v0.22.0 Wave 3.
 *
 * - #91: a BaseDialog that says `aria-modal="true"` keeps Tab inside itself.
 *   The probe is a DialogManager ConfirmDialog – one of the dialogs that did
 *   NOT trap before #91 – raised through the app's `app:dialog` event, plus
 *   the Rename dialog from the tree's context menu (the issue's own example).
 *   Closing the ConfirmDialog returns focus to what opened it; before #91 the
 *   DialogManager dialogs (which close by unmounting) returned it nowhere.
 * - [24]: a recent project can be opened with the keyboard alone: Tab into the
 *   list, arrow to the row, Enter.
 *
 * Real Chromium tabbing matters here: jsdom performs no native Tab, so the
 * unit suites can only prove the trap cancels the keystroke at the edges.
 */

import { mkdtemp, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { E2E_TEMP_DIR, removeDirWithRetry } from './fixtures/isolation'
import { DialogPage } from './pages/dialog.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { byTestId } from './utils/locators'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

test.use({ testProjectFiles: { 'a.md': '# A\n', 'docs/guide.md': '# Guide\n' } })

/** More presses than any dialog has controls, so a leak cannot hide. */
const TAB_PRESSES = 8

/** Raise a ConfirmDialog through the app's imperative dialog API. */
async function raiseConfirm(page: Page, title: string): Promise<void> {
  await page.evaluate((dialogTitle) => {
    window.dispatchEvent(
      new CustomEvent('app:dialog', {
        detail: { type: 'confirm', config: { title: dialogTitle, message: `${dialogTitle}?` } }
      })
    )
  }, title)
}

/** Press Tab (or Shift+Tab) repeatedly, asserting focus stays in `container`. */
async function expectTabStaysInside(page: Page, container: Locator, shift: boolean): Promise<void> {
  const key = shift ? 'Shift+Tab' : 'Tab'
  for (let i = 0; i < TAB_PRESSES; i++) {
    await page.keyboard.press(key)
    await expect
      .poll(() => container.evaluate((el) => el.contains(document.activeElement)), {
        message: `focus left the dialog after ${i + 1} × ${key}`
      })
      .toBe(true)
  }
}

test.describe('Dialogs keep focus inside (#91)', () => {
  test('a ConfirmDialog traps Tab and Shift+Tab, and returns focus to its opener', async ({
    windowWithTestProject: page
  }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)
    const container = byTestId(page, TEST_IDS.DIALOG_CONTAINER)

    // The opener: a tree row, focused by the click.
    const opener = tree.folderRow('docs')
    await opener.click()
    await expect(opener).toBeFocused()

    await raiseConfirm(page, 'Trap probe')
    await dialog.waitForConfirm('Trap probe')
    await expect(container).toHaveAttribute('aria-modal', 'true')
    await expect
      .poll(() => container.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true)

    await expectTabStaysInside(page, container, false)
    await expectTabStaysInside(page, container, true)

    await dialog.dismissWithEscape()
    await expect(opener).toBeFocused()
  })

  test('the Rename dialog from the tree traps Tab', async ({ windowWithTestProject: page }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)
    const container = byTestId(page, TEST_IDS.DIALOG_CONTAINER)

    await tree.runContextMenuAction(tree.fileRow('a.md'), 'Rename')
    await expect(dialog.nameInput()).toBeFocused()

    await expectTabStaysInside(page, container, false)
    await expectTabStaysInside(page, container, true)

    await page.keyboard.press('Escape')
    await expect(container).toHaveCount(0)
  })
})

/**
 * Focus must end up back in the project tree – not on <body> – after a dialog
 * opened from the tree's context menu closes. Menu items are not focusable, so
 * picking one used to drop focus to <body> before the dialog even opened; and
 * Rename / Delete remove the very row that opened the dialog.
 */
test.describe('Focus returns to the tree after a context-menu dialog (#91 review)', () => {
  async function expectFocusInTree(page: Page): Promise<void> {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement
          return active !== null && active.closest('[role="tree"]') !== null
        })
      )
      .toBe(true)
  }

  test('New File', async ({ windowWithTestProject: page }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)

    await tree.runContextMenuAction(tree.folderRow('docs'), 'New File')
    await expect(dialog.nameInput()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(byTestId(page, TEST_IDS.DIALOG_CONTAINER)).toHaveCount(0)

    await expect(tree.folderRow('docs')).toBeFocused()
  })

  test('Rename', async ({ windowWithTestProject: page }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)

    await tree.runContextMenuAction(tree.fileRow('a.md'), 'Rename')
    await dialog.submitName('b.md', 'Rename')
    await tree.waitForFile('b.md')

    await expectFocusInTree(page)
  })

  test('Delete', async ({ windowWithTestProject: page }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)

    await tree.runContextMenuAction(tree.fileRow('a.md'), 'Delete')
    await dialog.accept()
    await tree.waitForFileGone('a.md')

    await expectFocusInTree(page)
  })
})

test.describe('Recent projects with the keyboard ([24])', () => {
  const extraProjects: string[] = []

  test.afterEach(async () => {
    for (const dir of extraProjects.splice(0)) await removeDirWithRetry(dir)
  })

  test('Tab into the list, arrow to a project, Enter opens it', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)

    // A second project on the recents list, then back to the test project,
    // so the list reads: test project (newest), then the second one.
    const other = await mkdtemp(join(E2E_TEMP_DIR, 'recents-kbd-'))
    extraProjects.push(other)
    await writeFile(join(other, 'other.md'), '# Other\n', 'utf-8')
    await page.evaluate(async (paths) => {
      const api = (window as unknown as { api: { file: { openProjectByPath(p: string): Promise<string> } } }).api
      for (const p of paths) await api.file.openProjectByPath(p)
    }, [other, testProject.path])
    await tree.waitForFile('a.md')

    await page.locator('.welcome-tab').click()
    const current = tree.recentProject(basename(testProject.path)).locator('.recent-project-open')
    const target = tree.recentProject(basename(other)).locator('.recent-project-open')
    await expect(target).toBeAttached({ timeout: 10_000 })

    // Keyboard only from here. With a project open the Welcome panel's last
    // action is Import; one Tab past it is the list.
    await byTestId(page, TEST_IDS.WELCOME_BTN_IMPORT).focus()
    await page.keyboard.press('Tab')
    await expect(current).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(target).toBeFocused()

    await page.keyboard.press('Enter')
    await tree.waitForFile('other.md')
  })
})

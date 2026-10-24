// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: context menus are keyboard-operable (#90, part of #87), per the decided
 * Menu card (design/system/components/menu/index.html).
 *
 * - The tree row's menu: Shift+F10 opens it with focus on the first item, the
 *   arrows move with wrap, Home / End jump, typeahead jumps, Escape closes it
 *   and returns focus to the row.
 * - A dock tab's menu: Shift+F10 on the focused tab opens it, Tab closes it
 *   and returns focus to the tab.
 *
 * Condition-based waits only.
 */

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'

/** The focused menu item's label, or null when focus is not on a menu item. */
async function focusedItem(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el.getAttribute('role') !== 'menuitem') return null
    return el.querySelector('.context-menu-label')?.textContent ?? null
  })
}

/** Every item label of the open menu, in order. */
async function itemLabels(page: Page): Promise<string[]> {
  return page.locator('[role="menu"] [role="menuitem"] .context-menu-label').allTextContents()
}

test.describe('Context menu keyboard (#90)', () => {
  test.use({
    testProjectFiles: {
      'README.md': '# Readme\n',
      'notes.md': '# Notes\n'
    }
  })

  test('a tree row menu: open, move, jump, and Escape back to the row', async ({ windowWithTestProject: page }) => {
    const tree = new ProjectTreePage(page)
    const row = tree.fileRow('notes.md')
    await row.focus()

    await page.keyboard.press('Shift+F10')
    await expect(tree.contextMenu()).toBeVisible()

    const labels = await itemLabels(page)
    expect(labels.length).toBeGreaterThan(2)
    // Focus moved into the menu, onto its first item, and that item is the
    // only Tab stop.
    await expect.poll(() => focusedItem(page)).toBe(labels[0])
    await expect(tree.contextMenu().locator('[role="menuitem"][tabindex="0"]')).toHaveCount(1)

    await page.keyboard.press('ArrowDown')
    await expect.poll(() => focusedItem(page)).toBe(labels[1])
    await page.keyboard.press('End')
    await expect.poll(() => focusedItem(page)).toBe(labels[labels.length - 1])
    // Wraps from the last item to the first.
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => focusedItem(page)).toBe(labels[0])
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => focusedItem(page)).toBe(labels[labels.length - 1])
    await page.keyboard.press('Home')
    await expect.poll(() => focusedItem(page)).toBe(labels[0])

    // Typeahead: the first letter of a later item jumps to it.
    const target = labels.slice(1).find((label) => !labels[0].toLowerCase().startsWith(label[0].toLowerCase()))
    if (target !== undefined) {
      await page.keyboard.press(target[0].toLowerCase())
      await expect.poll(async () => (await focusedItem(page))?.[0]?.toLowerCase()).toBe(target[0].toLowerCase())
    }

    await page.keyboard.press('Escape')
    await expect(tree.contextMenu()).toHaveCount(0)
    await expect(row).toBeFocused()
  })

  test('a tab menu: Shift+F10 on the focused tab, Tab closes it and returns focus', async ({
    windowWithTestProject: page
  }) => {
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    await tree.clickFileByName('README.md')
    await tabs.waitForTab('README.md')

    // The focusable element is dockview's wrapper around the rendered tab.
    const dvTab = page.locator('.dv-tab').filter({ has: tabs.tab('README.md') })
    await dvTab.focus()
    await page.keyboard.press('Shift+F10')

    await expect(tabs.contextMenu()).toBeVisible()
    await expect.poll(() => focusedItem(page)).toBe('Close')

    await page.keyboard.press('Tab')
    await expect(tabs.contextMenu()).toHaveCount(0)
    await expect(dvTab).toBeFocused()
    // Closing the menu ran nothing: the tab is still open.
    await expect(tabs.tab('README.md')).toHaveCount(1)
  })
})

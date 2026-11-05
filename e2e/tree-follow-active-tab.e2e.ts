// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: the project tree follows the active tab (#453).
 *
 * Switching tabs opens the folders down to the tab's file, scrolls its row
 * into view and marks it (`aria-current` – the lime underline of the decided
 * card docs/design-system/system/components/tree-active-file/index.html),
 * while keyboard focus stays in the editor. Folders opened only by the reveal
 * close on the next switch; a folder the person opened stays. Tab into the
 * tree lands on the revealed file. Settings > Project tree > Follow the active
 * tab turns it all off.
 *
 * The filter case, the "worked inside" rule and the outside-the-project case
 * are held by `ProjectTree.reveal.test.tsx` and `revealActiveFile.test.ts`.
 */

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'

/** Where DOM focus is: inside the tree, inside the editor area, and the row path if a row. */
async function focusPlace(page: Page): Promise<{ inTree: boolean; inEditor: boolean; path: string | null }> {
  return page.evaluate((editorArea) => {
    const el = document.activeElement as HTMLElement | null
    return {
      inTree: !!el?.closest('[role="tree"]'),
      inEditor: !!el?.closest(`[data-testid="${editorArea}"]`),
      path: el?.dataset?.path ?? null
    }
  }, TEST_IDS.EDITOR_AREA)
}

/** Open a file through the tree, so it gets a tab; returns once its editor shows. */
async function openThroughTree(tree: ProjectTreePage, tabs: TabBarPage, relPath: string): Promise<void> {
  await tree.fileRow(relPath).click()
  await tabs.waitForTab(relPath.slice(relPath.lastIndexOf('/') + 1))
}

/** Close a folder by hand (a click on its row). */
async function closeFolder(tree: ProjectTreePage, relPath: string): Promise<void> {
  await tree.folderRow(relPath).click()
  await expect(tree.folderRow(relPath)).toHaveAttribute('aria-expanded', 'false')
}

test.describe('Project tree follows the active tab (#453)', () => {
  test.use({
    testProjectFiles: {
      'README.md': '# Readme\n',
      'docs/guide.md': '# Guide\n',
      'src/services/toast.md': '# Toast\n'
    }
  })

  test('reveals the active tab, keeps focus in the editor and closes only what it opened', async ({
    windowWithTestProject: page
  }, testInfo) => {
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)

    // Three tabs, opened through the tree, then every folder closed by hand
    // – innermost first, so nothing stays open inside a closed folder.
    await tree.expandTo(['src'])
    await tree.expandTo(['src/services'])
    await openThroughTree(tree, tabs, 'src/services/toast.md')
    await tree.expandTo(['docs'])
    await openThroughTree(tree, tabs, 'docs/guide.md')
    await openThroughTree(tree, tabs, 'README.md')
    await expect(tree.fileRow('README.md')).toHaveAttribute('aria-current', 'true')
    await closeFolder(tree, 'src/services')
    await closeFolder(tree, 'src')
    await closeFolder(tree, 'docs')

    // Switch to toast.md from the tab bar: its folders open, its row is marked
    await tabs.activate('toast.md')
    await expect(tree.folderRow('src')).toHaveAttribute('aria-expanded', 'true')
    await expect(tree.folderRow('src/services')).toHaveAttribute('aria-expanded', 'true')
    await expect(tree.fileRow('src/services/toast.md')).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('[role="tree"] [aria-current="true"]')).toHaveCount(1)
    await expect(tree.fileRow('src/services/toast.md')).toBeInViewport()
    await expect.poll(async () => (await focusPlace(page)).inEditor).toBe(true)
    expect((await focusPlace(page)).inTree).toBe(false)
    await page.locator('.project-tree').screenshot({ path: testInfo.outputPath('453-revealed-tree.png') })

    // The person opens docs; the next switch closes src and services only
    await tree.folderRow('docs').click()
    await expect(tree.folderRow('docs')).toHaveAttribute('aria-expanded', 'true')
    await tabs.activate('README.md')
    await expect(tree.fileRow('README.md')).toHaveAttribute('aria-current', 'true')
    await expect(tree.folderRow('src')).toHaveAttribute('aria-expanded', 'false')
    await expect(tree.folderRow('src/services')).toHaveCount(0)
    await expect(tree.folderRow('docs')).toHaveAttribute('aria-expanded', 'true')

    // Tab into the tree lands on the revealed file
    await byTestId(page, TEST_IDS.PROJECT_TREE_BTN_REFRESH).focus()
    await page.keyboard.press('Tab')
    await expect.poll(async () => (await focusPlace(page)).path ?? '').toMatch(/README\.md$/)
  })

  test('Settings > Project tree > Follow the active tab turns it off', async ({ windowWithTestProject: page }, testInfo) => {
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    await tree.expandTo(['docs'])
    await openThroughTree(tree, tabs, 'docs/guide.md')
    await openThroughTree(tree, tabs, 'README.md')
    await closeFolder(tree, 'docs')

    await tree.openSettings()
    const section = page.getByRole('region', { name: 'Project tree' })
    const toggle = section.getByRole('checkbox', { name: 'Follow the active tab' })
    await expect(toggle).toBeChecked()
    await section.screenshot({ path: testInfo.outputPath('453-settings-section.png') })
    await toggle.uncheck()
    await expect(toggle).not.toBeChecked()
    await tree.closeSettings()

    await tabs.activate('guide.md')
    await expect(tree.folderRow('docs')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('[role="tree"] [aria-current="true"]')).toHaveCount(0)

    // On again: the active tab is revealed at once
    await tree.openSettings()
    await page.getByRole('checkbox', { name: 'Follow the active tab' }).check()
    await tree.closeSettings()
    await expect(tree.fileRow('docs/guide.md')).toHaveAttribute('aria-current', 'true')
  })
})

test.describe('Project tree follows the active tab – scroll (#453)', () => {
  const many: Record<string, string> = { 'README.md': '# Readme\n' }
  for (let i = 0; i < 60; i++) many[`big/file-${String(i).padStart(2, '0')}.md`] = `# ${i}\n`
  test.use({ testProjectFiles: many })

  test('scrolls a revealed row that is out of view into view', async ({ windowWithTestProject: page }) => {
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const content = page.locator('.project-tree-content')

    await openThroughTree(tree, tabs, 'README.md')
    await tree.expandTo(['big'])
    await content.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await openThroughTree(tree, tabs, 'big/file-59.md')
    // README sits below the 60 files, so this reveal scrolls down to it
    await tabs.activate('README.md')
    await expect(tree.fileRow('README.md')).toBeInViewport({ ratio: 1 })
    await content.evaluate((el) => { el.scrollTop = 0 })
    await closeFolder(tree, 'big')

    await tabs.activate('file-59.md')
    await expect(tree.fileRow('big/file-59.md')).toHaveAttribute('aria-current', 'true')
    await expect(tree.fileRow('big/file-59.md')).toBeInViewport({ ratio: 1 })
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Open tabs whose file disappears where the project watcher cannot see it,
 * and tabs restored by a save (#252, after #251).
 *
 * - A file in an ignored folder (`dist` is on the default watcher ignore list;
 *   the tree still lists it, lazily): renaming the folder outside the app used
 *   to leave the tab looking normal. It is now marked deleted, by the
 *   single-file watch's own check.
 * - A file restored with "Save to restore it" used to stay unwatched until the
 *   tab was reopened, so a later outside edit never reached the editor. It is
 *   watched again and reloads.
 *
 * The third case of #252 (a removal while the project watch is paused for the
 * app's own operation) needs an outside change inside that window and is
 * covered by unit tests only.
 *
 * Waits are condition-based only (Playwright auto-waiting, `expect.poll` and
 * `toPass`).
 */

import { readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'

/** The 2 s re-check, the atomic-save window and the existence re-check, with CI headroom. */
const BUDGET_MS = 15_000
/** One outside write reaching the editor: chokidar's write settle, the debounce and the reload. */
const ONE_RELOAD_MS = 4_000
const DELETED_BANNER = 'This file was deleted on disk. Save to restore it.'

test.describe('Open tab whose file vanished where the project watcher cannot see', () => {
  test.use({
    testProjectFiles: {
      'dist/notes.md': '# Notes\n\nBuilt output notes.\n',
      'other.md': '# Other\n'
    }
  })

  test('marks the tab deleted when its ignored folder is renamed outside the app', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const panel = new EditorPanelPage(page)

    await tree.expandTo(['dist'])
    await tree.fileRow('dist/notes.md').click()
    await tabs.waitForTab('notes.md')
    await panel.waitForReady()

    await rename(join(testProject.path, 'dist'), join(testProject.path, 'dist-old'))

    await expect(tabs.tab('notes.md').locator('.editor-tab-deleted')).toBeVisible({ timeout: BUDGET_MS })
    await expect(page.getByText(DELETED_BANNER)).toBeVisible()
  })
})

test.describe('Open tab restored by a save', () => {
  test.use({
    testProjectFiles: {
      'docs/open.md': '# Open\n\nOriginal body.\n',
      'other.md': '# Other\n'
    }
  })

  test('is watched again, so a later outside edit reloads it', async ({
    windowWithTestProject: page,
    testProject,
    keyboardHelper
  }) => {
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const panel = new EditorPanelPage(page)
    const monaco = new MonacoPage(page, new KeyboardHelper(page))
    const filePath = join(testProject.path, 'docs', 'open.md')
    const deletedMarker = tabs.tab('open.md').locator('.editor-tab-deleted')

    await tree.expandTo(['docs'])
    await tree.fileRow('docs/open.md').click()
    await tabs.waitForTab('open.md')
    await panel.waitForReady()
    await panel.setViewMode('editor')
    await monaco.waitForReady()

    // Deleted outside the app: the tab shows the banner
    await rm(filePath)
    await expect(deletedMarker).toBeVisible({ timeout: BUDGET_MS })

    // "Save to restore it"
    await page.keyboard.press(`${await keyboardHelper.getModifier()}+s`)
    await expect
      .poll(async () => readFile(filePath, 'utf-8').catch(() => ''), { timeout: BUDGET_MS })
      .toContain('Original body.')
    await expect(deletedMarker).toHaveCount(0)
    await expect(tabs.dirtyDot('open.md')).toHaveCount(0)

    // An outside edit now reaches the editor. The new watch is armed shortly
    // after the save, and a write before that is not an event, so each attempt
    // writes a fresh marker until one is seen.
    let attempt = 0
    await expect(async () => {
      attempt += 1
      const marker = `outside edit ${attempt}`
      await writeFile(filePath, `# Open\n\n${marker}\n`)
      await expect.poll(async () => monaco.visibleText(), { timeout: ONE_RELOAD_MS }).toContain(marker)
    }).toPass({ timeout: BUDGET_MS })
  })
})

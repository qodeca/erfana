// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Saving a file whose folder was renamed outside the app (found during the
 * v0.21.0 macOS validation).
 *
 * Before the fix: renaming `docs/` to `docs2/` left the open `docs/open.md` tab
 * looking normal - no "(deleted)" marker, no banner - and the next save failed
 * with ENOENT into the log only, with no toast and the edit landing nowhere.
 *
 * Now: the tab is marked deleted with the usual banner; an autosave in that
 * state fails visibly (error toast) without recreating the folder; and the
 * banner's "Save to restore it" (a manual save) recreates `docs/` and writes the
 * buffer back to the original path.
 *
 * Waits are condition-based only (Playwright auto-waiting and `expect.poll`).
 */

import { readFile, rename, stat } from 'fs/promises'
import { join } from 'path'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { toastWithText } from './utils/toast'

/** Watcher latency plus the 2 s autosave debounce, with CI headroom. */
const BUDGET_MS = 15_000

test.use({
  testProjectFiles: {
    'docs/open.md': '# Open\n\nOriginal body.\n',
    'other.md': '# Other\n'
  }
})

test.describe('Save after the parent folder is renamed outside the app', () => {
  test('marks the tab deleted, reports a failed autosave, and restores on manual save', async ({
    windowWithTestProject: page,
    testProject,
    keyboardHelper
  }) => {
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const panel = new EditorPanelPage(page)
    const monaco = new MonacoPage(page, new KeyboardHelper(page))
    const deletedMarker = tabs.tab('open.md').locator('.editor-tab-deleted')

    await tree.expandTo(['docs'])
    await tree.fileRow('docs/open.md').click()
    await tabs.waitForTab('open.md')
    await panel.waitForReady()
    await panel.setViewMode('editor')
    await monaco.waitForReady()

    // Rename the folder behind the app's back
    await rename(join(testProject.path, 'docs'), join(testProject.path, 'docs2'))
    await expect(tree.folderRow('docs2')).toBeVisible({ timeout: BUDGET_MS })

    // 1. Treated like a delete: "(deleted)" in the tab, the banner in the panel
    await expect(deletedMarker).toBeVisible({ timeout: BUDGET_MS })
    await expect(page.getByText('This file was deleted on disk. Save to restore it.')).toBeVisible()

    // 2. An autosave in this state fails visibly and does not recreate the folder
    await monaco.appendContent('\nedit after rename\n')
    await expect(toastWithText(page, 'its folder no longer exists on disk')).toBeVisible({
      timeout: BUDGET_MS
    })
    await expect(stat(join(testProject.path, 'docs'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(deletedMarker).toBeVisible()
    await expect(tabs.dirtyDot('open.md')).toBeVisible()

    // 3. "Save to restore it": a manual save recreates docs/ and writes the buffer
    await page.keyboard.press(`${await keyboardHelper.getModifier()}+s`)
    await expect
      .poll(async () => readFile(join(testProject.path, 'docs', 'open.md'), 'utf-8').catch(() => ''), {
        timeout: BUDGET_MS
      })
      .toContain('edit after rename')
    expect(await readFile(join(testProject.path, 'docs', 'open.md'), 'utf-8')).toContain('Original body.')
    await expect(deletedMarker).toHaveCount(0)
    await expect(page.getByText('This file was deleted on disk. Save to restore it.')).toHaveCount(0)
    // The renamed copy is left exactly as the outside rename left it
    expect(await readFile(join(testProject.path, 'docs2', 'open.md'), 'utf-8')).not.toContain(
      'edit after rename'
    )
  })
})

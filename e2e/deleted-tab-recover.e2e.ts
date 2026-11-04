// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A tab whose file was deleted on disk recovers when the file comes back
 * (issue #450).
 *
 * A git branch switch or a merge deletes an open file and puts it back seconds
 * later. The delete ends the file's watch, so the tab used to say "deleted on
 * disk" until the user saved. Each test here deletes an open file outside the
 * app, waits for the deleted state, writes the file back with new content and
 * expects the tab to return to normal, showing that new content, within the
 * issue's 10 s – for the Markdown editor, the image viewer and the HTML preview.
 *
 * The editor test also keeps a second file deleted, and checks that its tab
 * still shows the deleted state once the first tab has recovered: both tabs
 * look on the same clock, so by then the gone file has been looked for too.
 *
 * A tab the user typed in while it was deleted gets the "file changed on disk"
 * choice instead of the disk's text; that needs a restore inside the 2 s before
 * autosave writes the buffer back itself, so it is covered by unit tests
 * (`useFileWatcher.restore.test.ts`) rather than raced here.
 *
 * Waits are condition-based only (Playwright auto-waiting and `expect.poll`).
 */

import { rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { ImageViewerPage } from './pages/image-viewer.page'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'

/** The delete reaching the tab: the watcher's settle, the atomic-save window and the existence re-check. */
const DELETE_BUDGET_MS = 15_000
/** The issue's acceptance budget for a returned file to show in its tab. */
const RECOVER_BUDGET_MS = 10_000
const DELETED_BANNER = 'This file was deleted on disk. Save to restore it.'

test.describe('Editor tab whose file is deleted and comes back', () => {
  test.use({
    testProjectFiles: {
      'docs/returns.md': '# Returns\n\nOriginal body.\n',
      'docs/stays-gone.md': '# Stays gone\n',
      'other.md': '# Other\n'
    }
  })

  test('reloads the returned file on its own; a file that stays gone stays deleted', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const panel = new EditorPanelPage(page)
    const monaco = new MonacoPage(page, new KeyboardHelper(page))
    const returns = join(testProject.path, 'docs', 'returns.md')
    const staysGone = join(testProject.path, 'docs', 'stays-gone.md')
    const returnsDeleted = tabs.tab('returns.md').locator('.editor-tab-deleted')
    const staysGoneDeleted = tabs.tab('stays-gone.md').locator('.editor-tab-deleted')

    await tree.expandTo(['docs'])
    await tree.fileRow('docs/stays-gone.md').click()
    await tabs.waitForTab('stays-gone.md')
    await panel.waitForReady()
    await tree.fileRow('docs/returns.md').click()
    await tabs.waitForTab('returns.md')
    await panel.waitForReady()
    await panel.setViewMode('editor')
    await monaco.waitForReady()

    // Both deleted outside the app (a branch switch)
    await rm(returns)
    await rm(staysGone)
    await expect(returnsDeleted).toBeVisible({ timeout: DELETE_BUDGET_MS })
    await expect(staysGoneDeleted).toBeVisible({ timeout: DELETE_BUDGET_MS })
    await expect(page.getByText(DELETED_BANNER)).toBeVisible()

    // One comes back, with the other branch's content
    await writeFile(returns, '# Returns\n\nFrom the other branch.\n')

    await expect(returnsDeleted).toHaveCount(0, { timeout: RECOVER_BUDGET_MS })
    await expect(page.getByText(DELETED_BANNER)).toHaveCount(0)
    await expect.poll(async () => monaco.visibleText(), { timeout: RECOVER_BUDGET_MS }).toContain('From the other branch.')
    await expect(tabs.dirtyDot('returns.md')).toHaveCount(0)

    // The file that never came back still says so
    await expect(staysGoneDeleted).toBeVisible()
  })
})

test.describe('Image tab whose file is deleted and comes back', () => {
  const svg = (marker: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" data-marker="${marker}" width="120" height="120" viewBox="0 0 120 120">` +
    `<rect width="120" height="120" fill="#1f1f1f"/></svg>\n`

  test.use({
    testProjectFiles: {
      'icon.svg': svg('v1'),
      'notes.md': '# Notes\n'
    }
  })

  test('drops the deleted banner and paints the returned image on its own', async ({
    windowWithTestProject,
    testProject
  }) => {
    const viewer = new ImageViewerPage(windowWithTestProject, DELETE_BUDGET_MS)
    const iconPath = join(testProject.path, 'icon.svg')

    await viewer.openFromTree('icon.svg')
    expect(await viewer.marker()).toBe('v1')

    await rm(iconPath)
    await viewer.expectBanner('deleted')

    await writeFile(iconPath, svg('v2'), 'utf-8')

    await viewer.expectNoBanner(RECOVER_BUDGET_MS)
    await viewer.waitForMarker('v2', RECOVER_BUDGET_MS)
  })
})

test.describe('HTML preview tab whose page is deleted and comes back', () => {
  const html = (sentinel: string): string =>
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Page ${sentinel}</title></head>` +
    `<body><h1>${sentinel}</h1></body></html>\n`

  test.use({
    testProjectFiles: {
      'page.html': html('-FIRST-'),
      'notes.md': '# Notes\n'
    }
  })

  test('leaves the failed state and shows the returned page on its own', async ({
    windowWithTestProject: page,
    appWithTestProject,
    testProject
  }) => {
    const preview = new HtmlPreviewPage(page, appWithTestProject)
    const pagePath = join(testProject.path, 'page.html')
    // Page-wide: the failed view has no placeholder, so `preview.panel()` cannot
    // find it, and this is the only preview open.
    const failedBanner = page.getByRole('alert').filter({ hasText: 'The preview stopped running.' })

    await preview.open('page.html')
    await preview.waitForTitled('-FIRST-')

    await rm(pagePath)
    await expect(failedBanner).toBeVisible({ timeout: PREVIEW_BUDGET_MS })

    await writeFile(pagePath, html('-SECOND-'), 'utf-8')

    await expect(failedBanner).toHaveCount(0, { timeout: RECOVER_BUDGET_MS })
    await preview.waitForTitled('-SECOND-')
  })
})

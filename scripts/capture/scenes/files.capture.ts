// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `files`: the project tree with git badges, its right-click menus, the
 * filter, and the new-file, replace and delete dialogs. Guide pages:
 * how-to/organise-project-files.md, reference/project-tree.md,
 * reference/menus.md, how-to/preview-an-html-page.md.
 */

import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { ProjectTreePage } from '../../../e2e/pages/project-tree.page'
import { launch, openProject } from '../lib/app'
import { anySelected, shot } from '../lib/shots'

const ROWS = [
  'organise-files/tree',
  'organise-files/folder-menu',
  'organise-files/html-file-menu',
  'organise-files/filter',
  'organise-files/new-file-dialog',
  'organise-files/name-clash',
  'organise-files/delete-confirm'
]

test('files', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch()
  const { page, sandbox: sb } = cap
  try {
    await openProject(cap)
    const tree = new ProjectTreePage(page)
    const panel = page.locator('.project-panel')
    const menu = page.getByTestId(TEST_IDS.CONTEXT_MENU)
    const dialog = page.getByTestId(TEST_IDS.DIALOG_CONTAINER)

    await tree.expandTo(['handbook', 'drafts'])
    await tree.expectStatus(tree.gitBadge('handbook/getting-involved.md'), 'modified')
    await expect(page.getByTestId(TEST_IDS.GIT_STATUS_BAR)).toBeVisible()
    await shot(cap, 'organise-files/tree', { crop: panel, pad: 0 })

    await tree.openContextMenu(tree.folderRow('handbook'))
    await shot(cap, 'organise-files/folder-menu', { crop: [panel, menu], pad: 0 })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await tree.expandTo(['site'])
    await tree.openContextMenu(tree.fileRow('site/index.html'))
    await shot(cap, 'organise-files/html-file-menu', { crop: [panel, menu], pad: 0 })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_NEW_FILE).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Create New File')
    await shot(cap, 'organise-files/new-file-dialog', { crop: dialog, pad: 16 })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    // A second compost-guide.md, in drafts/, then cut it and paste it into
    // handbook/, which already has one.
    fs.copyFileSync(path.join(sb.project, 'handbook', 'compost-guide.md'), path.join(sb.project, 'drafts', 'compost-guide.md'))
    await expect(tree.fileRow('drafts/compost-guide.md')).toBeVisible({ timeout: 15_000 })
    await tree.runContextMenuAction(tree.fileRow('drafts/compost-guide.md'), 'Cut')
    await tree.runContextMenuAction(tree.folderRow('handbook'), 'Paste')
    await expect(dialog).toBeVisible()
    await shot(cap, 'organise-files/name-clash', { crop: dialog, pad: 16 })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await tree.runContextMenuAction(tree.fileRow('drafts/ideas.md'), 'Delete')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Delete File')
    await shot(cap, 'organise-files/delete-confirm', { crop: dialog, pad: 16 })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    // The filter, with Markdown Only chosen and the options left open.
    await page.locator('.control-panel-chevron').click()
    await page.locator('.filter-option', { hasText: 'Markdown Only' }).click()
    await expect(tree.fileRow('site/index.html')).toHaveCount(0)
    if (!(await page.locator('.filter-option').first().isVisible())) await page.locator('.control-panel-chevron').click()
    await expect(page.locator('.filter-option').first()).toBeVisible()
    await shot(cap, 'organise-files/filter', { crop: panel, pad: 0 })
  } finally {
    await cap.close()
  }
})

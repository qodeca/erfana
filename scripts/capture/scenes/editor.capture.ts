// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `editor`: view modes, the formatting toolbar, find, the statistics
 * bar, a file changed on disk, the frontmatter table and the unsaved-changes
 * prompt. Guide pages: how-to/edit-and-preview-markdown.md,
 * reference/editor.md, reference/markdown-preview.md.
 */

import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { launch, openFile, openProject, setViewMode, visible, type Capture } from '../lib/app'
import { anySelected, shot } from '../lib/shots'

const ROWS = [
  'edit-and-preview/view-modes',
  'edit-and-preview/split-horizontal',
  'edit-and-preview/formatting-toolbar',
  'edit-and-preview/find-bar',
  'edit-and-preview/stats-bar',
  'edit-and-preview/file-changed-on-disk',
  'edit-and-preview/frontmatter',
  'several-windows/unsaved-changes'
]

/** Type at the end of the visible editor's first line, as a user would. */
async function typeInEditor(cap: Capture, text: string): Promise<void> {
  const line = visible(cap.page, TEST_IDS.EDITOR_MONACO).locator('.view-line').first()
  await line.click({ position: { x: 1, y: 4 } })
  await cap.page.keyboard.press('End')
  await cap.page.keyboard.type(text)
}

test('editor', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch()
  const { page, sandbox: sb } = cap
  try {
    await openProject(cap)
    // Close the terminal panel: every shot here is of the editor, which gets the room.
    await page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL).click()
    await expect(page.getByTestId(TEST_IDS.TERMINAL_INSTANCE)).toBeHidden()

    // README.md: frontmatter as a table (it opens in Preview).
    await openFile(cap, 'README.md')
    const preview = visible(page, TEST_IDS.EDITOR_PREVIEW)
    await expect(preview.locator('table.frontmatter-table')).toBeVisible()
    await shot(cap, 'edit-and-preview/frontmatter', { crop: visible(page, TEST_IDS.PREVIEW_PANE), pad: 0 })

    // View-mode buttons (Split vertical active) and the formatting buttons.
    await setViewMode(page, 'split')
    const buttons = (ids: string[]) => ids.map((id) => visible(page, id))
    await shot(cap, 'edit-and-preview/view-modes', {
      crop: buttons([TEST_IDS.VIEW_MODE_BTN_EDITOR, TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL, TEST_IDS.VIEW_MODE_BTN_SPLIT, TEST_IDS.VIEW_MODE_BTN_PREVIEW]),
      pad: 10
    })
    await shot(cap, 'edit-and-preview/formatting-toolbar', {
      crop: buttons([TEST_IDS.TOOLBAR_BTN_BOLD, TEST_IDS.TOOLBAR_BTN_LIST_ORDERED]),
      pad: 10
    })

    // Split horizontal: preview on top, editor below.
    await setViewMode(page, 'split-horizontal')
    const panel = page.locator('.markdown-editor-panel').filter({ visible: true })
    await shot(cap, 'edit-and-preview/split-horizontal', { crop: panel, pad: 0 })
    await setViewMode(page, 'split')

    // The statistics bar with a selection.
    const firstLine = visible(page, TEST_IDS.EDITOR_MONACO).locator('.view-line', { hasText: /Welcome\sto\sthe/ }).first()
    await firstLine.click({ clickCount: 3 })
    await expect(visible(page, TEST_IDS.STATS_SELECTION)).toBeVisible()
    await shot(cap, 'edit-and-preview/stats-bar', { crop: visible(page, TEST_IDS.DOCUMENT_STATS_BAR), pad: 0 })

    // Find: "compost" in the compost guide.
    await openFile(cap, 'handbook/compost-guide.md', 'split')
    await visible(page, TEST_IDS.TOOLBAR_BTN_SEARCH).click()
    const input = visible(page, TEST_IDS.SEARCH_BAR_INPUT)
    await expect(input).toBeVisible()
    await input.fill('compost')
    await expect(visible(page, TEST_IDS.SEARCH_BAR_COUNT)).toHaveText(/\d/)
    await shot(cap, 'edit-and-preview/find-bar', { crop: page.locator('.markdown-editor-panel').filter({ visible: true }), pad: 0 })
    await page.keyboard.press('Escape')

    if (anySelected(['edit-and-preview/file-changed-on-disk'])) {
      // An unsaved edit, then the file changes on disk. The file is made
      // read-only first, so the autosave 2 s later fails and cannot clear the
      // notice before the shot (the failure's toast is dismissed by `shot`).
      await openFile(cap, 'handbook/getting-involved.md', 'split')
      const file = path.join(sb.project, 'handbook', 'getting-involved.md')
      await typeInEditor(cap, ' (draft)')
      fs.appendFileSync(file, '\nTools are kept in the blue shed.\n')
      fs.chmodSync(file, 0o444)
      try {
        const notice = visible(page, TEST_IDS.FILE_CONFLICT_NOTIFICATION)
        await expect(notice).toBeVisible({ timeout: 15_000 })
        await shot(cap, 'edit-and-preview/file-changed-on-disk', { crop: page.locator('.markdown-editor-panel').filter({ visible: true }), pad: 0 })
      } finally {
        fs.chmodSync(file, 0o644)
      }
    }

    if (anySelected(['several-windows/unsaved-changes'])) {
      // Close a tab with an unsaved edit; the prompt holds autosave while open.
      await openFile(cap, 'handbook/season-plan.md', 'split')
      await typeInEditor(cap, ' (draft)')
      await page.locator('.editor-tab', { hasText: 'season-plan.md' }).locator('[data-testid^="tab-close-"]').click()
      const confirm = page.getByTestId(TEST_IDS.DIALOG_CONTAINER)
      await expect(confirm).toBeVisible()
      await shot(cap, 'several-windows/unsaved-changes', { crop: confirm, pad: 16 })
      await page.getByTestId(TEST_IDS.DIALOG_BTN_CANCEL).click()
    }
  } finally {
    await cap.close()
  }
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `export-import`: the export buttons, the import dialog for a PDF and
 * the imported Markdown file. The native Open dialog is answered by a stub,
 * never shown (it would show the operator's own folders). Guide pages:
 * how-to/export-to-pdf-or-word.md, reference/export.md, how-to/import-a-document.md.
 */

import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { ProjectTreePage } from '../../../e2e/pages/project-tree.page'
import { launch, openFile, openProject, setViewMode, stubOpenDialog, visible } from '../lib/app'
import { anySelected, shot } from '../lib/shots'

const ROWS = ['export/toolbar-export-buttons', 'import/import-dialog', 'import/imported-file']

test('export-import', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  test.setTimeout(6 * 60_000)
  const cap = await launch()
  const { page, sandbox: sb } = cap
  try {
    await openProject(cap)
    await openFile(cap, 'README.md', 'split')
    await shot(cap, 'export/toolbar-export-buttons', {
      crop: [visible(page, TEST_IDS.TOOLBAR_BTN_EXPORT_PDF), visible(page, TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)],
      pad: 12
    })
    if (!anySelected(['import/import-dialog', 'import/imported-file'])) return

    await stubOpenDialog(cap, path.join(sb.project, 'inbox', 'seed-order.pdf'))
    await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT).click()
    const dialog = page.getByTestId(TEST_IDS.DOCUMENT_IMPORT_DIALOG)
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId(TEST_IDS.DOCUMENT_IMPORT_OCR_TOGGLE)).toBeChecked()
    await shot(cap, 'import/import-dialog', { crop: page.getByTestId(TEST_IDS.DIALOG_CONTAINER), pad: 16 })
    if (!anySelected(['import/imported-file'])) return

    // A real import. The dialog is closed with Escape, not Done: Done also
    // sends an "organise this import" prompt to the terminal, where no agent
    // runs in this scene.
    const before = new Set(fs.existsSync(path.join(sb.project, 'import')) ? fs.readdirSync(path.join(sb.project, 'import')) : [])
    await page.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_START).click()
    await expect(page.locator('.doc-import-success-message')).toBeVisible({ timeout: 4 * 60_000 })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    const created = fs.readdirSync(path.join(sb.project, 'import')).filter((f) => f.endsWith('.md') && !before.has(f))
    expect(created.length).toBe(1)
    const tree = new ProjectTreePage(page)
    await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_REFRESH).click()
    await expect(tree.folderRow('import')).toBeVisible()
    await openFile(cap, `import/${created[0]}`)
    await setViewMode(page, 'split')
    await shot(cap, 'import/imported-file')
  } finally {
    await cap.close()
  }
})

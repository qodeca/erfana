// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/how-to/export-to-pdf-or-word.md
 *
 * Follows the page step by step, finding every control by the label the page
 * gives the reader. Only the native save dialog is stubbed (Playwright cannot
 * drive OS dialogs); the export itself runs for real and the spec checks the
 * written files on disk.
 */

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { stubDialog } from 'electron-playwright-helpers'

import { waitForAppReady, openProject, createTestProject, createTempUserDataDir } from '../utils/helpers'
import {
  buildAppEnv,
  closeAppAndWait,
  createWorkerHome,
  removeDirWithRetry,
  E2E_CHROMIUM_ARGS
} from '../fixtures/isolation'

const PROJECT_ROOT = path.join(__dirname, '..', '..')
const DOC_NAME = 'report.md'
const DOC_TEXT = '# Quarterly report\n\nExport proof paragraph.\n\n- one\n- two\n'

/** Expect a file to exist and be non-empty, polling until the export writes it. */
async function expectFileWritten(filePath: string, magic: string): Promise<void> {
  await expect
    .poll(() => (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0), { timeout: 30_000 })
    .toBeGreaterThan(0)
  const head = fs.readFileSync(filePath).subarray(0, magic.length).toString('latin1')
  expect(head).toBe(magic)
}

test.describe('Guide: export to PDF or Word', () => {
  test('exports a Markdown file to PDF and to Word as the page describes', async () => {
    test.setTimeout(120_000)

    const { projectPath, cleanup: cleanupProject } = await createTestProject({ [DOC_NAME]: DOC_TEXT })
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('guide-export')
    const homeDir = await createWorkerHome('guide-export-home-')
    const outDir = await fs.promises.mkdtemp(path.join(PROJECT_ROOT, '.e2e-temp', 'guide-export-out-'))
    const pdfPath = path.join(outDir, 'report-export.pdf')
    const docxPath = path.join(outDir, 'report-export.docx')

    let electronApp: ElectronApplication | undefined
    try {
      electronApp = await electron.launch({
        args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, ...E2E_CHROMIUM_ARGS],
        env: buildAppEnv({ homeDir })
      })
      const app = electronApp
      const window: Page = await app.firstWindow()
      await waitForAppReady(window)

      await test.step('Setup (harness): open a project holding one Markdown file', async () => {
        await openProject(window, projectPath)
        // Page "Before you start" assumes a Markdown file is open: select it in the project tree.
        await window.getByText(DOC_NAME, { exact: true }).first().click()
        await expect(window.getByText('Export proof paragraph.').first()).toBeVisible({ timeout: 15_000 })
      })

      // The view-mode labels the page names are the buttons' tooltips (title attribute).
      const exportPdf = window.getByRole('button', { name: 'Export to PDF' })
      const exportWord = window.getByRole('button', { name: 'Export to Word' })

      await test.step('Before you start: export is unavailable in Editor Only', async () => {
        // "Export is unavailable in **Editor Only**."
        await window.getByTitle('Editor Only', { exact: true }).click()
        await expect(exportPdf).toBeDisabled()
        await expect(exportWord).toBeDisabled()
      })

      await test.step('Before you start: switch to Split Vertical (Side by Side)', async () => {
        // "switch the Markdown file to **Split Horizontal (Preview Top)**, **Split Vertical
        // (Side by Side)** or **Preview Only**."
        await window.getByTitle('Split Vertical (Side by Side)', { exact: true }).click()
        await expect(exportPdf).toBeEnabled()
        await expect(exportWord).toBeEnabled()
      })

      await test.step('PDF – steps 1 to 3', async () => {
        // 2. "Choose a destination in the system save dialog." (stubbed before the click opens it)
        await stubDialog(app, 'showSaveDialog', { filePath: pdfPath, canceled: false })
        // 1. "Select **Export to PDF** or **Export to Word** on the toolbar."
        await exportPdf.click()
        // 3. "Find the saved document at the destination you chose. A **PDF exported** ...
        // message shows its file name."
        await expectFileWritten(pdfPath, '%PDF')
        const toast = window.getByText('PDF exported', { exact: false })
        await expect(toast.first()).toBeVisible({ timeout: 15_000 })
        await expect(window.getByText('report-export.pdf', { exact: false }).first()).toBeVisible()
      })

      await test.step('Word – steps 1 to 3 (in Preview Only)', async () => {
        await window.getByTitle('Preview Only', { exact: true }).click()
        await expect(exportWord).toBeEnabled()
        // 2. "Choose a destination in the system save dialog."
        await stubDialog(app, 'showSaveDialog', { filePath: docxPath, canceled: false })
        // 1. "Select **Export to PDF** or **Export to Word** on the toolbar."
        await exportWord.click()
        // 3. "... **DOCX exported** message shows its file name. Erfana does not open it automatically."
        await expectFileWritten(docxPath, 'PK')
        await expect(window.getByText('DOCX exported', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
        await expect(window.getByText('report-export.docx', { exact: false }).first()).toBeVisible()
        // "Erfana does not open it automatically": still one window, no tab for the output.
        expect(app.windows()).toHaveLength(1)
        await expect(window.getByRole('tab', { name: /report-export/ })).toHaveCount(0)
      })
    } finally {
      if (electronApp) await closeAppAndWait(electronApp)
      await cleanupProject()
      await cleanupUserData()
      await removeDirWithRetry(homeDir)
      await removeDirWithRetry(outDir)
    }
  })
})

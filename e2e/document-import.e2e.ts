// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E Test for Document Import via LiteParse
 *
 * Tests the full UI lifecycle of the document import feature:
 * file dialog stub -> DocumentImportDialog opens -> verify options ->
 * start import -> progress -> success -> Done auto-opens file.
 *
 * Uses a minimal PDF fixture (no external dependencies required).
 * The only stub is the native file dialog (Playwright cannot interact
 * with OS dialogs).
 *
 * @see Issue #134 - LiteParse frontend UI
 * @see Spec #021 - LiteParse document import
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import { stubDialog } from 'electron-playwright-helpers'
import {
  TEST_IDS,
  byTestId,
  waitForTestId,
  waitForTestIdHidden,
  waitForAppReady,
  openProject,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'
import { IMPORT } from '../src/shared/constants'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Path to the minimal PDF fixture (~0.5 KB, single page, "Hello World" text).
 * Small file ensures fast processing without OCR dependencies.
 */
const PDF_FIXTURE = path.resolve(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'documents',
  'hello-world.pdf'
)

/** Expected output filename after import */
const OUTPUT_FILENAME = 'hello-world.md'

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Document import', () => {
  test.describe.configure({ retries: 0 })

  test('imports PDF file via DocumentImportDialog and auto-opens result', async () => {
    // Timeout: ~15s app launch + ~30s import + ~15s dialog flow = ~60s
    test.setTimeout(60_000)

    // Phase 1: Setup
    const { projectPath, cleanup: cleanupProject } = await createTestProject({
      'test.md': '# Test Project\n\nSeed file for document import E2E test.\n'
    })
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'document-import-happy-path'
    )

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    try {
      window = await electronApp.firstWindow()
      await waitForAppReady(window)
      await openProject(window, projectPath)

      // Wait for project tree to confirm project is loaded
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Phase 2: Stub file dialog to return our PDF fixture
      await stubDialog(electronApp, 'showOpenDialog', {
        filePaths: [PDF_FIXTURE],
        canceled: false
      })

      // Click import button
      const importButton = byTestId(window, TEST_IDS.WELCOME_BTN_IMPORT)
      await expect(importButton).toBeVisible({ timeout: 10000 })
      await importButton.click()

      // Phase 3: Verify DocumentImportDialog opens
      const dialog = byTestId(window, TEST_IDS.DOCUMENT_IMPORT_DIALOG)
      await waitForTestId(window, TEST_IDS.DOCUMENT_IMPORT_DIALOG, { timeout: 15000 })

      // File name should be displayed
      await expect(dialog).toContainText('hello-world.pdf')

      // Phase 4: Verify options are visible
      const ocrToggle = byTestId(window, TEST_IDS.DOCUMENT_IMPORT_OCR_TOGGLE)
      await expect(ocrToggle).toBeVisible()

      const languageSelect = byTestId(window, TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      await expect(languageSelect).toBeVisible()

      const screenshotsToggle = byTestId(window, TEST_IDS.DOCUMENT_IMPORT_SCREENSHOTS_TOGGLE)
      await expect(screenshotsToggle).toBeVisible()

      const dpiSelect = byTestId(window, TEST_IDS.DOCUMENT_IMPORT_DPI_SELECT)
      await expect(dpiSelect).toBeVisible()

      // Verify default values
      await expect(ocrToggle).toBeChecked()
      await expect(languageSelect).toHaveValue('eng')
      await expect(screenshotsToggle).not.toBeChecked()

      // Phase 5: Start import
      const startBtn = byTestId(window, TEST_IDS.DOCUMENT_IMPORT_BTN_START)
      await expect(startBtn).toBeVisible()
      await startBtn.click()

      // Progress section should appear
      await waitForTestId(window, TEST_IDS.DOCUMENT_IMPORT_PROGRESS, { timeout: 10000 })

      // Cancel button should be visible during import
      const cancelBtn = byTestId(window, TEST_IDS.DOCUMENT_IMPORT_BTN_CANCEL)
      await expect(cancelBtn).toBeVisible()

      // Phase 6: Wait for success
      const successMsg = dialog.locator('.doc-import-success-message')
      await expect(successMsg).toHaveText('Import complete', { timeout: 30000 })
      await expect(dialog).toContainText(OUTPUT_FILENAME)

      // Done button should be visible
      const doneBtn = byTestId(window, TEST_IDS.DOCUMENT_IMPORT_BTN_DONE)
      await expect(doneBtn).toBeVisible()

      // Phase 7: Click Done and verify dialog closes
      await doneBtn.click()
      await waitForTestIdHidden(window, TEST_IDS.DOCUMENT_IMPORT_DIALOG, { timeout: 10000 })

      // Phase 8: Verify output file exists on disk
      const expectedOutputPath = path.join(projectPath, IMPORT.DIR_NAME, OUTPUT_FILENAME)
      await fs.promises.access(expectedOutputPath)

      // Verify file content has expected frontmatter
      const fileContent = await fs.promises.readFile(expectedOutputPath, 'utf-8')
      expect(fileContent).toContain('hello-world.pdf')
    } finally {
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})

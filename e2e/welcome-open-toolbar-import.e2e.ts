// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * welcome-open-toolbar-import.e2e.ts
 *
 * End-to-end coverage for the two new entry points added alongside the
 * Welcome/Home Open button + Project Tree toolbar Import button:
 *
 *  A. Welcome-screen Open/Change Project button — opens a project from the
 *     empty welcome screen (real file:openProject IPC, native dialog stubbed)
 *     and toggles its label "Open project" -> "Change project".
 *  B. Project Tree toolbar Import button — imports a file via the toolbar
 *     through the real import IPC; verified by the output landing in the
 *     project's import/ directory.
 *
 * Already covered elsewhere (intentionally not duplicated here):
 *  - toolbar Open/Change button -> openProjectViaUI (e2e/utils/helpers.ts)
 *  - Welcome Import button -> document-import.e2e.ts / audio-transcription.e2e.ts
 *
 * NOTE: the e2e suite is disabled in CI (local-only via `npm run test:e2e`),
 * so this is a local regression net, not a merge gate.
 */

import { test, expect } from './fixtures/index'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { stubDialog } from 'electron-playwright-helpers'
import { TEST_IDS, byTestId } from './utils/helpers'
import { IMPORT } from '../src/shared/constants'
import { ProjectTreePage } from './pages/project-tree.page'

test.describe('Welcome screen Open/Change Project button', () => {
  test('opens a project from the welcome screen and toggles to "Change project"', async ({
    app,
    window,
    testProject
  }) => {
    const openBtn = byTestId(window, TEST_IDS.WELCOME_BTN_OPEN)

    await test.step('welcome screen shows "Open project" and hides Import', async () => {
      await expect(openBtn).toBeVisible({ timeout: 10000 })
      await expect(openBtn).toContainText('Open project')
      // Import is gated behind an open project
      await expect(byTestId(window, TEST_IDS.WELCOME_BTN_IMPORT)).toHaveCount(0)
    })

    await test.step('clicking opens the stubbed project (real file:openProject IPC)', async () => {
      await stubDialog(app, 'showOpenDialog', {
        filePaths: [testProject.path],
        canceled: false
      })
      await openBtn.click()

      const fileNodes = window.locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
      await expect(fileNodes.first()).toBeVisible({ timeout: 15000 })
    })

    await test.step('button toggles to "Change project" and Import appears', async () => {
      await expect(openBtn).toContainText('Change project')
      await expect(byTestId(window, TEST_IDS.WELCOME_BTN_IMPORT)).toBeVisible()
    })
  })
})

test.describe('Project Tree toolbar Import button', () => {
  test('imports a file via the toolbar into the project import/ directory', async ({
    appWithTestProject,
    windowWithTestProject,
    testProject
  }) => {
    test.setTimeout(60_000)
    const tree = new ProjectTreePage(windowWithTestProject)

    // A plain markdown source bypasses the DocumentImportDialog (office/PDF only)
    // and the media/transcription path, so it routes straight through import.process.
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'erfana-import-'))
    const srcFile = path.join(tmpDir, 'toolbar-import-source.md')
    await fs.promises.writeFile(
      srcFile,
      '# Toolbar import\n\nImported via the Project Tree toolbar button.\n',
      'utf-8'
    )

    try {
      await test.step('toolbar Import button is visible and enabled', async () => {
        await expect(tree.toolbarImportButton()).toBeVisible({ timeout: 10000 })
        await expect(tree.toolbarImportButton()).toBeEnabled()
      })

      await test.step('clicking imports the stubbed file into <project>/import/', async () => {
        await stubDialog(appWithTestProject, 'showOpenDialog', {
          filePaths: [srcFile],
          canceled: false
        })
        await tree.clickToolbarImport()

        // Deterministic gate: the import output lands on disk in the project's
        // import/ dir (same verification style as document-import.e2e.ts).
        const importDir = path.join(testProject.path, IMPORT.DIR_NAME)
        await expect
          .poll(
            async () => {
              try {
                return (await fs.promises.readdir(importDir)).length
              } catch {
                return 0
              }
            },
            { timeout: 30_000, message: 'expected an imported file in <project>/import/' }
          )
          .toBeGreaterThan(0)
      })
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

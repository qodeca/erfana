// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Settings → Import tools (#250): the optional tools' status is shown before
 * any file is picked, and Check again re-runs detection in main without a
 * restart, rate-limited.
 *
 * Host-independent on purpose: whether LibreOffice is installed differs per
 * machine, so the spec asserts that the Office row settles on a state, that a
 * missing LibreOffice shows an install hint and a ready one does not, and that
 * the recheck round-trip and its rate limit behave – not which tools exist.
 * PDF and images are built in (LiteParse reads them natively) and always ready.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ElectronApplication } from '@playwright/test'
import { stubDialog } from 'electron-playwright-helpers'
import { test, expect } from './fixtures/index'
import { openSettings, closeSettings } from './utils/helpers'
import { ImportToolsPage } from './pages/import-tools.page'
import { DialogPage } from './pages/dialog.page'
import { ProjectTreePage } from './pages/project-tree.page'

/**
 * Make main report LibreOffice as missing, whatever this host has. Replaces
 * the `import:toolStatus` handler in the main process, the way `stubDialog`
 * replaces the native picker.
 */
async function stubLibreOfficeMissing(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('import:toolStatus')
    ipcMain.handle('import:toolStatus', () => ({
      success: true,
      libreOffice: 'missing',
      unsafe: null,
      extensions: ['pdf'],
      throttled: false
    }))
  })
}

test.describe('Settings – Import tools', () => {
  test('shows each format’s status and an install hint only for a missing LibreOffice', async ({ window }) => {
    await openSettings(window)
    const tools = new ImportToolsPage(window)
    await expect(tools.section()).toBeVisible()

    expect(await tools.waitForSettled('pdf')).toBe('ready')
    expect(await tools.waitForSettled('images')).toBe('ready')
    await expect(tools.row('images')).toContainText('Ready – built in')

    const state = await tools.waitForSettled('office')
    const row = tools.row('office')
    // The state is spelled out in words, not colour alone.
    const words = { ready: 'Ready – LibreOffice found', missing: 'LibreOffice not found', unsafe: 'unsafe location' }
    await expect(row).toContainText(words[state as keyof typeof words])
    await expect(row.getByText(/then choose Check again/)).toHaveCount(state === 'missing' ? 1 : 0)
  })

  test('Check again re-runs detection, then a quick second press is rate-limited', async ({ window }) => {
    await openSettings(window)
    const tools = new ImportToolsPage(window)
    const before = await tools.waitForSettled('office')

    // Startup detection may have run under 3 s ago, so the first press can be
    // throttled; retry the press until a real probe has run.
    await expect(async () => {
      await tools.checkAgain()
      await expect(tools.liveRegion()).toHaveText(/^Check complete – LibreOffice (found|not found|found in an unsafe location)\.$/, { timeout: 1_000 })
    }).toPass({ timeout: 20_000, intervals: [1_000] })
    // Same machine, same tools: a fresh probe agrees with the startup result.
    expect(await tools.waitForSettled('office')).toBe(before)

    await tools.checkAgain()
    await expect(tools.liveRegion()).toHaveText('Checked a moment ago – try again in a few seconds.')
  })

  test('Check again is reachable and operable from the keyboard', async ({ window }) => {
    await openSettings(window)
    const tools = new ImportToolsPage(window)
    await tools.waitForSettled('office')

    await tools.recheckButton().focus()
    await expect(tools.recheckButton()).toBeFocused()
    await window.keyboard.press('Enter')

    await expect(tools.liveRegion()).toHaveText(/Check complete – |Checked a moment ago/, { timeout: 15_000 })
    // aria-disabled, not disabled: focus never leaves the button during or after the check.
    await expect(tools.recheckButton()).toBeFocused()
    await expect(tools.recheckButton()).toHaveAttribute('aria-disabled', 'false')
  })

  test('the import refusal opens Settings at Import tools with focus on its heading', async ({
    appWithTestProject,
    windowWithTestProject: window
  }) => {
    test.setTimeout(60_000)
    const tools = new ImportToolsPage(window)
    const dialog = new DialogPage(window)
    const tree = new ProjectTreePage(window)

    // Settings' silent read pulls the stubbed "LibreOffice not found" into the renderer.
    await stubLibreOfficeMissing(appWithTestProject)
    await openSettings(window)
    await expect(tools.row('office')).toHaveAttribute('data-state', 'missing')
    await closeSettings(window)

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'erfana-docx-'))
    const docx = path.join(tmpDir, 'report.docx')
    await fs.promises.writeFile(docx, 'not really a docx')
    try {
      await stubDialog(appWithTestProject, 'showOpenDialog', { filePaths: [docx], canceled: false })
      await tree.clickToolbarImport()

      await expect(dialog.confirmTitle()).toHaveText('LibreOffice required')
      await expect(dialog.confirmButton()).toHaveText('Open import tools')
      await expect(dialog.cancelButton()).toHaveText('Close')
      await dialog.confirmButton().click()

      await expect(tools.section()).toBeVisible()
      await expect(tools.section().getByRole('heading', { name: 'Import tools' })).toBeFocused()
      await expect(tools.row('office')).toContainText('LibreOffice not found')
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/how-to/import-a-document.md
 *
 * Follows the page's "Import a file" steps in the real app, finding every
 * control by the label the page names. The only stub is the native file
 * picker (Playwright cannot drive OS dialogs).
 */

import * as fs from 'fs'
import * as path from 'path'
import { stubDialog } from 'electron-playwright-helpers'
import { test, expect } from '../fixtures'
import { TerminalPage } from '../pages/terminal.page'

const PDF_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'tests',
  'fixtures',
  'documents',
  'hello-world.pdf'
)

test.use({
  testProjectFiles: {
    'test.md': '# Test project\n\nSeed file.\n',
    'notes/keep.md': '# Notes\n'
  }
})

test.describe('Guide: import a document', () => {
  test('toolbar path: Import a file → Import document dialog → Import → Done', async ({
    appWithTestProject: app,
    windowWithTestProject: window,
    testProject
  }) => {
    test.setTimeout(90_000)

    // "Before you start: open the project folder that should receive the converted Markdown file."
    // (done by the windowWithTestProject fixture)

    await test.step('1. Select Import a file in the tree toolbar', async () => {
      // "Choose the source document in the file picker." – native picker is stubbed.
      await stubDialog(app, 'showOpenDialog', { filePaths: [PDF_FIXTURE], canceled: false })
      const importButton = window.getByRole('button', { name: 'Import a file' })
      await expect(importButton).toBeVisible({ timeout: 10_000 })
      await importButton.click()
    })

    const dialog = window.getByRole('dialog', { name: 'Import document' })

    await test.step('2. PDF, image and Office files open the Import document dialog', async () => {
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(dialog).toContainText('hello-world.pdf')
    })

    await test.step(
      '3. Set Enable OCR text recognition, OCR language, Generate page screenshots and Screenshot DPI',
      async () => {
        const ocr = dialog.getByLabel('Enable OCR text recognition')
        await expect(ocr).toBeVisible()
        await expect(ocr).toBeChecked()
        await expect(dialog.getByLabel('OCR language')).toBeVisible()
        const screenshots = dialog.getByLabel('Generate page screenshots')
        await screenshots.check()
        await expect(screenshots).toBeChecked()
        await expect(dialog.getByLabel('Screenshot DPI')).toBeVisible()
      }
    )

    await test.step('4. Select Import; the file lands in import/, screenshots in import/screenshots/; Done opens it', async () => {
      await dialog.getByRole('button', { name: 'Import', exact: true }).click()
      const done = dialog.getByRole('button', { name: 'Done' })
      await expect(done).toBeVisible({ timeout: 45_000 })

      const outPath = path.join(testProject.path, 'import', 'hello-world.md')
      await expect.poll(() => fs.existsSync(outPath), { timeout: 10_000 }).toBe(true)
      expect(fs.readFileSync(outPath, 'utf-8')).toContain('Hello World')
      const shotsDir = path.join(testProject.path, 'import', 'screenshots')
      await expect
        .poll(() => fs.existsSync(shotsDir) && fs.readdirSync(shotsDir, { recursive: true }).length > 0, {
          timeout: 10_000
        })
        .toBe(true)

      await done.click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
      // "select Done to open the Markdown file" – its editor tab and content appear.
      await expect(window.getByRole('button', { name: 'Close hello-world.md' })).toBeVisible({
        timeout: 10_000
      })
      await expect(window.getByRole('region', { name: 'Editor' })).toContainText('Hello World')
    })

    await test.step('4 (cont.). Done also sends the Organize Import prompt to the terminal', async () => {
      // "Start your agent first: with only a shell running, the shell runs the prompt as a command."
      // No agent runs here, so the plain shell receives the prompt text.
      // The terminal draws to a canvas, so read its buffer; join wrapped rows before matching.
      // zsh redraws a long pasted line, so how much of the prompt stays in the
      // buffer depends on the terminal size an earlier test left; either line
      // of the Organize Import prompt proves it arrived.
      const terminal = new TerminalPage(window)
      await expect
        .poll(async () => (await terminal.readScreen()).lines.join(''), { timeout: 15_000 })
        .toMatch(/Where should this file be placed\?|Phase 3: File Name Decision/)
    })
  })

  test('folder path: right-click a folder → Import... → saved in import/, not the folder', async ({
    appWithTestProject: app,
    windowWithTestProject: window,
    testProject
  }) => {
    test.setTimeout(90_000)

    await test.step('1. Right-click a folder and select Import...', async () => {
      await stubDialog(app, 'showOpenDialog', { filePaths: [PDF_FIXTURE], canceled: false })
      await window.getByText('notes', { exact: true }).first().click({ button: 'right' })
      await window.getByRole('menuitem', { name: 'Import...', exact: true }).click()
    })

    const dialog = window.getByRole('dialog', { name: 'Import document' })

    await test.step('2. The Import document dialog opens', async () => {
      await expect(dialog).toBeVisible({ timeout: 15_000 })
    })

    await test.step('4. Select Import; saved in the project import folder, not the right-clicked folder', async () => {
      await dialog.getByRole('button', { name: 'Import', exact: true }).click()
      await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 45_000 })
      const outPath = path.join(testProject.path, 'import', 'hello-world.md')
      await expect.poll(() => fs.existsSync(outPath), { timeout: 10_000 }).toBe(true)
      expect(fs.existsSync(path.join(testProject.path, 'notes', 'hello-world.md'))).toBe(false)
    })
  })
})

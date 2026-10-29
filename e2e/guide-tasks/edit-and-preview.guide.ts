// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: edit a Markdown file and see the live preview.
 *
 * Follows docs/user-guide/how-to/edit-and-preview-markdown.md step by step,
 * finding every control by the label the page names, to prove the page alone
 * gets a newcomer to the result: an edit appears in the preview and is
 * autosaved to disk.
 */

import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '../fixtures'

const FILE_NAME = 'notes.md'
const TYPED_TEXT = 'Guide proof line'

test.use({ testProjectFiles: { [FILE_NAME]: '# Notes\n\nStarting text.\n' } })

test('edit a Markdown file and see the live preview', async ({
  windowWithTestProject: window,
  testProject
}) => {
  const filePath = path.join(testProject.path, FILE_NAME)

  await test.step('Before you start: select a Markdown file in the project tree', async () => {
    await window.getByText(FILE_NAME, { exact: true }).first().click()
  })

  await test.step('1. Select Split Vertical (Side by Side) on the toolbar', async () => {
    const splitVertical = window.getByTitle('Split Vertical (Side by Side)').or(
      window.getByRole('button', { name: 'Split Vertical (Side by Side)' })
    )
    await splitVertical.first().click()
    // The preview shows the file's existing content beside the editor.
    await expect(window.getByRole('heading', { name: 'Notes' }).first()).toBeVisible()
  })

  await test.step('Edit the document: type a new line in the editor', async () => {
    const editor = window.getByRole('textbox', { name: /editor/i }).first()
    await editor.focus()
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await window.keyboard.press('Enter')
    await window.keyboard.type(TYPED_TEXT)
    // Live preview: the typed text shows up without saving.
    await expect(window.getByText(TYPED_TEXT, { exact: true }).last()).toBeVisible()
  })

  await test.step('2. In Split Vertical (Side by Side), use the formatting buttons, such as Bold', async () => {
    await window.keyboard.press('Shift+Home')
    const bold = window.getByTitle(/^Bold/).or(window.getByRole('button', { name: /^Bold/ }))
    await bold.first().click()
    await expect(window.locator('strong', { hasText: TYPED_TEXT }).first()).toBeVisible()
  })

  await test.step('3. Select Find to search the open document', async () => {
    const find = window.getByTitle(/^Find/).or(window.getByRole('button', { name: /^Find/ }))
    await find.first().click()
    await expect(window.getByRole('search', { name: /find/i })).toBeVisible()
  })

  await test.step('Erfana autosaves 2 seconds after you stop typing', async () => {
    await expect
      .poll(() => fs.promises.readFile(filePath, 'utf-8'), { timeout: 10000 })
      .toContain(`**${TYPED_TEXT}**`)
  })
})

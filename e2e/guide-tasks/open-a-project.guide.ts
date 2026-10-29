// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/how-to/open-a-project.md
 *
 * Follows the page step by step, finding every control by the label the page
 * names. The only stub is the native folder picker (Playwright cannot drive
 * OS dialogs).
 */

import * as fs from 'fs'
import * as path from 'path'
import { stubDialog } from 'electron-playwright-helpers'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { E2E_TEMP_DIR, removeDirWithRetry } from '../fixtures/isolation'

/** A button the page names in bold – by accessible name, or by tooltip title. */
function control(window: Page, label: string) {
  return window
    .getByRole('button', { name: label, exact: true })
    .or(window.getByTitle(label, { exact: true }))
    .first()
}

test.describe('Guide: Open a project', () => {
  test.use({
    testProjectFiles: { 'notes.md': '# Guide notes\n\nFirst project content line.\n' }
  })

  test('opens, changes, closes and reopens a project as the page describes', async ({
    app,
    window,
    testProject
  }) => {
    test.setTimeout(90_000)
    const projectA = testProject.path
    const nameA = path.basename(projectA)

    // A second folder for "Change project".
    await fs.promises.mkdir(E2E_TEMP_DIR, { recursive: true })
    const projectB = await fs.promises.mkdtemp(path.join(E2E_TEMP_DIR, 'guide-b-'))
    await fs.promises.writeFile(path.join(projectB, 'second.md'), '# Second\n\nOther folder.\n')
    const nameB = path.basename(projectB)

    try {
      // == Open a folder ==

      // "1. Select **Open project** on Home."
      await stubDialog(app, 'showOpenDialog', { filePaths: [projectA], canceled: false })
      const openProject = control(window, 'Open project')
      await expect(openProject).toBeVisible({ timeout: 15_000 })
      await openProject.click()

      // "2. Choose the folder in the system dialog." (stubbed above)
      // The page promises the folder's files show in the project tree.
      const fileA = window.getByText('notes.md', { exact: true }).first()
      await expect(fileA).toBeVisible({ timeout: 15_000 })

      // "The terminal opens when a project loads."
      await expect(window.getByRole('textbox', { name: /terminal input/i }).first()).toBeAttached({
        timeout: 15_000
      })

      // "3. Select a file in the project tree to open it."
      await fileA.click()
      await expect(window.getByText('First project content line.').first()).toBeVisible({
        timeout: 15_000
      })

      // == Change or close a project ==

      // "1. Select **Change project** to choose another folder."
      await stubDialog(app, 'showOpenDialog', { filePaths: [projectB], canceled: false })
      await control(window, 'Change project').click()
      // "Before it switches or closes, Erfana saves every edited tab. It asks
      // only ... when the terminal shows recent activity. ... **Switch Anyway**
      // ... goes ahead." The fresh shell prompt can count as recent activity.
      const switchAnyway = window.getByRole('button', { name: 'Switch Anyway', exact: true })
      const fileB = window.getByText('second.md', { exact: true }).first()
      await expect(fileB.or(switchAnyway)).toBeVisible({ timeout: 15_000 })
      if (await switchAnyway.isVisible()) await switchAnyway.click()
      await expect(fileB).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText('notes.md', { exact: true })).toHaveCount(0)

      // "2. Select **Close project** to return to Home."
      await control(window, 'Close project').click()
      const closeAnyway = window.getByRole('button', { name: 'Close Anyway', exact: true })
      const openOnHome = control(window, 'Open project')
      await expect(openOnHome.or(closeAnyway).first()).toBeVisible({ timeout: 15_000 })
      if (await closeAnyway.isVisible()) await closeAnyway.click()
      await expect(openOnHome).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText('second.md', { exact: true })).toHaveCount(0)

      // "3. Select a recent project on Home to reopen it, or remove it from the list."
      const recentA = window.getByText(nameA, { exact: true }).first()
      const recentB = window.getByText(nameB, { exact: true }).first()
      await expect(recentA).toBeVisible({ timeout: 10_000 })
      await expect(recentB).toBeVisible()
      await recentA.click()
      await expect(window.getByText('notes.md', { exact: true }).first()).toBeVisible({
        timeout: 15_000
      })

      // Back to Home to remove a recent project from the list.
      await control(window, 'Close project').click()
      await expect(openOnHome.or(closeAnyway).first()).toBeVisible({ timeout: 15_000 })
      if (await closeAnyway.isVisible()) await closeAnyway.click()
      await expect(openOnHome).toBeVisible({ timeout: 15_000 })
      const rowB = window
        .getByRole('listitem')
        .filter({ hasText: nameB })
        .or(window.locator('[role="button"]', { hasText: nameB }))
        .first()
      await rowB.hover()
      await rowB.getByRole('button').last().click()
      await expect(window.getByText(nameB, { exact: true })).toHaveCount(0, { timeout: 10_000 })
      await expect(window.getByText(nameA, { exact: true }).first()).toBeVisible()
      // Removing must not have opened project B instead.
      await expect(openOnHome).toBeVisible()
      await expect(window.getByText('second.md', { exact: true })).toHaveCount(0)
    } finally {
      await removeDirWithRetry(projectB)
    }
  })
})

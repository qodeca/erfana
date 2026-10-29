// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide claims: user-guide reference pages, batch user-3.
 *
 * Each test proves one or more sentences of docs/user-guide/reference/*.md in
 * the real app, finding controls by the labels a reader sees. The only stub
 * is the native folder picker (Playwright cannot drive OS dialogs).
 */

import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { stubDialog } from 'electron-playwright-helpers'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { E2E_TEMP_DIR, removeDirWithRetry } from '../fixtures/isolation'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** A button the page names in bold – by accessible name, or by tooltip title. */
function control(window: Page, label: string) {
  return window
    .getByRole('button', { name: label, exact: true })
    .or(window.getByTitle(label, { exact: true }))
    .first()
}

interface MenuEntry {
  menu: string
  label: string
  role: string | null
  accelerator: string | null
}

/**
 * Every item of the installed application menu, flattened. A role item
 * reports the accelerator Electron gives it on this system. (Playwright's key
 * presses reach the page, not the native menu, so the menu is read instead.)
 */
async function readMenu(app: ElectronApplication): Promise<MenuEntry[]> {
  return app.evaluate(({ Menu }) => {
    const out: { menu: string; label: string; role: string | null; accelerator: string | null }[] = []
    for (const top of Menu.getApplicationMenu()?.items ?? []) {
      for (const item of top.submenu?.items ?? []) {
        if (item.type === 'separator') continue
        out.push({
          menu: top.label,
          label: item.label,
          role: item.role?.toLowerCase() ?? null,
          accelerator: typeof item.accelerator === 'string' ? item.accelerator : null
        })
      }
    }
    return out
  })
}

test.describe('App and windows shortcuts (keyboard-shortcuts.md)', () => {
  test('minimize, hide, quit, close and full screen come from the menu as the table says', async ({
    app,
    window
  }) => {
    await expect(control(window, 'Open project')).toBeVisible({ timeout: 15_000 })
    const menu = await readMenu(app)
    const byRole = (role: string): MenuEntry | undefined => menu.find(entry => entry.role === role)

    // Minimize: the Window menu's minimize role, Cmd+M / Ctrl+M.
    expect(byRole('minimize')).toMatchObject({ menu: 'Window', accelerator: 'CommandOrControl+M' })

    if (process.platform === 'darwin') {
      // Hide and quit: Cmd+H and Cmd+Q in the app menu; File has no quit.
      expect(byRole('hide')?.accelerator).toBe('Command+H')
      expect(byRole('quit')).toMatchObject({ menu: menu[0].menu, accelerator: 'CommandOrControl+Q' })
      // Close window: no Close item (so no Cmd+W) – the window close control closes it.
      expect(byRole('close')).toBeUndefined()
      // Full screen: Ctrl+Cmd+F.
      expect(byRole('togglefullscreen')?.accelerator).toBe('Control+Command+F')
    } else {
      // No hide; quit is **File > Exit**.
      expect(byRole('hide')).toBeUndefined()
      expect(byRole('quit')).toMatchObject({ menu: 'File', label: 'Exit' })
      // Full screen: F11.
      expect(byRole('togglefullscreen')?.accelerator).toBe('F11')
    }
  })
})

test.describe('Bold or sidebar (keyboard-shortcuts.md)', () => {
  test.use({ testProjectFiles: { 'doc.md': '# Doc\n\nboldme' } })

  test('Cmd/Ctrl+B bolds in the editor and toggles the Project sidebar elsewhere', async ({
    windowWithTestProject: window
  }) => {
    const tree = byTestId(window, TEST_IDS.PROJECT_TREE)
    await window.getByText('doc.md', { exact: true }).first().click()
    await window.getByTitle('Editor Only', { exact: true }).first().click()
    const editor = window.getByRole('textbox', { name: /editor/i }).first()
    await expect(editor).toBeAttached({ timeout: 15_000 })
    await editor.focus()
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await window.keyboard.press('Shift+Home')
    await window.keyboard.press(`${MOD}+b`)

    // Bold applied in the editor, and the sidebar did not move.
    await expect(window.locator('.view-lines').first()).toContainText('**boldme**')
    await expect(tree).toBeVisible()

    // Anywhere else, the same keys hide and show the Project sidebar.
    await window.getByText('doc.md', { exact: true }).first().click()
    await window.keyboard.press(`${MOD}+b`)
    await expect(tree).toBeHidden({ timeout: 10_000 })
    await window.keyboard.press(`${MOD}+b`)
    await expect(tree).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Excluded folders (settings.md)', () => {
  test.use({
    testProjectFiles: {
      'README.md': '# Readme\n',
      'links.md': '# Links\n\n[Open the note](scratch/note.md)\n',
      'scratch/note.md': '# Note\n\nFirst version.\n',
      '.erfana/settings.json': JSON.stringify({ files: { exclude: ['scratch'] } })
    }
  })

  test('git status still counts a file in an excluded folder', async ({ app, window, testProject }) => {
    // Commit everything except the excluded folder, then add one untracked file in it.
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: testProject.path, stdio: 'ignore' })
    }
    git('init', '-q')
    git('config', 'user.email', 'e2e@example.com')
    git('config', 'user.name', 'E2E')
    git('add', 'README.md', 'links.md', '.erfana/settings.json')
    git('commit', '-q', '-m', 'seed')
    // scratch/note.md is now the only untracked file.

    await stubDialog(app, 'showOpenDialog', { filePaths: [testProject.path], canceled: false })
    await control(window, 'Open project').click()
    await expect(window.getByText('README.md', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

    // The tree leaves the folder out, and the git status bar still counts it.
    await expect(window.getByText('scratch', { exact: true })).toHaveCount(0)
    await expect(byTestId(window, TEST_IDS.GIT_STATUS_COUNTS)).toContainText('U1', { timeout: 15_000 })
  })

  test('a file in an excluded folder that is open in a tab keeps refreshing', async ({
    windowWithTestProject: window,
    testProject
  }) => {
    await expect(window.getByText('scratch', { exact: true })).toHaveCount(0)

    // Open the excluded file from a link in the Markdown preview.
    await window.getByText('links.md', { exact: true }).first().click()
    const previewOnly = window
      .getByTitle(/^Preview/)
      .or(window.getByRole('button', { name: /^Preview/ }))
      .first()
    await previewOnly.click()
    await window.getByRole('link', { name: 'Open the note' }).first().click()
    await expect(window.getByText('First version.').first()).toBeVisible({ timeout: 15_000 })

    // Change it on disk: the open tab shows the new text.
    await fs.promises.writeFile(
      path.join(testProject.path, 'scratch', 'note.md'),
      '# Note\n\nSecond version from disk.\n',
      'utf-8'
    )
    await expect(window.getByText('Second version from disk.').first()).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('Folder refused as a project (troubleshooting.md)', () => {
  test('the refusal shows when the folder comes from the dialog or the recent list', async ({
    app,
    window,
    testProject
  }) => {
    test.setTimeout(90_000)
    // From the dialog: the top of the drive.
    const driveRoot = path.parse(testProject.path).root
    await stubDialog(app, 'showOpenDialog', { filePaths: [driveRoot], canceled: false })
    await control(window, 'Open project').click()
    await expect(
      window.getByText('System directories cannot be opened as projects').first()
    ).toBeVisible({ timeout: 15_000 })
    await expect(control(window, 'Open project')).toBeVisible()

    // From the recent list: a project that has since become a link to the top of the drive.
    await fs.promises.mkdir(E2E_TEMP_DIR, { recursive: true })
    const holder = await fs.promises.mkdtemp(path.join(E2E_TEMP_DIR, 'refused-'))
    const recent = path.join(holder, 'recent-proj')
    await fs.promises.mkdir(recent)
    await fs.promises.writeFile(path.join(recent, 'here.md'), '# Here\n')
    try {
      await stubDialog(app, 'showOpenDialog', { filePaths: [recent], canceled: false })
      await control(window, 'Open project').click()
      await expect(window.getByText('here.md', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
      await control(window, 'Close project').click()
      const closeAnyway = window.getByRole('button', { name: 'Close Anyway', exact: true })
      const openOnHome = control(window, 'Open project')
      await expect(openOnHome.or(closeAnyway).first()).toBeVisible({ timeout: 15_000 })
      if (await closeAnyway.isVisible()) await closeAnyway.click()
      await expect(openOnHome).toBeVisible({ timeout: 15_000 })

      await removeDirWithRetry(recent)
      await fs.promises.symlink(driveRoot, recent, 'junction')
      await window.getByText('recent-proj', { exact: true }).first().click()
      // The link leads to the top of the drive, so the folder it names is refused.
      await expect(
        window.getByText('This directory link points to a protected location').first()
      ).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText('here.md', { exact: true })).toHaveCount(0)
    } finally {
      await fs.promises.rm(recent, { force: true })
      await removeDirWithRetry(holder)
    }
  })
})

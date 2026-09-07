// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Saving — autosave, manual save, and the file-changed-on-disk conflict.
 *
 * "Autosave must never lose keystrokes" is a standing project rule (#124), and
 * every part of it was verified only by unit tests before this file existed:
 * `useAutoSave` with fake timers, `useFileWatcher` with a mocked bridge,
 * `MarkdownEditorPanel` with a mocked Monaco. None of those can prove that a
 * keystroke reaches the real file on the real disk.
 *
 * So the assertions here are all about bytes. What is on disk after a save,
 * what is on disk after the user chooses "Keep My Version", and — the case
 * that matters most — what is on disk in a file the user was *not* saving.
 *
 * Timing note: `useAutoSave` debounces two seconds after the last keystroke.
 * That is a product constant, not a test knob, so autosave assertions poll the
 * file with a budget comfortably past it rather than sleeping for it.
 *
 * @see src/renderer/src/hooks/useAutoSave.ts
 * @see src/renderer/src/hooks/useFileWatcher.ts
 * @see docs/file-watching/README.md
 */

import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { byTestId } from './utils/locators'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

/**
 * Comfortably past the 2 s autosave debounce plus the IPC write, without
 * being so generous that a genuinely broken save looks slow rather than
 * broken.
 */
const AUTOSAVE_BUDGET_MS = 15_000

const NOTES = '# Notes\n\nOriginal notes body.\n'
const OTHER = '# Other\n\nUntouched by these tests.\n'

test.use({
  testProjectFiles: {
    'notes.md': NOTES,
    'other.md': OTHER
  }
})

/** Open a file and switch it into editor mode so Monaco is mounted. */
async function openForEditing(
  page: Page,
  fileName: string
): Promise<{ monaco: MonacoPage; panel: EditorPanelPage }> {
  const tree = new ProjectTreePage(page)
  const tabs = new TabBarPage(page)
  const panel = new EditorPanelPage(page)
  const monaco = new MonacoPage(page, new KeyboardHelper(page))

  await tree.fileRow(fileName).click()
  await tabs.waitForTab(fileName)
  await panel.waitForReady()
  await panel.setViewMode('editor')
  await monaco.waitForReady()

  return { monaco, panel }
}

/** Poll a file until it contains `text`, or fail with what it actually held. */
async function expectFileToContain(path: string, text: string): Promise<void> {
  await expect
    .poll(async () => readFile(path, 'utf-8'), { timeout: AUTOSAVE_BUDGET_MS })
    .toContain(text)
}

test.describe('Autosave', () => {
  test('should write an edit to disk without any user action', async ({
    windowWithTestProject,
    testProject
  }) => {
    const { monaco } = await openForEditing(windowWithTestProject, 'notes.md')

    await monaco.appendContent('\nautosaved line\n')

    await expectFileToContain(join(testProject.path, 'notes.md'), 'autosaved line')
  })

  test('should clear the dirty marker once the autosave lands', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tabs = new TabBarPage(windowWithTestProject)
    const { monaco } = await openForEditing(windowWithTestProject, 'notes.md')

    await monaco.appendContent('\nsettled\n')
    await expect(tabs.dirtyDot('notes.md')).toBeVisible({ timeout: 10_000 })

    await expectFileToContain(join(testProject.path, 'notes.md'), 'settled')
    // Once the buffer matches disk the tab is clean again; a dot that never
    // clears trains users to ignore it.
    await expect(tabs.dirtyDot('notes.md')).toHaveCount(0, { timeout: AUTOSAVE_BUDGET_MS })
  })

  test('should keep the original text ahead of the edit', async ({
    windowWithTestProject,
    testProject
  }) => {
    const { monaco } = await openForEditing(windowWithTestProject, 'notes.md')

    await monaco.appendContent('\nappended\n')
    const target = join(testProject.path, 'notes.md')
    await expectFileToContain(target, 'appended')

    // A save that replaced rather than extended the document would still
    // satisfy the assertion above — this is the one that catches it.
    expect(await readFile(target, 'utf-8')).toContain('Original notes body.')
  })
})

test.describe('Manual save', () => {
  test('should write the active file on the save shortcut', async ({
    windowWithTestProject,
    testProject,
    keyboardHelper
  }) => {
    const { monaco } = await openForEditing(windowWithTestProject, 'notes.md')

    await monaco.appendContent('\nmanually saved\n')
    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+s`)

    await expectFileToContain(join(testProject.path, 'notes.md'), 'manually saved')
  })

  test('should not write a background file when the active file is saved', async ({
    windowWithTestProject,
    testProject,
    keyboardHelper
  }) => {
    // Edit `other.md`, then move to `notes.md` and save that instead.
    const other = await openForEditing(windowWithTestProject, 'other.md')
    await other.monaco.appendContent('\nBACKGROUND EDIT\n')

    const notes = await openForEditing(windowWithTestProject, 'notes.md')
    await notes.monaco.appendContent('\nforeground edit\n')

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+s`)
    await expectFileToContain(join(testProject.path, 'notes.md'), 'foreground edit')

    // Regression guard, paired with the ⌘W case in `tab-lifecycle.e2e.ts`:
    // every mounted panel used to handle the same keypress, so saving one file
    // silently wrote every other open buffer too. Autosave will eventually
    // commit `other.md` on its own — this asserts the *shortcut* did not, by
    // checking immediately after the foreground save landed.
    const otherOnDisk = await readFile(join(testProject.path, 'other.md'), 'utf-8')
    expect(otherOnDisk).toBe(OTHER)
  })
})

test.describe('File changed on disk', () => {
  test('should offer a choice when the file changes underneath an edited buffer', async ({
    windowWithTestProject,
    testProject
  }) => {
    const { monaco, panel } = await openForEditing(windowWithTestProject, 'notes.md')

    await monaco.appendContent('\nlocal work\n')
    await writeFile(join(testProject.path, 'notes.md'), '# Rewritten\n\nBy another tool.\n', 'utf-8')

    await expect(panel.conflictNotification()).toBeVisible({ timeout: AUTOSAVE_BUDGET_MS })
    await expect(panel.conflictNotification()).toContainText('notes.md')
    await expect(panel.conflictReloadButton()).toBeVisible()
    await expect(panel.conflictKeepButton()).toBeVisible()
  })

  test('should replace the buffer with the file when Reload from Disk is chosen', async ({
    windowWithTestProject,
    testProject
  }) => {
    const { monaco, panel } = await openForEditing(windowWithTestProject, 'notes.md')

    await monaco.appendContent('\ndiscard me\n')
    await writeFile(join(testProject.path, 'notes.md'), '# Rewritten\n\nBy another tool.\n', 'utf-8')

    await expect(panel.conflictNotification()).toBeVisible({ timeout: AUTOSAVE_BUDGET_MS })
    await panel.conflictReloadButton().click()

    // This button used to take the whole renderer down: React passed the click
    // event into `reloadFromDisk(prefetchedContent?)`, the event became the
    // file's content, and `calculateStats` threw on the next render. Assert the
    // recovery screen is absent, or the failure below reads as "content wrong"
    // when the truth is "the app crashed".
    await expect(byTestId(windowWithTestProject, TEST_IDS.ROOT_ERROR_BOUNDARY)).toHaveCount(0)

    await expect(panel.conflictNotification()).toHaveCount(0, { timeout: 10_000 })
    await expect
      .poll(async () => monaco.visibleText(), { timeout: 10_000 })
      .toContain('By another tool.')
    // The discarded edit must be gone, not merely pushed out of view.
    expect(await monaco.visibleText()).not.toContain('discard me')
  })

  test('should keep the local buffer and let it win the next save', async ({
    windowWithTestProject,
    testProject
  }) => {
    const { monaco, panel } = await openForEditing(windowWithTestProject, 'notes.md')

    await monaco.appendContent('\nmy local work\n')
    await writeFile(join(testProject.path, 'notes.md'), '# Rewritten\n\nBy another tool.\n', 'utf-8')

    await expect(panel.conflictNotification()).toBeVisible({ timeout: AUTOSAVE_BUDGET_MS })
    await panel.conflictKeepButton().click()
    await expect(panel.conflictNotification()).toHaveCount(0, { timeout: 10_000 })

    // "Keep My Version" has to mean the buffer survives — both in the editor…
    expect(await monaco.visibleText()).toContain('my local work')
    // …and, once saved, on disk.
    await monaco.appendContent('\nand more\n')
    await expectFileToContain(join(testProject.path, 'notes.md'), 'my local work')
  })

  test('should not raise a conflict for the app’s own save', async ({
    windowWithTestProject,
    testProject
  }) => {
    const { monaco, panel } = await openForEditing(windowWithTestProject, 'notes.md')

    await monaco.appendContent('\nself written\n')
    await expectFileToContain(join(testProject.path, 'notes.md'), 'self written')

    // The watcher sees the app's own write land. Echo suppression is the whole
    // reason `useFileWatcher` tracks in-flight saves; without it every autosave
    // would accuse the user of an external edit.
    await expect(panel.conflictNotification()).toHaveCount(0)
  })
})

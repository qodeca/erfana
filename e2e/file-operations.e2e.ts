// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Project tree file management — create, rename, delete, copy/paste.
 *
 * These are the journeys with the highest blast radius in the app: every one
 * of them writes to (or removes from) the user's real project directory, and
 * none of them had end-to-end coverage. The unit suite exercises the command
 * classes with an injected `MenuContext`, which proves the commands call the
 * right API — it cannot prove the dialog wiring, the watcher pause, the tree
 * refresh and the on-disk result actually line up.
 *
 * So every assertion here is made twice: once against what the tree shows,
 * once against what is on disk. A tree that lists a file the filesystem does
 * not have (or the reverse) is precisely the failure these tests exist to
 * catch.
 *
 * Two named behaviours are asserted rather than assumed:
 *
 * - `FileService.createFile` refuses to write over an existing file and
 *   throws; the renderer surfaces that as an error toast. The test asserts
 *   the *existing file's bytes survive*, because "New File over an open
 *   document" is the cheapest data-loss bug this app could ship.
 * - `createFile` appends `.md` when the typed name carries no markdown
 *   extension. That is deliberate (it is a markdown workspace), so the test
 *   pins it instead of working around it.
 *
 * @see src/renderer/src/hooks/useFileOperations.ts
 * @see src/renderer/src/components/ProjectTree/context-menu/commands.tsx
 * @see src/main/services/FileService.ts
 */

import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { DialogPage } from './pages/dialog.page'
import { byTestId } from './utils/locators'
import { toastWithText } from './utils/toast'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

/**
 * Seed shaped for these journeys: a root file to rename and delete, a nested
 * folder to paste into, and a file whose bytes are distinctive enough that an
 * accidental truncation is unambiguous in the assertion output.
 */
const PRECIOUS_CONTENT = '# Precious\n\nDo not overwrite this line.\n'

const SEED = {
  'README.md': '# Readme\n\nRoot document.\n',
  'precious.md': PRECIOUS_CONTENT,
  'docs/guide.md': '# Guide\n\nNested document.\n'
}

test.use({ testProjectFiles: SEED })

/** True when the path exists on disk. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test.describe('Project tree – creating files and folders', () => {
  test('should create a file from the toolbar, list it in the tree and open it', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.newFileButton().click()
    await dialog.waitForNameEntry('Create New File')
    await dialog.submitName('notes.md', 'Create')

    // The tree lists it…
    await tree.waitForFile('notes.md')
    // …the filesystem has it, empty…
    const created = join(testProject.path, 'notes.md')
    expect(await readFile(created, 'utf-8')).toBe('')
    // …and creating a file opens it, so the user can type immediately.
    await expect(byTestId(windowWithTestProject, TEST_IDS.EDITOR_CONTENT)).toBeVisible({
      timeout: 10_000
    })
  })

  test('should append the .md extension when the typed name has none', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.newFileButton().click()
    await dialog.waitForNameEntry('Create New File')
    await dialog.submitName('untitled', 'Create')

    await tree.waitForFile('untitled.md')
    expect(await exists(join(testProject.path, 'untitled.md'))).toBe(true)
    expect(await exists(join(testProject.path, 'untitled'))).toBe(false)
  })

  test('should write nothing when the create dialog is cancelled', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    const before = (await readdir(testProject.path)).sort()

    await tree.newFileButton().click()
    await dialog.waitForNameEntry('Create New File')
    await dialog.nameInput().fill('should-not-exist.md')
    await dialog.namedCancelButton().click()
    await dialog.waitForClosed()

    expect((await readdir(testProject.path)).sort()).toEqual(before)
    await expect(tree.fileRow('should-not-exist.md')).toHaveCount(0)
  })

  test('should write nothing when the create dialog is dismissed with Escape', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    const before = (await readdir(testProject.path)).sort()

    await tree.newFileButton().click()
    await dialog.waitForNameEntry('Create New File')
    await dialog.dismissWithEscape()

    expect((await readdir(testProject.path)).sort()).toEqual(before)
  })

  test('should refuse a duplicate name and leave the existing file untouched', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.newFileButton().click()
    await dialog.waitForNameEntry('Create New File')
    await dialog.submitName('precious.md', 'Create')

    // The refusal is user-visible. `createFile` throws main-side and the
    // renderer maps it to this message; the dialog has already closed by then,
    // because New File is the one entry point that gets no sibling list and so
    // cannot catch the collision inline.
    await expect(toastWithText(windowWithTestProject, 'A file with this name already exists')).toBeVisible({
      timeout: 10_000
    })

    // …and, the point of the test, the original bytes are still there.
    expect(await readFile(join(testProject.path, 'precious.md'), 'utf-8')).toBe(PRECIOUS_CONTENT)
  })

  test('should create a folder from the toolbar and list it in the tree', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.newFolderButton().click()
    await dialog.waitForNameEntry('Create New Folder')
    await dialog.submitName('drafts', 'Create')

    await expect(tree.folderRow('drafts')).toBeVisible({ timeout: 10_000 })
    expect((await stat(join(testProject.path, 'drafts'))).isDirectory()).toBe(true)
  })
})

test.describe('Project tree – renaming', () => {
  test('should rename a file, and move its bytes to the new name', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.runContextMenuAction(tree.fileRow('precious.md'), 'Rename')
    await dialog.waitForNameEntry('Rename File')
    // The dialog seeds the current name — a rename that starts from an empty
    // field would be a regression in its own right.
    await expect(dialog.nameInput()).toHaveValue('precious.md')
    await dialog.submitName('treasured.md', 'Rename')

    await tree.waitForFile('treasured.md')
    await tree.waitForFileGone('precious.md')

    expect(await readFile(join(testProject.path, 'treasured.md'), 'utf-8')).toBe(PRECIOUS_CONTENT)
    expect(await exists(join(testProject.path, 'precious.md'))).toBe(false)
  })

  test('should block a rename onto a sibling name and keep both files', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.runContextMenuAction(tree.fileRow('precious.md'), 'Rename')
    await dialog.waitForNameEntry('Rename File')
    await dialog.nameInput().fill('README.md')

    // Rename is the one entry point that is handed the sibling names, so the
    // collision is caught inline. `FileSystemDialog` validates on submit, not
    // on keystroke, so the error only appears once Rename is pressed — and the
    // dialog must stay open rather than committing the collision.
    await dialog.primaryButton('Rename').click()
    await expect(dialog.validationError()).toHaveText('A file with this name already exists')
    await expect(dialog.container()).toBeVisible()

    await dialog.dismissWithEscape()
    expect(await readFile(join(testProject.path, 'precious.md'), 'utf-8')).toBe(PRECIOUS_CONTENT)
    expect(await exists(join(testProject.path, 'README.md'))).toBe(true)
  })

  test('should rename a folder and keep the files inside it', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.runContextMenuAction(tree.folderRow('docs'), 'Rename')
    await dialog.waitForNameEntry('Rename Folder')
    await dialog.submitName('handbook', 'Rename')

    await expect(tree.folderRow('handbook')).toBeVisible({ timeout: 10_000 })
    await expect(tree.folderRow('docs')).toHaveCount(0)

    expect(await readFile(join(testProject.path, 'handbook', 'guide.md'), 'utf-8')).toContain(
      'Nested document.'
    )
  })
})

test.describe('Project tree – deleting', () => {
  test('should delete a file only after the confirmation is accepted', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.runContextMenuAction(tree.fileRow('precious.md'), 'Delete')
    await dialog.waitForConfirm('Delete File')
    await expect(dialog.confirmMessage()).toContainText('precious.md')
    await dialog.accept()

    await tree.waitForFileGone('precious.md')
    expect(await exists(join(testProject.path, 'precious.md'))).toBe(false)
  })

  test('should keep the file when the delete confirmation is declined', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.runContextMenuAction(tree.fileRow('precious.md'), 'Delete')
    await dialog.waitForConfirm('Delete File')
    await dialog.decline()

    await expect(tree.fileRow('precious.md')).toBeVisible()
    expect(await readFile(join(testProject.path, 'precious.md'), 'utf-8')).toBe(PRECIOUS_CONTENT)
  })

  test('should delete a folder and everything inside it', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await tree.runContextMenuAction(tree.folderRow('docs'), 'Delete')
    await dialog.waitForConfirm('Delete Folder')
    await dialog.accept()

    await expect(tree.folderRow('docs')).toHaveCount(0, { timeout: 10_000 })
    expect(await exists(join(testProject.path, 'docs'))).toBe(false)
  })
})

test.describe('Project tree – copy and paste', () => {
  test('should copy a file into a folder and leave the original in place', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)

    await tree.runContextMenuAction(tree.fileRow('precious.md'), 'Copy')
    await tree.runContextMenuAction(tree.folderRow('docs'), 'Paste')

    const pasted = join(testProject.path, 'docs', 'precious.md')
    await expect
      .poll(async () => exists(pasted), { timeout: 10_000 })
      .toBe(true)
    expect(await readFile(pasted, 'utf-8')).toBe(PRECIOUS_CONTENT)

    // Copy is not move: the source must survive.
    expect(await readFile(join(testProject.path, 'precious.md'), 'utf-8')).toBe(PRECIOUS_CONTENT)
    await expect(tree.fileRow('precious.md')).toBeVisible()
  })

  test('should offer Paste only once something is on the clipboard', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)

    await tree.openContextMenu(tree.folderRow('docs'))
    await expect(tree.contextMenuItem('Paste')).toHaveCount(0)
    await windowWithTestProject.keyboard.press('Escape')
    await expect(tree.contextMenu()).toHaveCount(0)

    await tree.runContextMenuAction(tree.fileRow('precious.md'), 'Copy')

    await tree.openContextMenu(tree.folderRow('docs'))
    await expect(tree.contextMenuItem('Paste')).toBeVisible()
  })
})

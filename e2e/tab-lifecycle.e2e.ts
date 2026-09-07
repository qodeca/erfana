// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Editor tab lifecycle — open, switch, dirty state, close, and the
 * unsaved-changes gate in front of every close path.
 *
 * The tab bar is the app's main navigation surface and had no end-to-end
 * coverage at all. The part that matters most is the confirmation in front of
 * closing a dirty tab: `useTabContextMenu` and the ⌘W handler each re-implement
 * that gate, so a regression in either one silently discards the user's typing.
 *
 * Every "closed a dirty tab" test therefore asserts on disk as well as on
 * screen — closing without saving must leave the file exactly as it was, and
 * cancelling must leave the tab open and still dirty.
 *
 * Autosave is deliberately kept out of the way here. `useAutoSave` commits two
 * seconds after the last keystroke, which would race every dirty-state
 * assertion; these tests assert the dirty dot the moment it appears and close
 * the tab well inside that window. The save path itself is covered in
 * `editor-save.e2e.ts`.
 *
 * @see src/renderer/src/components/Tabs/useTabContextMenu.tsx
 * @see src/renderer/src/hooks/useKeyboardShortcuts.ts
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { DialogPage } from './pages/dialog.page'
import { MonacoPage } from './pages/monaco.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { KeyboardHelper } from './pages/keyboard.helper'

const ALPHA = '# Alpha\n\nFirst document.\n'
const BETA = '# Beta\n\nSecond document.\n'
const GAMMA = '# Gamma\n\nThird document.\n'

test.use({
  testProjectFiles: {
    'alpha.md': ALPHA,
    'beta.md': BETA,
    'gamma.md': GAMMA
  }
})

/** Open a file from the tree and wait for its tab to exist. */
async function openFile(
  tree: ProjectTreePage,
  tabs: TabBarPage,
  fileName: string
): Promise<void> {
  await tree.fileRow(fileName).click()
  await tabs.waitForTab(fileName)
}

/**
 * Type into the active editor so its tab goes dirty, and wait for the dot.
 *
 * A file opens in preview mode, so the view has to be switched before Monaco
 * exists at all. Monaco's own `insertText` command is used rather than
 * `keyboard.type` — `e2e-lessons-learned.md` records that keystroke replay
 * into Monaco is the flakiest thing in this suite.
 */
async function makeDirty(
  page: Page,
  tabs: TabBarPage,
  fileName: string
): Promise<void> {
  const panel = new EditorPanelPage(page)
  const monaco = new MonacoPage(page, new KeyboardHelper(page))

  await panel.waitForReady()
  await panel.setViewMode('editor')
  await monaco.waitForReady()
  await monaco.appendContent('\nedited\n')
  await expect(tabs.dirtyDot(fileName)).toBeVisible({ timeout: 10_000 })
}

test.describe('Editor tabs – opening and switching', () => {
  test('should open a tab per file and keep the Welcome tab alongside them', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)

    await expect(tabs.welcomeTab()).toBeVisible()

    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')

    await expect(tabs.allTabs()).toHaveCount(2)
    // The Welcome tab is non-closable and must survive every open.
    await expect(tabs.welcomeTab()).toBeVisible()
  })

  test('should reuse the existing tab when the same file is clicked again', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)

    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')
    await tree.fileRow('alpha.md').click()

    // Reopening focuses the existing panel — it must not stack a duplicate.
    await expect(tabs.allTabs()).toHaveCount(2)
    await tabs.expectActive('alpha.md')
  })

  test('should switch the editor content when a background tab is clicked', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    const panel = new EditorPanelPage(windowWithTestProject)

    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')
    await tabs.expectActive('beta.md')

    // Asserted through the preview pane rather than Monaco, because preview is
    // the mode a file actually opens in — this is the default journey.
    await panel.waitForReady()
    await expect(panel.previewPane()).toContainText('Second document.')

    await tabs.activate('alpha.md')
    // The panel must show the newly-activated file, not the previous buffer.
    await expect(panel.previewPane()).toContainText('First document.')
    await expect(panel.previewPane()).not.toContainText('Second document.')
  })
})

test.describe('Editor tabs – dirty state', () => {
  test('should show no dirty dot on a freshly opened file', async ({ windowWithTestProject }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)

    await openFile(tree, tabs, 'alpha.md')
    await expect(tabs.dirtyDot('alpha.md')).toHaveCount(0)
  })

  test('should mark only the edited tab as dirty', async ({ windowWithTestProject }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')
    await makeDirty(windowWithTestProject, tabs, 'beta.md')

    // Dirty state is per panel; the untouched tab must stay clean.
    await expect(tabs.dirtyDot('alpha.md')).toHaveCount(0)
  })
})

test.describe('Editor tabs – closing', () => {
  test('should close a clean tab straight away, with no confirmation', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    await openFile(tree, tabs, 'alpha.md')
    await tabs.closeButton('alpha.md').click()

    await tabs.waitForTabGone('alpha.md')
    await expect(dialog.container()).toHaveCount(0)
  })

  test('should ask before closing a dirty tab, and keep it open when declined', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)
    await openFile(tree, tabs, 'alpha.md')
    await makeDirty(windowWithTestProject, tabs, 'alpha.md')

    await tabs.closeButton('alpha.md').click()
    await dialog.waitForConfirm('Unsaved Changes')
    await expect(dialog.confirmMessage()).toContainText('alpha.md')
    await dialog.decline()

    // Declining must be a true no-op: tab still there, still dirty.
    await expect(tabs.tab('alpha.md')).toBeVisible()
    await expect(tabs.dirtyDot('alpha.md')).toBeVisible()
  })

  test('should discard the edit when the unsaved-changes warning is accepted', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)
    await openFile(tree, tabs, 'alpha.md')
    await makeDirty(windowWithTestProject, tabs, 'alpha.md')

    await tabs.closeButton('alpha.md').click()
    await dialog.waitForConfirm('Unsaved Changes')
    await dialog.accept()

    await tabs.waitForTabGone('alpha.md')
    // "Close Without Saving" must mean exactly that — the file on disk is
    // still the seeded text, not the edited buffer.
    expect(await readFile(join(testProject.path, 'alpha.md'), 'utf-8')).toBe(ALPHA)
  })

  test('should close only the active tab with the keyboard shortcut', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)

    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')
    await tabs.expectActive('beta.md')

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+w`)

    await tabs.waitForTabGone('beta.md')
    // Regression guard: dockview keeps every opened editor mounted, and each
    // one registers its own window-level keydown listener. Before the fix,
    // a single ⌘W was handled by all of them and wiped out every tab.
    await expect(tabs.tab('alpha.md')).toBeVisible()
    await expect(tabs.allTabs()).toHaveCount(1)
  })

  test('should not close a background tab that the shortcut never targeted', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)

    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')
    await openFile(tree, tabs, 'gamma.md')

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+w`)

    await tabs.waitForTabGone('gamma.md')
    await expect(tabs.allTabs()).toHaveCount(2)
    await expect(tabs.tab('alpha.md')).toBeVisible()
    await expect(tabs.tab('beta.md')).toBeVisible()
  })

  test('should not raise a warning for a background tab when the active tab is clean', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)

    // beta is left dirty in the background; alpha is active and clean.
    await openFile(tree, tabs, 'beta.md')
    await makeDirty(windowWithTestProject, tabs, 'beta.md')
    await openFile(tree, tabs, 'alpha.md')
    await tabs.expectActive('alpha.md')

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+w`)

    // Closing a clean tab must not drag the background tab's unsaved state
    // into a confirmation the user never asked for.
    await tabs.waitForTabGone('alpha.md')
    await expect(dialog.container()).toHaveCount(0)
    await expect(tabs.tab('beta.md')).toBeVisible()
    await expect(tabs.dirtyDot('beta.md')).toBeVisible()
  })

  test('should gate the keyboard close behind the same unsaved-changes warning', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)
    await openFile(tree, tabs, 'alpha.md')
    await makeDirty(windowWithTestProject, tabs, 'alpha.md')

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+w`)

    // The shortcut path re-implements the gate; it must not be a back door
    // around the confirmation the close button raises.
    await dialog.waitForConfirm('Unsaved Changes')
    await dialog.decline()
    await expect(tabs.tab('alpha.md')).toBeVisible()
  })
})

test.describe('Editor tabs – bulk close from the tab menu', () => {
  test('should close every other tab and keep the one clicked', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)

    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')
    await openFile(tree, tabs, 'gamma.md')

    await tabs.runContextMenuAction('beta.md', 'Close Others')

    await expect(tabs.allTabs()).toHaveCount(1)
    await expect(tabs.tab('beta.md')).toBeVisible()
  })

  test('should close every tab and leave the Welcome tab standing', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)

    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')

    await tabs.runContextMenuAction('alpha.md', 'Close All')

    await expect(tabs.allTabs()).toHaveCount(0)
    await expect(tabs.welcomeTab()).toBeVisible()
  })

  test('should warn once, naming the dirty file, before closing all tabs', async ({
    windowWithTestProject,
    testProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)
    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')
    await makeDirty(windowWithTestProject, tabs, 'beta.md')

    await tabs.runContextMenuAction('alpha.md', 'Close All')

    await dialog.waitForConfirm('Unsaved Changes')
    await expect(dialog.confirmMessage()).toContainText('beta.md')
    await dialog.accept()

    await expect(tabs.allTabs()).toHaveCount(0)
    expect(await readFile(join(testProject.path, 'beta.md'), 'utf-8')).toBe(BETA)
  })

  test('should keep every tab open when the bulk-close warning is declined', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    const dialog = new DialogPage(windowWithTestProject)
    await openFile(tree, tabs, 'alpha.md')
    await openFile(tree, tabs, 'beta.md')
    await makeDirty(windowWithTestProject, tabs, 'beta.md')

    await tabs.runContextMenuAction('alpha.md', 'Close All')
    await dialog.waitForConfirm('Unsaved Changes')
    await dialog.decline()

    await expect(tabs.allTabs()).toHaveCount(2)
  })
})

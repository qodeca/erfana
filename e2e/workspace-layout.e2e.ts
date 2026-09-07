// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Workspace shell — activity-bar toggles, the panel keyboard shortcuts, the
 * empty states, and the recent-projects list.
 *
 * These are the surfaces the user sees before they open anything, and the ones
 * they hit dozens of times a session. None of them had end-to-end coverage:
 * `terminal-expand.e2e.ts` and `dockview-resize.e2e.ts` cover sash dragging,
 * but nothing covered showing and hiding the panels in the first place, and
 * nothing covered what the app says when there is nothing to show.
 *
 * Empty states are worth testing precisely because they are easy to break
 * silently — a panel that renders blank instead of "Open a project to get
 * started" still passes every test that only checks for the absence of files.
 *
 * @see src/renderer/src/components/DockLayout/AppDockLayout.tsx
 * @see src/renderer/src/components/ActivityBar/activityBarConfig.ts
 * @see src/renderer/src/components/Panels/WelcomePanel.tsx
 */

import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { byTestId } from './utils/locators'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

test.use({
  testProjectFiles: {
    'readme.md': '# Readme\n\nA markdown file.\n',
    'notes.txt': 'A plain text file, not markdown.\n'
  }
})

test.describe('Empty states', () => {
  test('should invite the user to open a project when none is open', async ({ window }) => {
    await expect(byTestId(window, TEST_IDS.PROJECT_TREE_EMPTY)).toBeVisible({ timeout: 10_000 })
    await expect(byTestId(window, TEST_IDS.WELCOME_BTN_OPEN)).toContainText('Open project')
  })

  test('should not offer Import until a project is open', async ({ window }) => {
    // Import writes into the project's `import/` directory, so it is
    // meaningless without one.
    await expect(byTestId(window, TEST_IDS.WELCOME_BTN_IMPORT)).toHaveCount(0)
  })

  test('should hide the terminal until a project is open', async ({ window }) => {
    // The terminal activity-bar entry is `requiresProject`, and the whole
    // terminal splitview panel is added and removed with the project.
    await expect(byTestId(window, TEST_IDS.TERMINAL_PANEL)).toHaveCount(0)
  })

  test('should show the welcome placeholder in the editor area', async ({ window }) => {
    await expect(window.locator('.welcome-tab')).toBeVisible({ timeout: 10_000 })
    await expect(byTestId(window, TEST_IDS.EDITOR_CONTENT)).toHaveCount(0)
  })
})

test.describe('Activity bar', () => {
  test('should hide and restore the project panel', async ({ windowWithTestProject }) => {
    const filesButton = byTestId(windowWithTestProject, TEST_IDS.ACTIVITY_BAR_BTN_FILES)
    const tree = byTestId(windowWithTestProject, TEST_IDS.PROJECT_TREE)

    await expect(tree).toBeVisible()

    // The splitview collapses the panel rather than unmounting it, so assert
    // on visibility. `toHaveCount(0)` would be asserting an implementation
    // choice the layout does not make.
    await filesButton.click()
    await expect(tree).toBeHidden({ timeout: 10_000 })

    await filesButton.click()
    await expect(tree).toBeVisible({ timeout: 10_000 })
  })

  test('should hide and restore the terminal panel', async ({ windowWithTestProject }) => {
    const terminalButton = byTestId(windowWithTestProject, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
    const terminal = byTestId(windowWithTestProject, TEST_IDS.TERMINAL_PANEL)

    await expect(terminal).toBeVisible({ timeout: 15_000 })

    await terminalButton.click()
    await expect(terminal).toBeHidden({ timeout: 10_000 })

    await terminalButton.click()
    await expect(terminal).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('Panel keyboard shortcuts', () => {
  test('should toggle the project panel', async ({ windowWithTestProject, keyboardHelper }) => {
    const modifier = await keyboardHelper.getModifier()
    const tree = byTestId(windowWithTestProject, TEST_IDS.PROJECT_TREE)

    await expect(tree).toBeVisible()

    await windowWithTestProject.keyboard.press(`${modifier}+b`)
    await expect(tree).toBeHidden({ timeout: 10_000 })

    await windowWithTestProject.keyboard.press(`${modifier}+b`)
    await expect(tree).toBeVisible({ timeout: 10_000 })
  })

  test('should toggle the terminal panel', async ({ windowWithTestProject, keyboardHelper }) => {
    const modifier = await keyboardHelper.getModifier()
    const terminal = byTestId(windowWithTestProject, TEST_IDS.TERMINAL_PANEL)

    await expect(terminal).toBeVisible({ timeout: 15_000 })

    await windowWithTestProject.keyboard.press(`${modifier}+j`)
    await expect(terminal).toBeHidden({ timeout: 10_000 })

    await windowWithTestProject.keyboard.press(`${modifier}+j`)
    await expect(terminal).toBeVisible({ timeout: 15_000 })
  })

  test('should do nothing on the terminal shortcut with no project open', async ({
    window,
    keyboardHelper
  }) => {
    await expect(byTestId(window, TEST_IDS.PROJECT_TREE_EMPTY)).toBeVisible({ timeout: 10_000 })

    await windowWithNoCrash(window, `${await keyboardHelper.getModifier()}+j`)

    // The shortcut is project-gated. It must be inert, not throw the layout
    // into a state with a terminal panel and nothing to run it against.
    await expect(byTestId(window, TEST_IDS.TERMINAL_PANEL)).toHaveCount(0)
    await expect(byTestId(window, TEST_IDS.ROOT_ERROR_BOUNDARY)).toHaveCount(0)
  })
})

test.describe('Project tree filter', () => {
  test('should list every file by default and only markdown when filtered', async ({
    windowWithTestProject
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)

    await expect(tree.fileRow('readme.md')).toBeVisible({ timeout: 10_000 })
    await expect(tree.fileRow('notes.txt')).toBeVisible()

    await windowWithTestProject.getByTitle('Show Filter Options').click()
    // Exact name: "Create new markdown file" in the toolbar also matches a
    // loose /markdown/ search.
    await windowWithTestProject
      .getByRole('button', { name: 'Markdown Only', exact: true })
      .click()

    // The markdown file stays; the plain-text one goes.
    await expect(tree.fileRow('readme.md')).toBeVisible()
    await expect(tree.fileRow('notes.txt')).toHaveCount(0, { timeout: 10_000 })
  })
})

test.describe('Recent projects', () => {
  test('should list the project that was just opened', async ({ windowWithTestProject, testProject }) => {
    const recent = byTestId(windowWithTestProject, TEST_IDS.WELCOME_RECENT_PROJECTS)

    await expect(recent).toBeVisible({ timeout: 10_000 })
    await expect(recent).toContainText(testProject.path)
  })

  test('should drop an entry when its remove button is used', async ({
    windowWithTestProject
  }) => {
    // Rows carry `welcome-recent-project-<path hash>`, so match the prefix
    // rather than reproducing the renderer's hash of a temp path. The remove
    // button's id (`welcome-recent-project-btn-remove-<hash>`) shares that
    // prefix, so it has to be excluded explicitly.
    const entries = windowWithTestProject.locator(
      `[data-testid^="${TEST_IDS.WELCOME_RECENT_PROJECT}-"]` +
        `:not([data-testid^="${TEST_IDS.WELCOME_RECENT_PROJECT_BTN_REMOVE}-"])`
    )
    await expect(entries).toHaveCount(1, { timeout: 10_000 })

    await windowWithTestProject
      .locator(`[data-testid^="${TEST_IDS.WELCOME_RECENT_PROJECT_BTN_REMOVE}-"]`)
      .first()
      .click()

    await expect(entries).toHaveCount(0, { timeout: 10_000 })
  })
})

/**
 * Press a key and give the app a beat to react, without asserting anything
 * about the result — used by the "shortcut is inert" case, where the point is
 * that nothing happens.
 */
async function windowWithNoCrash(
  window: import('@playwright/test').Page,
  key: string
): Promise<void> {
  await window.keyboard.press(key)
  // Settle on a condition the app already satisfies rather than sleeping: the
  // activity bar is always mounted, so this resolves as soon as the renderer
  // has processed the keypress and re-rendered.
  await expect(byTestId(window, TEST_IDS.ACTIVITY_BAR)).toBeVisible()
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: every panel toolbar action stays reachable at the narrowest panel (#451).
 *
 * Drags the terminal's and the project tree's splitters with a real pointer down
 * to the dock's minimum width, then checks each action the toolbar showed when
 * wide: either its button is whole inside the row, or the row's "More actions"
 * (…) menu lists it. Then drives the menu by keyboard and runs Maximize terminal
 * from it – the button #451 lost.
 *
 * The contract is the Toolbar overflow card
 * (docs/design-system/system/patterns/toolbar-overflow, decided 2026-11-03).
 *
 * Manual launch pattern, as terminal-expand.e2e.ts (CLI-arg project loading is
 * fixme'd in the composed fixtures; projects are opened over IPC).
 */

import { test, expect, _electron as electron, Page } from '@playwright/test'
import * as path from 'path'
import {
  TEST_IDS,
  waitForTestId,
  waitForAppReady,
  openProject,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'
import { TerminalPage } from './pages/terminal.page'
import { ToolbarOverflowPage, type Reach } from './pages/toolbar-overflow.page'
import { E2E_CHROMIUM_ARGS } from './fixtures/isolation'

const SEED = { 'note.md': '# Note\n' }

/** Far enough to reach the dock's minimum side-panel width from any start. */
const DRAG_TO_MIN_PX = 1500

/** The dock's minimum side-panel width is 170 px (`MIN_SIZES`); allow the sash. */
const NARROW_MAX_PX = 200

function unreachable(reach: Record<string, Reach>): string[] {
  return Object.entries(reach)
    .filter(([, how]) => how === 'unreachable')
    .map(([id]) => id)
}

test.describe('Panel toolbar overflow (#451)', () => {
  test('every terminal and project action is reachable at the narrowest panel, by pointer and keyboard', async () => {
    test.setTimeout(120_000)

    const { projectPath, cleanup: cleanupProject } = await createTestProject(SEED)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('toolbar-overflow')
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`, ...E2E_CHROMIUM_ARGS],
      env: { ...process.env, NODE_ENV: 'development' }
    })
    let window: Page | undefined

    try {
      window = await electronApp.firstWindow()
      const win = window
      await waitForAppReady(win)
      await openProject(win, projectPath)
      await waitForTestId(win, TEST_IDS.PROJECT_TREE, { timeout: 10_000 })

      const terminal = new TerminalPage(win)
      await terminal.open()
      await expect(terminal.expandButton()).toBeVisible()

      const bars = new ToolbarOverflowPage(win)
      const terminalPanel = win.locator(`[data-testid="${TEST_IDS.TERMINAL_PANEL}"]`)
      const projectTree = win.locator(`[data-testid="${TEST_IDS.PROJECT_TREE}"]`)

      // The default terminal width already overflows, so each panel is widened
      // first: with no … in its row, every action the toolbar offers is a row button.
      let terminalActions: string[] = []
      let projectActions: string[] = []

      await test.step('widen the terminal until nothing has moved → collect its actions', async () => {
        await bars.dragPanelEdge(projectTree, 'right', -DRAG_TO_MIN_PX)
        await bars.dragPanelEdge(terminalPanel, 'left', -DRAG_TO_MIN_PX)
        await expect(bars.moreButton(bars.terminalHeader())).toHaveCount(0)
        terminalActions = await bars.rowActionTestIds(bars.terminalHeader())
        expect(terminalActions).toContain(TEST_IDS.TERMINAL_BTN_EXPAND)
        expect(terminalActions.length).toBeGreaterThanOrEqual(5)
      })

      await test.step('narrow the terminal to the dock minimum → every action reachable', async () => {
        await bars.dragPanelEdge(terminalPanel, 'left', DRAG_TO_MIN_PX)
        await expect
          .poll(async () => (await terminalPanel.boundingBox())?.width ?? 0)
          .toBeLessThanOrEqual(NARROW_MAX_PX)
        const reach = await bars.reachability(bars.terminalHeader(), terminalActions)
        expect(unreachable(reach), JSON.stringify(reach)).toEqual([])
        expect(Object.values(reach)).toContain('menu')
        // Maximize terminal is raised: it is still in the row beside … (#451).
        expect(reach[TEST_IDS.TERMINAL_BTN_EXPAND]).toBe('row')
      })

      await test.step('widen the project tree until nothing has moved → collect its actions', async () => {
        await bars.dragPanelEdge(projectTree, 'right', DRAG_TO_MIN_PX)
        await expect(bars.moreButton(bars.projectRow())).toHaveCount(0)
        projectActions = await bars.rowActionTestIds(bars.projectRow())
        expect(projectActions).toHaveLength(6)
      })

      await test.step('narrow the project tree to the dock minimum → every action reachable', async () => {
        await bars.dragPanelEdge(projectTree, 'right', -DRAG_TO_MIN_PX)
        await expect
          .poll(async () => (await projectTree.boundingBox())?.width ?? 0)
          .toBeLessThanOrEqual(NARROW_MAX_PX)
        const reach = await bars.reachability(bars.projectRow(), projectActions)
        expect(unreachable(reach), JSON.stringify(reach)).toEqual([])
        expect(Object.values(reach)).toContain('menu')
        expect(reach[TEST_IDS.PROJECT_TREE_BTN_NEW_FILE]).toBe('row')
        // The project header's one button never trades itself for … (card rule 5).
        const filter = bars.projectHeader().getByRole('button', { name: 'File filter' })
        await expect(filter).toBeVisible()
        await expect(bars.moreButton(bars.projectHeader())).toHaveCount(0)
      })

      await test.step('keyboard: ↑ opens on the last item, Esc returns to …, Enter runs an item', async () => {
        const more = bars.moreButton(bars.terminalHeader())
        await more.focus()
        await win.keyboard.press('ArrowUp')
        await expect(bars.menu()).toBeVisible()
        await expect(more).toHaveAttribute('aria-expanded', 'true')
        // Maximize terminal is raised, so it is the last button – and the last item only if it moved.
        const items = bars.menu().locator('[role^="menuitem"]')
        await expect(items.last()).toBeFocused()
        await win.keyboard.press('Escape')
        await expect(bars.menu()).toHaveCount(0)
        await expect(more).toBeFocused()

        await win.keyboard.press('Enter')
        await expect(items.first()).toBeFocused()
        await win.keyboard.press('Tab')
        await expect(bars.menu()).toHaveCount(0)
        await expect(more).toBeFocused()

        // Run a menu item from the keyboard: Scroll lock is a checkbox item,
        // reached by typeahead (the only label starting with L).
        await win.keyboard.press('ArrowDown')
        const lock = bars.menuItem('Lock scroll to bottom')
        await expect(lock).toHaveAttribute('role', 'menuitemcheckbox')
        const wasChecked = (await lock.getAttribute('aria-checked')) === 'true'
        await win.keyboard.press('l')
        await expect(lock).toBeFocused()
        await win.keyboard.press('Enter')
        await expect(bars.menu()).toHaveCount(0)
        await expect(more).toBeFocused()
        await more.click()
        await expect(bars.menuItem('Lock scroll to bottom')).toHaveAttribute('aria-checked', String(!wasChecked))
        await win.keyboard.press('Escape')
      })
    } finally {
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})

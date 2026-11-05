// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * E2E: the terminal header at its default width (#462).
 *
 * Owner decision (2026-11-05): Scroll lock, Restart terminal and Scroll to
 * bottom are the last buttons in the row, so they are the first to move into
 * the "More actions" (…) menu. Every other button – the captures, the camera
 * and Maximize terminal – stays in the row at the default width.
 *
 * The panel is not dragged: a fresh profile opens the terminal at its default
 * width (`rightWidth` in useActivityBarStore). Design:
 * docs/designs/terminal-header/README.md.
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
import { ToolbarOverflowPage } from './pages/toolbar-overflow.page'
import { E2E_CHROMIUM_ARGS } from './fixtures/isolation'

/** The three buttons that come last and hide first, in row order. */
const HIDE_FIRST = [
  TEST_IDS.TERMINAL_BTN_LOCK,
  TEST_IDS.TERMINAL_BTN_RESTART,
  TEST_IDS.TERMINAL_BTN_SCROLL
]

/** Far enough to widen the panel past every button. */
const DRAG_WIDE_PX = 1500

test.describe('Terminal header at the default width (#462)', () => {
  test('the captures and Maximize stay in the row; Scroll lock, Restart and Scroll to bottom come last and hide first', async () => {
    test.setTimeout(120_000)

    const { projectPath, cleanup: cleanupProject } = await createTestProject({
      'note.md': '# Note\n'
    })
    const { userDataDir, cleanup: cleanupUserData } =
      await createTempUserDataDir('terminal-header-width')
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
      const header = bars.terminalHeader()
      const terminalPanel = win.locator(`[data-testid="${TEST_IDS.TERMINAL_PANEL}"]`)
      const projectTree = win.locator(`[data-testid="${TEST_IDS.PROJECT_TREE}"]`)

      await test.step('at the default width, only the three hide-first buttons are in the menu', async () => {
        const width = (await terminalPanel.boundingBox())?.width ?? 0
        expect(width, 'terminal opens at its default width').toBeGreaterThan(280)
        expect(width).toBeLessThan(320)

        const inRow = await bars.rowActionTestIds(header)
        expect(inRow).toContain(TEST_IDS.TERMINAL_BTN_EXPAND)
        expect(inRow).toContain(TEST_IDS.TERMINAL_BTN_CAMERA)
        const hasCaptures = inRow.includes(TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN)
        if (hasCaptures) {
          // macOS and Windows: eight buttons do not fit, so the three hide-first buttons move.
          expect(inRow).toEqual(
            expect.arrayContaining([
              TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW,
              TEST_IDS.TERMINAL_BTN_CAPTURE_AREA
            ])
          )
          const reach = await bars.reachability(header, HIDE_FIRST)
          expect(reach, JSON.stringify(reach)).toEqual({
            [TEST_IDS.TERMINAL_BTN_LOCK]: 'menu',
            [TEST_IDS.TERMINAL_BTN_RESTART]: 'menu',
            [TEST_IDS.TERMINAL_BTN_SCROLL]: 'menu'
          })
        }
        // Linux has no screen capture: its five buttons all fit, so nothing moves.
        else await expect(bars.moreButton(header)).toHaveCount(0)
      })

      await test.step('widened, the three hide-first buttons are the last in the row, in the owner’s order', async () => {
        await bars.dragPanelEdge(projectTree, 'right', -DRAG_WIDE_PX)
        await bars.dragPanelEdge(terminalPanel, 'left', -DRAG_WIDE_PX)
        await expect(bars.moreButton(header)).toHaveCount(0)
        const allActions = await bars.rowActionTestIds(header)
        expect(allActions.slice(-HIDE_FIRST.length)).toEqual(HIDE_FIRST)
        expect(allActions[allActions.length - HIDE_FIRST.length - 1]).toBe(
          TEST_IDS.TERMINAL_BTN_EXPAND
        )
      })
    } finally {
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})

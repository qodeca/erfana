// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: terminal maximize (over the editor area).
 *
 * Covers the riskiest part of the feature — the AppDockLayout splitview
 * manipulation — which has no unit test (dockview is not mocked). Verifies the
 * editor area collapses on maximize, restores to its prior width, auto-collapses
 * when a file is opened, and that focus moves correctly (not stranded on the
 * hidden editor).
 *
 * Uses the manual launch pattern (not the composed appWithTestProject fixture)
 * because CLI-arg project loading is fixme'd (fixture-smoke.e2e.ts:97); projects
 * must be opened via IPC with openProject(). Editor-area width is read via the
 * EDITOR_AREA testid (a stable anchor) rather than a positional dockview selector.
 */

import { test, expect, _electron as electron, Page } from '@playwright/test'
import * as path from 'path'
import {
  TEST_IDS,
  waitForTestId,
  waitForAppReady,
  openProject,
  clickFileByName,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'
import { TerminalPage } from './pages/terminal.page'

const testSeed = {
  'note.md': '# Note\n\nFirst file.\n',
  'other.md': '# Other\n\nSecond file.\n'
}

/** Rendered width of the editor area; 0 when collapsed (terminal maximized). */
async function editorAreaWidth(page: Page): Promise<number> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
    return el?.offsetWidth ?? -1
  }, TEST_IDS.EDITOR_AREA)
}

/** True when the active element is inside the element bearing the given testid. */
async function focusWithin(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => !!document.activeElement?.closest(`[data-testid="${id}"]`), testId)
}

test.describe('Terminal maximize', () => {
  test('maximizes over the editor, restores width, moves focus, auto-collapses', async () => {
    test.setTimeout(90_000)

    const { projectPath, cleanup: cleanupProject } = await createTestProject(testSeed)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('terminal-expand')

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'development' }
    })

    let window: Page | undefined

    try {
      window = await electronApp.firstWindow()
      const win = window
      await waitForAppReady(win)
      await openProject(win, projectPath)
      await waitForTestId(win, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      const terminal = new TerminalPage(win)
      const expandBtn = terminal.expandButton()

      let widthBeforeExpand = 0
      await test.step('open a file → editor visible', async () => {
        await clickFileByName(win, 'note.md')
        widthBeforeExpand = await editorAreaWidth(win)
        expect(widthBeforeExpand).toBeGreaterThan(0)
        await terminal.open()
      })

      await test.step('maximize → editor collapses, focus moves to terminal', async () => {
        await terminal.toggleExpand()
        await expect(expandBtn).toHaveAttribute('aria-pressed', 'true')
        await expect.poll(() => editorAreaWidth(win), { timeout: 5000 }).toBe(0)
        await expect(terminal.getTerminal()).toBeVisible()
        expect(await focusWithin(win, TEST_IDS.TERMINAL_INSTANCE)).toBe(true)
      })

      await test.step('restore → editor returns to ~prior width', async () => {
        await terminal.toggleExpand()
        await expect(expandBtn).toHaveAttribute('aria-pressed', 'false')
        await expect
          .poll(() => editorAreaWidth(win), { timeout: 5000 })
          .toBeGreaterThan(widthBeforeExpand * 0.8)
      })

      await test.step('auto-collapse when another file is opened', async () => {
        await terminal.toggleExpand()
        await expect(expandBtn).toHaveAttribute('aria-pressed', 'true')
        await expect.poll(() => editorAreaWidth(win), { timeout: 5000 }).toBe(0)
        await clickFileByName(win, 'other.md')
        await expect(expandBtn).toHaveAttribute('aria-pressed', 'false')
        await expect.poll(() => editorAreaWidth(win), { timeout: 5000 }).toBeGreaterThan(0)
      })
    } finally {
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})

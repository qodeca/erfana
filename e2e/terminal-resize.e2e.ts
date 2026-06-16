// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E regression test for the terminal/editor sash drag.
 *
 * Regression context: PR #200 (v0.10.0 terminal-maximize) added an
 * `onDidDimensionsChange` listener so user sash drags would persist the new
 * terminal width to the store. But the dynamic terminal-panel useEffect in
 * AppDockLayout kept `rightWidth` in its dependency array, so every persisted
 * drag tick re-ran the effect, which called
 * `existingPanel.api.setVisible(rightActivePanel === 'terminal')`. dockview's
 * `Splitview.setViewVisible` unconditionally runs `distributeEmptySpace +
 * layoutViews + saveProportions` (even when visibility is unchanged), which
 * re-laid out the panels mid-drag and stole the sash from the user's pointer.
 * Visible symptom: sash highlights on hover but cannot be dragged.
 *
 * This test simulates a real mouse drag of the editor/terminal sash and
 * verifies that the editor-area width actually changes — which it cannot do
 * if the effect's layout cascade is fighting the drag.
 *
 * Manual launch (not the composed fixture) — matches terminal-expand.e2e.ts
 * for parity with the sibling test that covers the same feature area.
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
  'note.md': '# Note\n\nFirst file.\n'
}

/** Rendered editor-area width. Terminal sits to its right; editor shrinks when terminal grows. */
async function editorAreaWidth(page: Page): Promise<number> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
    return el?.offsetWidth ?? -1
  }, TEST_IDS.EDITOR_AREA)
}

test.describe('Terminal sash drag', () => {
  test('drag of editor/terminal sash actually resizes the terminal panel', async () => {
    test.setTimeout(90_000)

    const { projectPath, cleanup: cleanupProject } = await createTestProject(testSeed)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'terminal-resize'
    )

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
      await waitForTestId(win, TEST_IDS.PROJECT_TREE, { timeout: 10_000 })

      const terminal = new TerminalPage(win)
      await clickFileByName(win, 'note.md')
      await terminal.open()

      // The splitview has 3 panels (left sidebar, center editor, terminal) → 2 sashes.
      // The sash between center editor and terminal is the LAST one (right-most).
      // dockview renders sashes inside `.dv-sash-container` as direct children.
      const sashHandle = win.locator(
        '.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash'
      ).last()
      await expect(sashHandle).toBeVisible()

      const widthBefore = await editorAreaWidth(win)
      expect(widthBefore).toBeGreaterThan(0)

      const sashBox = await sashHandle.boundingBox()
      if (!sashBox) throw new Error('sash bounding box missing')

      // Drag the sash 150px LEFT — that should widen the terminal (rightmost panel)
      // and narrow the editor area by ~150px. The exact delta depends on dockview
      // priorities; we just need to prove the layout actually moves.
      const startX = sashBox.x + sashBox.width / 2
      const startY = sashBox.y + sashBox.height / 2
      const dragBy = -150

      await win.mouse.move(startX, startY)
      await win.mouse.down()
      // Multiple intermediate moves match a real drag and exercise the per-tick
      // dimension-change events that triggered the regression.
      for (const step of [0.25, 0.5, 0.75, 1.0]) {
        await win.mouse.move(startX + dragBy * step, startY, { steps: 4 })
      }
      await win.mouse.up()

      // After release, the editor area should have meaningfully shrunk.
      // Polled to ride out the final dockview relayout.
      await expect
        .poll(() => editorAreaWidth(win), { timeout: 5_000 })
        .toBeLessThan(widthBefore - 50)

      const widthAfter = await editorAreaWidth(win)
      // Sanity bound: we asked for -150, we should be in that neighborhood (with
      // some tolerance for dockview's priority distribution and min-size clamps).
      expect(widthBefore - widthAfter).toBeGreaterThan(50)
      expect(widthBefore - widthAfter).toBeLessThan(300)
    } finally {
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})

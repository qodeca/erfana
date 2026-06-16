// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E regression guard: dockview drag-to-resize behavior survives CSS changes.
 *
 * Why this test exists: issue #211's audit added `user-select: text` to many
 * panel-content surfaces to undo dockview's inherited `none`. AC #7 of that
 * issue requires "no regression in dockview drag-to-resize." This test is the
 * concrete CI guarantee — if a future CSS change accidentally interferes with
 * dockview's sash drag (e.g. a global override that breaks the sash element's
 * pointer events or selection-during-drag handling), this test fails loudly.
 *
 * Manual launch pattern (composed fixtures are fixme'd, per
 * context-menu-explain.e2e.ts).
 *
 * @see docs/ui-style-guide.md § Text selection policy
 * @see https://github.com/qodeca/erfana/issues/211 (AC #7)
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'path'
import {
  TEST_IDS,
  byTestId,
  waitForTestId,
  waitForAppReady,
  openProject,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'

const SEED = {
  'test.md': '# Dockview resize regression test\n'
}

test.describe('Dockview drag-to-resize (#211 AC #7 regression guard)', () => {
  test.setTimeout(60_000)

  test('Sidebar sash drag widens the project tree pane', async () => {
    const { projectPath, cleanup: cleanupProject } = await createTestProject(SEED)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'dockview-resize'
    )

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'development' }
    })

    try {
      const window = await electronApp.firstWindow()
      await waitForAppReady(window)
      await openProject(window, projectPath)
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10_000 })

      // The sash between the project tree (left) and the editor area (right)
      // belongs to one of dockview-core's split / pane / sash containers. The
      // first matching sash from this set is the primary horizontal divider.
      const sash = window
        .locator('.split-view-container > .sash, .dv-sash-container .dv-sash, .splitview-react > .sash')
        .first()
      await expect(sash).toBeVisible({ timeout: 5_000 })

      const projectTreePane = byTestId(window, TEST_IDS.PROJECT_TREE)
      const beforeBox = await projectTreePane.boundingBox()
      const beforeWidth = beforeBox?.width ?? 0
      expect(beforeWidth, 'Project tree pane should have a measurable starting width').toBeGreaterThan(0)

      const sashBox = await sash.boundingBox()
      if (!sashBox) throw new Error('Sash bounding box returned null')

      const startX = sashBox.x + sashBox.width / 2
      const startY = sashBox.y + sashBox.height / 2
      // Drag 80 px to the right – well past dockview's drag-threshold tolerance.
      await window.mouse.move(startX, startY)
      await window.mouse.down()
      await window.mouse.move(startX + 80, startY, { steps: 10 })
      await window.mouse.up()
      await window.waitForTimeout(250) // settle layout

      const afterBox = await projectTreePane.boundingBox()
      const afterWidth = afterBox?.width ?? 0

      expect(
        afterWidth,
        `Sash drag should widen the project tree pane (before=${beforeWidth}px, after=${afterWidth}px). ` +
        `If this fails, a CSS change has interfered with dockview's drag-to-resize behavior.`
      ).toBeGreaterThan(beforeWidth + 20)
    } finally {
      await closeApp(electronApp)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})

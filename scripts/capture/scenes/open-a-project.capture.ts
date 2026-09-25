// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `open-a-project`: the start screen with the demo project in Recent
 * projects, the project just opened, and the project panel's header.
 * Guide page: how-to/open-a-project.md.
 */

import { expect, test } from '@playwright/test'
import { TEST_IDS, getDynamicTestId } from '../../../src/renderer/src/constants/testids'
import { blurAll, closeProject, launch, openProject } from '../lib/app'
import { anySelected, shot } from '../lib/shots'
import { ensureTerminalOpen, ptyLength, waitForShellPrompt } from '../lib/terminal'

const ROWS = ['open-a-project/welcome', 'open-a-project/project-open', 'open-a-project/project-header']

test('open-a-project', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch()
  const { page } = cap
  try {
    // Put the project in Recent projects the way a user would have: open it once, close it.
    await openProject(cap)
    await closeProject(cap)
    const recent = page.getByTestId(getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT, cap.sandbox.project))
    await expect(recent).toBeVisible()
    await blurAll(page)
    await shot(cap, 'open-a-project/welcome')

    const from = await ptyLength(page)
    await recent.click()
    await expect(page.getByTestId(TEST_IDS.PROJECT_TREE)).toBeVisible({ timeout: 20_000 })
    await ensureTerminalOpen(page)
    await waitForShellPrompt(page, { from })
    await blurAll(page)
    await shot(cap, 'open-a-project/project-open')

    // The project panel's header: project name, Change project, Close project
    // and the file buttons. (Their tooltips are native and do not show in a
    // screenshot; the guide names them in words.)
    await expect(page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_CLOSE)).toBeVisible()
    await shot(cap, 'open-a-project/project-header', {
      crop: [page.locator('.project-panel .control-panel-chevron'), page.locator('.project-tree-path')],
      pad: 10
    })
  } finally {
    await cap.close()
  }
})

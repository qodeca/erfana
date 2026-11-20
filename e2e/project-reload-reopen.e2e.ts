// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Reload, then reopen the same project (#485).
 *
 * A reload keeps the window's `webContents`, so main used to keep the old
 * page's project open while the new page started on the Welcome screen (#60).
 * Reopening that project was then a same-project no-op: no `project:changed`,
 * and the tree stayed empty. Main now closes the project on `did-navigate`, so
 * both ways back in – the Recent Projects row and a direct open by path – show
 * the tree again. Waits are condition-based only.
 */
import { basename } from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'
import { waitForAppReady } from './utils/helpers'
import { toastWithText } from './utils/toast'

/** A tree read on the test project, after the reopen. */
const TREE_BUDGET_MS = 15_000

/** The tree's file rows (the test project keeps its files at the root). */
function fileRows(page: Page) {
  return page.locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
}

/**
 * The project main holds open, read through the preload bridge; `null` when
 * none. After a close main answers `''`, so an empty answer counts as none.
 */
async function mainProjectPath(page: Page): Promise<string | null> {
  const projectPath = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, as the fixtures call it
    () => (window as any).api.file.getProjectPath() as Promise<string | null>
  )
  return projectPath || null
}

/** Reload the page and wait until main has closed the window's project, with no toast about it. */
async function reloadToWelcome(page: Page): Promise<void> {
  await expect(fileRows(page).first(), 'setup: the project is open before the reload').toBeVisible()
  expect(await mainProjectPath(page), 'setup: main holds the project before the reload').not.toBeNull()
  await page.reload()
  await waitForAppReady(page)
  await expect.poll(() => mainProjectPath(page), { message: 'main closed the project on reload (#485)' }).toBeNull()
  await expect(toastWithText(page, 'Project Closed'), 'a reload is not a close the user asked for').toHaveCount(0)
}

test.describe('reload, then reopen the same project (#485)', () => {
  test('the Recent Projects row shows the tree again', async ({ windowWithTestProject: page, testProject }) => {
    await reloadToWelcome(page)

    await new ProjectTreePage(page).switchToRecent(basename(testProject.path))

    await expect(fileRows(page).first()).toBeVisible({ timeout: TREE_BUDGET_MS })
    await expect(byTestId(page, TEST_IDS.PROJECT_TREE)).toBeVisible()
    await expect(toastWithText(page, 'Project Closed')).toHaveCount(0)
  })

  test('opening it by path shows the tree again', async ({ windowWithTestProject: page, testProject }) => {
    await reloadToWelcome(page)

    // The reply is the path for a real open and for a same-project no-op alike: the tree tells them apart
    await page.evaluate(async (projectPath) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, as the fixtures call it
      await (window as any).api.file.openProjectByPath({ projectPath })
    }, testProject.path)

    await expect(fileRows(page).first()).toBeVisible({ timeout: TREE_BUDGET_MS })
  })

  test('a reload with no project open changes nothing, and the project opens afterwards', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    await reloadToWelcome(page)
    // The second reload finds no session: its did-navigate must be a no-op
    await page.reload()
    await waitForAppReady(page)

    await new ProjectTreePage(page).switchToRecent(basename(testProject.path))

    await expect(fileRows(page).first()).toBeVisible({ timeout: TREE_BUDGET_MS })
  })
})

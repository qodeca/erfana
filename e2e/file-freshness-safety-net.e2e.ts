// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * #478 the safety net and the one notice per panel (plan § 5.3: S1, N3, G8,
 * F13).
 *
 * - **S1** – a change whose event never arrived (main's watch messages muted)
 *   still reaches an unedited editor on window focus, and a hidden image tab
 *   when it is shown.
 * - **N3** – focusing the window ten times over an unchanged file leaves cursor
 *   and scroll where they were; showing the tab ten times reads nothing new:
 *   no reload, no notice, same text, same cursor line.
 * - **G8** – a change made while the PC slept (the watches died silently) is
 *   shown in the editor within 2 s of the wake with no focus change, and in a
 *   hidden image tab when it is shown.
 * - **F13** – a panel shows one notice, the one that matters most (a conflict
 *   over the watch-limit notice), and a background tab's status region stays
 *   silent until its tab is in front.
 *
 * G7 (network drives, `\\wsl$`) is a manual check (plan § 5.5); its forced
 * `limited` state is unit-tested. Condition-based waits only.
 */
import { rm } from 'fs/promises'
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { ImageViewerPage } from './pages/image-viewer.page'
import { FileFreshnessPage } from './pages/file-freshness.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { writeInPlace } from './utils/freshness-writers'

/** A check (focus, show) reaching its read and render. */
const SHOW_BUDGET_MS = 10_000
/** G8: a change made during sleep is caught within 2 s of the wake. */
const WAKE_BUDGET_MS = 2_000
/** Delete settle + confirm + existence re-check. */
const DELETE_BUDGET_MS = 15_000
/** N3: focus and show rounds over an unchanged file. */
const ROUNDS = 10

function doc(marker: string): string {
  return `# Doc\n\n${marker}\n`
}

function svg(marker: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-marker="${marker}" width="64" height="64" viewBox="0 0 64 64">` +
    '<rect width="64" height="64" fill="#1f1f1f"/></svg>\n'
  )
}

test.use({
  testProjectFiles: {
    'a.md': doc('start-a'),
    'b.md': doc('start-b'),
    'long.md': `# Long\n\n${Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`).join('\n')}\n`,
    'pic.svg': svg('start'),
    'other.svg': svg('other')
  }
})

function poms(page: Page, app: ElectronApplication) {
  return {
    tree: new ProjectTreePage(page),
    tabs: new TabBarPage(page),
    panel: new EditorPanelPage(page),
    monaco: new MonacoPage(page, new KeyboardHelper(page)),
    fresh: new FileFreshnessPage(page, app)
  }
}

async function openFile(page: Page, app: ElectronApplication, name: string, marker: string): Promise<void> {
  const { tree, tabs, panel, fresh } = poms(page, app)
  await tree.fileRow(name).click()
  await tabs.waitForTab(name)
  await panel.waitForReady()
  await fresh.waitForContent(marker)
}

test.describe('#478 safety net', () => {
  test('S1: a change whose event never arrived reaches an unedited editor on focus and a hidden image when shown', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { fresh } = poms(page, app)
    const viewer = new ImageViewerPage(page, SHOW_BUDGET_MS)
    await openFile(page, app, 'a.md', 'start-a')
    await viewer.openFromTree('pic.svg')
    await viewer.openFromTree('other.svg')
    await new TabBarPage(page).activate('a.md')

    await fresh.muteWatchEvents(true)
    try {
      await writeInPlace(join(testProject.path, 'a.md'), doc('muted-a'))
      await writeInPlace(join(testProject.path, 'pic.svg'), svg('muted-pic'))
      await fresh.signalWindowFocus()
      await fresh.waitForContent('muted-a', SHOW_BUDGET_MS, 'S1: the focus check never read the editor file')

      await viewer.openFromTree('pic.svg')
      await viewer.waitForMarker('muted-pic')
    } finally {
      await fresh.muteWatchEvents(false)
    }
  })

  test('N3: ten focus and show rounds over an unchanged file change nothing', async ({
    windowWithTestProject: page,
    appWithTestProject: app
  }) => {
    const { tabs, panel, monaco, fresh } = poms(page, app)
    await openFile(page, app, 'b.md', 'start-b')
    await openFile(page, app, 'long.md', 'Line 1')
    await panel.setViewMode('editor')
    await monaco.waitForReady()
    await monaco.focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('PageDown')
    await expect.poll(async () => (await monaco.viewState()).scrollTop).toBeGreaterThan(0)
    const before = await monaco.viewState()
    const text = await monaco.getContent()
    await fresh.countAppearances([TEST_IDS.RELOAD_INDICATOR, TEST_IDS.FILE_CONFLICT_NOTIFICATION])

    // Focus rounds: the view must not move at all
    for (let i = 0; i < ROUNDS; i++) await fresh.signalWindowFocus()
    await expect(panel.modifiedIndicator()).toHaveCount(0)
    expect(await monaco.viewState(), 'N3: a focus check moved the cursor or the scroll').toEqual(before)

    // Show rounds: switching away and back reads nothing new and shows nothing.
    // (The view state is not compared here: tab activation itself restores the
    // scroll, which is not a freshness concern.)
    for (let i = 0; i < ROUNDS; i++) {
      await tabs.activate('b.md')
      await tabs.activate('long.md')
    }
    await expect(panel.modifiedIndicator()).toHaveCount(0)
    expect(await monaco.getContent()).toBe(text)
    expect((await monaco.viewState()).cursorLine, 'N3: the cursor moved').toBe(before.cursorLine)
    expect(await fresh.appearances(TEST_IDS.RELOAD_INDICATOR), 'N3: "Reloaded from disk" for an unchanged file').toBe(0)
    expect(await fresh.appearances(TEST_IDS.FILE_CONFLICT_NOTIFICATION)).toBe(0)
  })

  test('G8: a change made while the PC slept shows within 2 s of the wake, with no focus change', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { fresh } = poms(page, app)
    const viewer = new ImageViewerPage(page, WAKE_BUDGET_MS)
    await viewer.openFromTree('pic.svg')
    await openFile(page, app, 'a.md', 'start-a')
    expect(await fresh.killWatchesSilently(), 'setup: two watches to kill').toBe(2)

    await writeInPlace(join(testProject.path, 'a.md'), doc('during-sleep'))
    await writeInPlace(join(testProject.path, 'pic.svg'), svg('pic-during-sleep'))
    await fresh.simulateResume()
    await fresh.waitForContent('during-sleep', WAKE_BUDGET_MS, 'G8: the change made during sleep was not caught after the wake')
    // The image tab, hidden through the wake, shows the change when brought forward
    await viewer.openFromTree('pic.svg')
    await viewer.waitForMarker('pic-during-sleep')
  })
})

test.describe('#478 one notice per panel (F13)', () => {
  test('a conflict wins over the watch-limit notice in the same panel', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { panel, monaco, fresh } = poms(page, app)
    expect(await fresh.setWatchLimit(1)).toBe(100)
    await openFile(page, app, 'a.md', 'start-a')
    await openFile(page, app, 'b.md', 'start-b')
    await expect(fresh.watchQueuedNotice()).toBeVisible({ timeout: SHOW_BUDGET_MS })

    // b.md waits for a slot; the user types in it and the file changes outside
    await panel.setViewMode('editor')
    await monaco.waitForReady()
    await monaco.focus()
    await monaco.typeWithoutWaiting('typed-b ')
    await writeInPlace(join(testProject.path, 'b.md'), doc('outside-b'))
    await fresh.signalWindowFocus()

    await expect(fresh.conflictNotice()).toBeVisible({ timeout: SHOW_BUDGET_MS })
    await expect(fresh.watchQueuedNotice(), 'F13: two notices in one panel').toHaveCount(0)
    expect(await monaco.getContent()).toContain('typed-b')
  })

  test('a background tab stays silent; its status region speaks once its tab is in front', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { tabs, fresh } = poms(page, app)
    await openFile(page, app, 'a.md', 'start-a')
    await openFile(page, app, 'b.md', 'start-b')

    await rm(join(testProject.path, 'a.md'))
    await expect(fresh.deletedTabMark('a.md')).toBeVisible({ timeout: DELETE_BUDGET_MS })
    // No region speaks while b.md is in front
    await expect(fresh.statusRegions().first()).toBeAttached()
    await expect(fresh.statusRegions().filter({ hasText: /\S/ })).toHaveCount(0)

    await tabs.tab('a.md').click()
    await expect(fresh.statusRegions().filter({ hasText: 'a.md was deleted, renamed or moved on disk.' })).toHaveCount(1)
  })
})

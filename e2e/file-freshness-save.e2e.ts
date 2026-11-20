// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * #478 the editor's own saves against outside writes (plan § 5.3: N1, N2, N4,
 * N6, L1, L3, Ctrl/Cmd+S in a conflict).
 *
 * - **N1** – typing and its autosave: no conflict bar, no "Reloaded from disk",
 *   cursor line and scroll unchanged.
 * - **N2** – an edited tab whose outside change was never delivered (events
 *   muted) gets the conflict bar on window focus and keeps its buffer.
 * - **N4** – ten outside writes against an edited tab: the conflict bar is
 *   inserted once.
 * - **N6** – Dismiss works like Keep my version: autosave writes the local text.
 * - **L1** – an outside write landing while the autosave is in flight: the
 *   autosave is not written ("Not saved"), the outside text stays on disk.
 * - **L3** – save A, save B, an outside tool writes A back: the tab shows A.
 * - **L5** is in `file-freshness-writers.e2e.ts`: a save from an HTML page's
 *   source tab reloads its preview with no conflict. (The plan's SVG variant
 *   cannot be driven: only HTML files offer "Open as source".)
 * - **Ctrl/Cmd+S** in a conflict writes the local text: an explicit save
 *   carries no stamp check (only autosave does – F7).
 *
 * Condition-based waits only.
 */
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { FileFreshnessPage } from './pages/file-freshness.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { writeInPlace } from './utils/freshness-writers'

/** An outside change, or an autosave (2 s debounce plus the write), reaching its end. */
const SHOW_BUDGET_MS = 10_000
const SAVE_KEY = `${process.platform === 'darwin' ? 'Meta' : 'Control'}+KeyS`
/** N1: a document long enough to scroll. */
const LONG_DOC_LINES = 200
/** N4: outside writes against the edited tab. */
const OUTSIDE_WRITES = 10

function doc(marker: string): string {
  return `# Doc\n\n${marker}\n`
}

function longDoc(): string {
  return `# Long\n\n${Array.from({ length: LONG_DOC_LINES }, (_, i) => `Line ${i + 1}`).join('\n')}\n`
}

test.use({
  testProjectFiles: {
    'a.md': doc('start-a'),
    'long.md': longDoc()
  }
})

/** The POMs one test needs. */
function poms(page: Page, app: ElectronApplication) {
  return {
    tree: new ProjectTreePage(page),
    tabs: new TabBarPage(page),
    panel: new EditorPanelPage(page),
    monaco: new MonacoPage(page, new KeyboardHelper(page)),
    fresh: new FileFreshnessPage(page, app)
  }
}

/** Opens `name` in the editor view, focused. */
async function openInEditor(page: Page, app: ElectronApplication, name: string): Promise<void> {
  const { tree, tabs, panel, monaco } = poms(page, app)
  await tree.fileRow(name).click()
  await tabs.waitForTab(name)
  await panel.waitForReady()
  await panel.setViewMode('editor')
  await monaco.waitForReady()
  await monaco.focus()
}

/** Waits until the file on disk contains `text`. */
async function waitForDisk(file: string, text: string, message: string): Promise<void> {
  await expect.poll(async () => readFile(file, 'utf-8'), { timeout: SHOW_BUDGET_MS, message }).toContain(text)
}

/** Types `marker` into the focused editor and raises the conflict with an outside write. */
async function raiseConflict(page: Page, app: ElectronApplication, file: string, typed: string, outside: string): Promise<void> {
  const { monaco, fresh } = poms(page, app)
  await monaco.typeWithoutWaiting(typed)
  await writeInPlace(file, doc(outside))
  await expect(fresh.conflictNotice()).toBeVisible({ timeout: SHOW_BUDGET_MS })
}

test.describe('#478 the editor saves against outside writes', () => {
  test('N1: typing and its autosave raise no conflict and no reload, and keep cursor and scroll', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { panel, monaco, fresh } = poms(page, app)
    const file = join(testProject.path, 'long.md')
    await openInEditor(page, app, 'long.md')
    for (let i = 0; i < 3; i++) await page.keyboard.press('PageDown')
    await expect.poll(async () => (await monaco.viewState()).scrollTop).toBeGreaterThan(0)
    await fresh.countAppearances([TEST_IDS.FILE_CONFLICT_NOTIFICATION, TEST_IDS.RELOAD_INDICATOR])

    await monaco.typeWithoutWaiting('typed-n1 ')
    const typed = await monaco.viewState()
    await waitForDisk(file, 'typed-n1', 'N1: the autosave never wrote')
    await expect(panel.modifiedIndicator()).toHaveCount(0, { timeout: SHOW_BUDGET_MS })

    expect(await monaco.viewState(), 'N1: the save moved the cursor or the scroll').toEqual(typed)
    expect(await fresh.appearances(TEST_IDS.FILE_CONFLICT_NOTIFICATION), 'N1: conflict bar on an own save').toBe(0)
    expect(await fresh.appearances(TEST_IDS.RELOAD_INDICATOR), 'N1: "Reloaded from disk" on an own save').toBe(0)
  })

  test('N2: an undelivered outside change reaches an edited tab on focus as the conflict; the buffer is kept', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { monaco, fresh } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openInEditor(page, app, 'a.md')

    await fresh.muteWatchEvents(true)
    try {
      await monaco.typeWithoutWaiting('typed-n2 ')
      await writeInPlace(file, doc('outside-n2'))
      await fresh.signalWindowFocus()
      await expect(fresh.conflictNotice(), 'N2: no conflict after focus').toBeVisible({ timeout: SHOW_BUDGET_MS })
    } finally {
      await fresh.muteWatchEvents(false)
    }
    expect(await monaco.getContent()).toContain('typed-n2')
    expect(await readFile(file, 'utf-8')).toBe(doc('outside-n2'))
  })

  test('N4: ten outside writes against an edited tab insert the conflict bar once', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { monaco, fresh } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openInEditor(page, app, 'a.md')
    await fresh.countAppearances([TEST_IDS.FILE_CONFLICT_NOTIFICATION])

    await raiseConflict(page, app, file, 'typed-n4 ', 'outside-n4-0')
    for (let i = 1; i < OUTSIDE_WRITES; i++) await writeInPlace(file, doc(`outside-n4-${i}`))
    // The last outside write has been taken in when Reload from disk shows it
    await expect(fresh.conflictNotice()).toBeVisible()
    expect(await fresh.appearances(TEST_IDS.FILE_CONFLICT_NOTIFICATION), 'N4: conflict bar inserted more than once').toBe(1)
    expect(await monaco.getContent()).toContain('typed-n4')
    await poms(page, app).panel.conflictReloadButton().click()
    await expect.poll(() => monaco.getContent(), { timeout: SHOW_BUDGET_MS }).toContain(`outside-n4-${OUTSIDE_WRITES - 1}`)
  })

  test('N6: Dismiss works like Keep my version – autosave writes the local text', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { panel, fresh } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openInEditor(page, app, 'a.md')
    await raiseConflict(page, app, file, 'typed-n6 ', 'outside-n6')

    await panel.conflictDismissButton().click()
    await expect(fresh.conflictNotice()).toHaveCount(0)
    await waitForDisk(file, 'typed-n6', 'N6: Dismiss did not let autosave write the local text')
  })

  test('L1: an outside write during the autosave is kept on disk, and the tab says "Not saved"', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { monaco, fresh } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openInEditor(page, app, 'a.md')

    await fresh.holdNextWrite()
    await monaco.typeWithoutWaiting('typed-l1 ')
    await fresh.waitForHeldWrite()
    await writeInPlace(file, doc('outside-l1'))
    await fresh.releaseWrite()

    await expect(fresh.conflictNotice()).toContainText('Not saved – a.md changed on disk since it was last read.', {
      timeout: SHOW_BUDGET_MS
    })
    expect(await readFile(file, 'utf-8'), 'L1: the autosave overwrote the outside write').toBe(doc('outside-l1'))
    expect(await monaco.getContent()).toContain('typed-l1')
  })

  test('L3: save A, save B, an outside tool writes A back – the tab shows A', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { panel, monaco } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openInEditor(page, app, 'a.md')

    await monaco.setContent(doc('version-a'))
    await waitForDisk(file, 'version-a', 'setup: A saved')
    await expect(panel.modifiedIndicator()).toHaveCount(0, { timeout: SHOW_BUDGET_MS })
    await monaco.setContent(doc('version-b'))
    await waitForDisk(file, 'version-b', 'setup: B saved')
    await expect(panel.modifiedIndicator()).toHaveCount(0, { timeout: SHOW_BUDGET_MS })

    const a = await readFile(file, 'utf-8').then((b) => b.replace('version-b', 'version-a'))
    await writeInPlace(file, a)
    await expect
      .poll(() => monaco.getContent(), { timeout: SHOW_BUDGET_MS, message: 'L3: an outside revert to A taken for an echo' })
      .toContain('version-a')
  })

  test('Ctrl/Cmd+S in a conflict writes the local text', async ({ windowWithTestProject: page, appWithTestProject: app, testProject }) => {
    const file = join(testProject.path, 'a.md')
    await openInEditor(page, app, 'a.md')
    await raiseConflict(page, app, file, 'typed-save ', 'outside-save')

    await page.keyboard.press(SAVE_KEY)
    await waitForDisk(file, 'typed-save', 'an explicit save in a conflict did not write')
  })
})

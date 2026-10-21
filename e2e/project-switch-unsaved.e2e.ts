// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Unsaved editor tabs across a project switch or close.
 *
 * Before: switching projects asked "Discard and switch?" while the 2 s autosave
 * timers kept running, so a timer could fire after the switch had committed and
 * write into the project being left. Now the app first holds every tab's
 * autosave and saves the dirty ones; only a tab that cannot be saved (here: one
 * whose file changed on disk) reaches the prompt, and "Switch Anyway" leaves it
 * unsaved without a late write.
 *
 * The assertions are about bytes on disk and about what the user sees. The
 * absence of a late write cannot be observed without letting time pass, so that
 * one case samples the file's mtime over a window longer than the autosave
 * debounce; everything else waits on conditions.
 *
 * @see src/renderer/src/components/ProjectTree/switchHelpers.ts
 * @see src/renderer/src/services/editorSaveRegistry.ts
 */

import { mkdtemp, readFile, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { E2E_TEMP_DIR, removeDirWithRetry } from './fixtures/isolation'
import { DialogPage } from './pages/dialog.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { MonacoPage } from './pages/monaco.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { byTestId } from './utils/locators'
import { anyToast, toastOfType, toastWithText } from './utils/toast'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

/** The 2 s autosave debounce plus the IPC write, with headroom. */
const AUTOSAVE_BUDGET_MS = 15_000

/** Longer than the 2 s autosave debounce, so a late write would have landed inside it. */
const PROMPT_OPEN_WINDOW_MS = 2_500

/** How long to keep watching after the prompt is accepted and the switch has run. */
const AFTER_SWITCH_WINDOW_MS = 1_500

/** Gap between samples while watching a file for a write that must not come. */
const SAMPLE_INTERVAL_MS = 100

/**
 * The switch must start well inside the autosave debounce, or autosave could
 * explain the saved edit and the test would prove nothing.
 */
const MAX_EDIT_TO_SWITCH_MS = 1_500

const A_BODY = '# A\n\nOriginal body of A.\n'
const EXTERNAL_BODY = '# A\n\nRewritten by another tool.\n'
const EDIT = '\nunsaved edit\n'

test.use({ testProjectFiles: { 'a.md': A_BODY } })

/** Temp projects created by a test, removed after it. */
const extraProjects: string[] = []

test.afterEach(async () => {
  for (const dir of extraProjects.splice(0)) await removeDirWithRetry(dir)
})

/** A second project folder with a single file of the given name. */
async function createProject(fileName: string): Promise<string> {
  const dir = await mkdtemp(join(E2E_TEMP_DIR, 'switch-'))
  extraProjects.push(dir)
  await writeFile(join(dir, fileName), `# ${fileName}\n`, 'utf-8')
  return dir
}

/**
 * Open each project through the app's own IPC so it lands in the recent list,
 * finishing with `current`, and wait for the tree of `current` to show.
 */
async function openAll(page: Page, paths: string[], current: { path: string; file: string }): Promise<void> {
  const tree = new ProjectTreePage(page)
  await page.evaluate(async (list) => {
    const api = (window as unknown as { api: { file: { openProjectByPath(p: string): Promise<string> } } }).api
    for (const p of list) await api.file.openProjectByPath(p)
  }, [...paths, current.path])
  await tree.waitForFile(current.file)
}

/** Open a.md in editor mode and put the cursor in Monaco. */
async function openForEditing(page: Page): Promise<{ monaco: MonacoPage; panel: EditorPanelPage }> {
  const tree = new ProjectTreePage(page)
  const tabs = new TabBarPage(page)
  const panel = new EditorPanelPage(page)
  const monaco = new MonacoPage(page, new KeyboardHelper(page))

  await tree.fileRow('a.md').click()
  await tabs.waitForTab('a.md')
  await panel.waitForReady()
  await panel.setViewMode('editor')
  await monaco.waitForReady()
  await monaco.focus()
  return { monaco, panel }
}

/** Change a.md behind the app's back and wait for the tab to notice. */
async function makeConflict(page: Page, panel: EditorPanelPage, aPath: string): Promise<void> {
  await writeFile(aPath, EXTERNAL_BODY, 'utf-8')
  await expect(panel.conflictNotification()).toBeVisible({ timeout: AUTOSAVE_BUDGET_MS })
}

/** The file's mtime and content, which any write would change. */
async function fingerprint(path: string): Promise<string> {
  return `${(await stat(path)).mtimeMs}:${await readFile(path, 'utf-8')}`
}

/**
 * Fail on the first write to the file for at least `minMs`, and for as long as
 * `until` is pending. Observing that nothing happens takes elapsed time, so the
 * loop is bounded by that window and fails at the first change it sees.
 */
async function expectNoWrite(path: string, baseline: string, minMs: number, until?: Promise<unknown>): Promise<void> {
  let pending = until !== undefined
  const done = (): void => {
    pending = false
  }
  void until?.then(done, done)
  const deadline = Date.now() + minMs
  while (pending || Date.now() < deadline) {
    expect(await fingerprint(path)).toBe(baseline)
    // KNOWN_WAIT: sampling interval of the bounded observation loop above.
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS))
  }
}

test.describe('Project switch with unsaved tabs', () => {
  test('flush: an edit made just before the switch is saved, with no prompt', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)
    const bPath = await createProject('b.md')
    await openAll(page, [bPath], { path: testProject.path, file: 'a.md' })
    const { monaco } = await openForEditing(page)

    const typedAt = Date.now()
    await monaco.typeWithoutWaiting(EDIT)
    await tree.switchToRecent(basename(bPath))
    expect(Date.now() - typedAt).toBeLessThan(MAX_EDIT_TO_SWITCH_MS)

    await tree.waitForFile('b.md')
    await expect(dialog.confirmDialog()).toHaveCount(0)
    expect(await readFile(join(testProject.path, 'a.md'), 'utf-8')).toContain('unsaved edit')
    await expect(toastOfType(page, 'error')).toHaveCount(0)
    await tree.waitForFileGone('a.md')
  })

  test('conflict prompts: names the tab, opens on Cancel, and Cancel keeps the project and re-arms autosave', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)
    const aPath = join(testProject.path, 'a.md')
    const bPath = await createProject('b.md')
    await openAll(page, [bPath], { path: testProject.path, file: 'a.md' })
    const { monaco, panel } = await openForEditing(page)

    await monaco.typeWithoutWaiting(EDIT)
    await makeConflict(page, panel, aPath)
    // A lost race with the 2 s autosave would show here, not as a confusing failure later
    expect(await readFile(aPath, 'utf-8')).toBe(EXTERNAL_BODY)
    const baseline = await fingerprint(aPath)

    await tree.switchToRecent(basename(bPath))
    await dialog.waitForConfirm('Unsaved Changes')
    await expect(dialog.confirmMessage()).toContainText('1 tab could not be saved')
    await expect(dialog.cancelButton()).toBeFocused()

    await dialog.decline()

    // Still project A, tab and edit intact (the recent-project click left the Welcome tab in front)
    await expect(tree.fileRow('a.md')).toBeVisible()
    await expect(tree.fileRow('b.md')).toHaveCount(0)
    await new TabBarPage(page).activate('a.md')
    expect(await monaco.visibleText()).toContain('unsaved edit')
    // The hold is over: the editor takes input again
    await monaco.appendContent('\nmore typing\n')
    // The conflict is still the user's call: autosave does not overwrite the newer file
    await expect(panel.conflictNotification()).toBeVisible()
    await expectNoWrite(aPath, baseline, PROMPT_OPEN_WINDOW_MS)
    // "Keep My Version" resolves it, and autosave (armed again) writes both edits
    await panel.conflictKeepButton().click()
    await expect
      .poll(async () => readFile(aPath, 'utf-8'), { timeout: AUTOSAVE_BUDGET_MS })
      .toContain('more typing')
    expect(await readFile(aPath, 'utf-8')).toContain('unsaved edit')
  })

  test('discard does not write late: the old file is untouched while the prompt is open and after Switch Anyway', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)
    const aPath = join(testProject.path, 'a.md')
    const bPath = await createProject('b.md')
    await openAll(page, [bPath], { path: testProject.path, file: 'a.md' })
    const { monaco, panel } = await openForEditing(page)

    await monaco.typeWithoutWaiting(EDIT)
    await makeConflict(page, panel, aPath)
    expect(await readFile(aPath, 'utf-8')).toBe(EXTERNAL_BODY)
    const baseline = await fingerprint(aPath)

    await tree.switchToRecent(basename(bPath))
    await dialog.waitForConfirm('Unsaved Changes')
    // Past the autosave debounce with the prompt still open: nothing may write
    await expectNoWrite(aPath, baseline, PROMPT_OPEN_WINDOW_MS)

    // Accept, and keep watching until B's tree shows and a little beyond
    const switched = (async () => {
      await dialog.accept()
      await tree.waitForFile('b.md')
    })()
    await expectNoWrite(aPath, baseline, AFTER_SWITCH_WINDOW_MS, switched)
    await switched
    await expect(toastOfType(page, 'error')).toHaveCount(0)
  })

  test('close: Close Project saves the edit and shows the welcome screen', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)
    const dialog = new DialogPage(page)
    const { monaco } = await openForEditing(page)

    const typedAt = Date.now()
    await monaco.typeWithoutWaiting(EDIT)
    await tree.closeProjectButton().click()
    expect(Date.now() - typedAt).toBeLessThan(MAX_EDIT_TO_SWITCH_MS)

    await expect(tree.fileRow('a.md')).toHaveCount(0, { timeout: 10_000 })
    await expect(dialog.confirmDialog()).toHaveCount(0)
    expect(await readFile(join(testProject.path, 'a.md'), 'utf-8')).toContain('unsaved edit')
    await expect(byTestId(page, TEST_IDS.WELCOME_BTN_OPEN)).toContainText('Open project')
    await expect(toastOfType(page, 'error')).toHaveCount(0)
  })

  test('rapid double switch: the second project wins, with one toast and no tree from the first', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)
    const bPath = await createProject('b.md')
    const cPath = await createProject('c.md')
    await openAll(page, [bPath, cPath], { path: testProject.path, file: 'a.md' })
    // Toasts of the setup opens must be gone before counting the ones under test
    await expect(toastWithText(page, 'Project Opened')).toHaveCount(0, { timeout: 30_000 })

    // Both opens start in one renderer turn, before either has answered. While
    // the UI is locked a second click cannot even happen, so this is the
    // overlap the open path itself has to survive.
    const answers = await page.evaluate(
      async ([b, c]) => {
        const api = (window as unknown as { api: { file: { openProjectByPath(p: string): Promise<string> } } }).api
        const first = api.file.openProjectByPath(b)
        const second = api.file.openProjectByPath(c)
        return Promise.all([first, second])
      },
      [bPath, cPath]
    )
    expect(answers).toHaveLength(2)

    await tree.waitForFile('c.md')
    await expect(toastWithText(page, basename(cPath))).toHaveCount(1)
    await expect(toastWithText(page, basename(bPath))).toHaveCount(0)
    await expect(tree.fileRow('b.md')).toHaveCount(0)
    await expect(tree.fileRow('a.md')).toHaveCount(0)
    await expect(anyToast(page).filter({ hasText: 'Failed' })).toHaveCount(0)
  })
})

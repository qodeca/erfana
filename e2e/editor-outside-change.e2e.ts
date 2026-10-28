// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Outside changes to an open buffer – what the uncontrolled editor keeps.
 *
 * The editor owns its buffer; the app writes into it only for an outside
 * change (a file rewritten on disk while the tab is clean, or the conflict
 * bar's "Reload from Disk"). Such a change is applied as one minimal edit, so
 * it has to keep three things the old whole-buffer replacement threw away or
 * got wrong:
 * - the cursor, when the change is elsewhere in the file;
 * - the undo stack, with the outside change as one step of its own;
 * - the tab's clean state – writing the disk's text must not count as the
 *   user editing it.
 *
 * @see src/renderer/src/utils/monacoValueSync.ts
 * @see src/renderer/src/components/Editor/MonacoMarkdownEditor.tsx
 */

import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'

/** Past the watcher's debounce and the IPC round trip. */
const WATCH_BUDGET_MS = 15_000

const NOTES = 'alpha\nbeta\ngamma\n'

test.use({
  testProjectFiles: {
    'notes.md': NOTES
  }
})

interface Opened {
  page: Page
  keyboard: KeyboardHelper
  tabs: TabBarPage
  panel: EditorPanelPage
  monaco: MonacoPage
}

/** Open `notes.md` in editor mode with the cursor at the very start. */
async function openAtStart(page: Page): Promise<Opened> {
  const keyboard = new KeyboardHelper(page)
  const tree = new ProjectTreePage(page)
  const tabs = new TabBarPage(page)
  const panel = new EditorPanelPage(page)
  const monaco = new MonacoPage(page, keyboard)

  await tree.fileRow('notes.md').click()
  await tabs.waitForTab('notes.md')
  await panel.waitForReady()
  await panel.setViewMode('editor')
  await monaco.waitForReady()
  await monaco.focus()
  // Document start: Cmd+Up on macOS (Cmd+Home is unbound there), Ctrl+Home elsewhere
  const modifier = await keyboard.getModifier()
  await page.keyboard.press(modifier === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home')

  return { page, keyboard, tabs, panel, monaco }
}

test.describe('Outside changes to an open buffer', () => {
  test('should keep the cursor and add one undo step when a clean file changes on disk', async ({
    windowWithTestProject,
    testProject
  }) => {
    const { page, keyboard, tabs, monaco } = await openAtStart(windowWithTestProject)
    const target = join(testProject.path, 'notes.md')

    // A saved, clean buffer with the cursor after the first character
    await page.keyboard.type('X')
    await keyboard.save()
    await expect.poll(async () => readFile(target, 'utf-8'), { timeout: WATCH_BUDGET_MS }).toBe(`X${NOTES}`)
    await expect(tabs.dirtyDot('notes.md')).toHaveCount(0, { timeout: WATCH_BUDGET_MS })

    // Another tool appends a line, far from the cursor
    await writeFile(target, `X${NOTES}EXTERNAL\n`, 'utf-8')
    await expect.poll(async () => monaco.visibleText(), { timeout: WATCH_BUDGET_MS }).toContain('EXTERNAL')
    // Taking the disk's text is not an edit by the user
    await expect(tabs.dirtyDot('notes.md')).toHaveCount(0)

    // The cursor stayed after the X. A whole-buffer replacement moved it to the
    // end of the file, so this key landed after EXTERNAL.
    await page.keyboard.type('Y')
    await keyboard.save()
    await expect
      .poll(async () => readFile(target, 'utf-8'), { timeout: WATCH_BUDGET_MS })
      .toBe(`XY${NOTES}EXTERNAL\n`)

    // Undo: first the Y, then the outside change as a step of its own
    await keyboard.undo()
    await expect.poll(async () => monaco.visibleText(), { timeout: WATCH_BUDGET_MS }).not.toContain('XY')
    expect(await monaco.visibleText()).toContain('EXTERNAL')
    await keyboard.undo()
    await expect.poll(async () => monaco.visibleText(), { timeout: WATCH_BUDGET_MS }).not.toContain('EXTERNAL')
    expect(await monaco.visibleText()).toContain('Xalpha')
  })

  test('should replace the buffer on Reload from Disk, with the local edit one undo away', async ({
    windowWithTestProject,
    testProject
  }) => {
    const { page, keyboard, tabs, panel, monaco } = await openAtStart(windowWithTestProject)
    const target = join(testProject.path, 'notes.md')

    await page.keyboard.type('LOCAL ')
    await expect(tabs.dirtyDot('notes.md')).toBeVisible({ timeout: WATCH_BUDGET_MS })
    await writeFile(target, 'rewritten by another tool\n', 'utf-8')

    await expect(panel.conflictNotification()).toBeVisible({ timeout: WATCH_BUDGET_MS })
    await panel.conflictReloadButton().click()
    await expect(panel.conflictNotification()).toHaveCount(0, { timeout: WATCH_BUDGET_MS })
    await expect
      .poll(async () => monaco.visibleText(), { timeout: WATCH_BUDGET_MS })
      .toContain('rewritten by another tool')
    expect(await monaco.visibleText()).not.toContain('LOCAL')
    // The buffer equals the disk again, so the unsaved dot must go (it used to
    // stay on after a Reload)
    await expect(tabs.dirtyDot('notes.md')).toHaveCount(0)

    // The discarded edit is still in the undo history, as in any editor's revert
    await monaco.focus()
    await keyboard.undo()
    await expect.poll(async () => monaco.visibleText(), { timeout: WATCH_BUDGET_MS }).toContain('LOCAL')
    await expect(tabs.dirtyDot('notes.md')).toBeVisible({ timeout: WATCH_BUDGET_MS })
    // …and undoing the reload is a user edit like any other: it reaches disk
    await expect
      .poll(async () => readFile(target, 'utf-8'), { timeout: WATCH_BUDGET_MS })
      .toContain('LOCAL')
  })
})

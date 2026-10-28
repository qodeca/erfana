// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Typing while the app is busy – no keystroke may be dropped.
 *
 * The editor used to be "controlled": every React commit pushed the document
 * back into Monaco, and `@monaco-editor/react` replaced the whole buffer
 * whenever that pushed value differed from what Monaco held. With the main
 * thread busy, a keystroke could land between React's commit and that
 * replacement, so the replacement restored the older text – the character
 * vanished and the cursor jumped to the end of the file. A 3,000-line
 * benchmark lost about half of 50 typed keys.
 *
 * This spec recreates the condition on purpose: a large file, a renderer made
 * slow while React commits (see {@link startBusy}), and a burst typed one key
 * at a time (`keyboard.type`, not `insertText`, because one input event per
 * key is what opens the gap). On the controlled editor it lost most of the
 * burst on every run. The burst goes at the top of the file, so a cursor that
 * jumps to the end also shows up as wrong bytes. The assertion is on the file
 * written to disk, the user's real artefact.
 *
 * @see src/renderer/src/components/Editor/MonacoMarkdownEditor.tsx
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'

/** Line count of the benchmark that first measured the loss. */
const LINE_COUNT = 3_000

const LARGE_FILE = Array.from(
  { length: LINE_COUNT },
  (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog.`
).join('\n') + '\n'

/** Letters and spaces only, so no key is a shortcut or an auto-close trigger. */
const BURST = 'typed while busy and every key must survive this burst '

/**
 * Length of each busy slice. Long enough that keystrokes queue up behind it,
 * short enough that the app still answers between slices.
 */
const BUSY_SLICE_MS = 15

/** A manual save plus the IPC write, well inside the 2 s autosave debounce. */
const SAVE_BUDGET_MS = 10_000

test.use({
  testProjectFiles: {
    'large.md': LARGE_FILE
  }
})

/**
 * Make the renderer slow while it commits a React update, until
 * {@link stopBusy}: every DOM text update (React writes them with the
 * `nodeValue` setter, e.g. the stats bar's character count after each key)
 * first spins for {@link BUSY_SLICE_MS}. This is the shape of a heavy render –
 * the commit runs long, React's scheduler yields before running effects, and
 * the next queued keystroke is handled in between.
 */
async function startBusy(page: Page): Promise<void> {
  await page.evaluate((sliceMs) => {
    const w = window as unknown as { __erfanaE2eBusy?: boolean; __erfanaE2eBusyInstalled?: boolean }
    w.__erfanaE2eBusy = true
    if (w.__erfanaE2eBusyInstalled) return
    w.__erfanaE2eBusyInstalled = true
    const native = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeValue')!
    Object.defineProperty(Node.prototype, 'nodeValue', {
      ...native,
      set(this: Node, next: string | null) {
        if (w.__erfanaE2eBusy) {
          const until = performance.now() + sliceMs
          while (performance.now() < until) {
            // Busy on purpose: this is the load the editor must withstand.
          }
        }
        native.set!.call(this, next)
      }
    })
  }, BUSY_SLICE_MS)
}

async function stopBusy(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __erfanaE2eBusy?: boolean }).__erfanaE2eBusy = false
  })
}

test.describe('Typing while the app is busy', () => {
  test('should keep every typed key in a large file', async ({
    windowWithTestProject,
    testProject
  }) => {
    const page = windowWithTestProject
    const keyboard = new KeyboardHelper(page)
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const panel = new EditorPanelPage(page)
    const monaco = new MonacoPage(page, keyboard)

    await tree.fileRow('large.md').click()
    await tabs.waitForTab('large.md')
    await panel.waitForReady()
    await panel.setViewMode('editor')
    await monaco.waitForReady()
    await monaco.focus()
    // Document start: Cmd+Up on macOS (Cmd+Home is unbound there), Ctrl+Home elsewhere
    const modifier = await keyboard.getModifier()
    await page.keyboard.press(modifier === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home')

    await startBusy(page)
    try {
      await page.keyboard.type(BURST)
    } finally {
      await stopBusy(page)
    }

    await keyboard.save()

    const target = join(testProject.path, 'large.md')
    await expect
      .poll(async () => readFile(target, 'utf-8'), { timeout: SAVE_BUDGET_MS })
      .not.toBe(LARGE_FILE)
    // Compare only the head: a 180 KB diff in a failure message helps no one,
    // and a dropped key or a jumped cursor both change the head.
    const saved = await readFile(target, 'utf-8')
    const expected = BURST + LARGE_FILE
    expect(saved.slice(0, BURST.length + 40)).toBe(expected.slice(0, BURST.length + 40))
    expect(saved.length).toBe(expected.length)
    expect(saved === expected, 'the saved file differs from the file plus the typed burst').toBe(true)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown preview renders behind the editor (finding [31]): deferred, and
 * for a large document debounced until typing pauses. These checks pin the
 * part a user would notice if the scheduling went wrong – the preview must
 * still arrive at exactly what was typed once typing stops, with anchors,
 * link styling, front matter and diagrams intact.
 *
 * Condition-based waits only: every wait is a polled assertion.
 *
 * @see src/renderer/src/components/Editor/MarkdownPreview.tsx
 * @see docs/performance/2026-10-21-deferred-preview.md
 */

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { buildPreviewBenchDocument, PREVIEW_BENCH_OTHER } from './fixtures/previewBenchDocument'
import { EditorPanelPage } from './pages/editor-panel.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { MonacoPage } from './pages/monaco.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'

const LARGE = 'large.md'
const SMALL = 'small.md'

test.use({
  testProjectFiles: {
    // ~3,000 lines: slow enough to re-render that the preview debounces.
    [LARGE]: buildPreviewBenchDocument(3000),
    [SMALL]: '# Small\n\nShort note.\n',
    'other.md': PREVIEW_BENCH_OTHER
  }
})

/** Open a file in split view with Monaco ready and the cursor after `anchorText`. */
async function openAtEndOf(
  page: Page,
  fileName: string,
  anchorText: string
): Promise<{ panel: EditorPanelPage; monaco: MonacoPage }> {
  const panel = new EditorPanelPage(page)
  const monaco = new MonacoPage(page, new KeyboardHelper(page))
  await new ProjectTreePage(page).fileRow(fileName).click()
  await new TabBarPage(page).waitForTab(fileName)
  await panel.waitForReady()
  await panel.setViewMode('split')
  await monaco.waitForReady()
  await monaco.getEditor().locator('.view-line', { hasText: anchorText }).click()
  await page.keyboard.press('End')
  return { panel, monaco }
}

/**
 * Insert `chunks` back to back, one input event each, without waiting between
 * them – the way a fast typist's keys arrive while the preview is busy.
 *
 * This used to be paced (each chunk confirmed before the next) because a
 * burst tripped the controlled editor's race: `@monaco-editor/react`
 * re-applied an older `value` over the buffer, dropping edits. The editor is
 * uncontrolled now, so the burst must survive as typed – the assertions after
 * each call check every word arrived, in order.
 */
async function typeBurst(monaco: MonacoPage, chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    await monaco.typeWithoutWaiting(chunk)
  }
}

test.describe('Deferred Markdown preview', () => {
  test('a large document catches up with a burst of edits once typing stops', async ({
    windowWithTestProject: page
  }) => {
    const { panel, monaco } = await openAtEndOf(page, LARGE, 'Typing anchor paragraph.')
    const preview = panel.previewPane()
    await expect(preview.locator('.mermaid-diagram svg').first()).toBeVisible({ timeout: 30_000 })

    // Twenty separate edits in quick succession – each its own input event,
    // so the preview sees a stream of changes, not one paste.
    const words = Array.from({ length: 20 }, (_, i) => ` w${i}`)
    await typeBurst(monaco, words)

    // Once typing stops the preview shows every edit, in order.
    await expect(preview).toContainText(`Typing anchor paragraph.${words.join('')}`, { timeout: 15_000 })

    // What the deferred render must not have broken:
    // – front matter still renders as its table,
    await expect(preview.locator('table.frontmatter-table')).toBeVisible()
    // – heading anchors keep their ids across the re-renders,
    await expect(preview.locator('h2#section-1-component-notes')).toHaveCount(1)
    await expect(preview.locator('[id="section-1-component-notes-2"]')).toHaveCount(0)
    // – link checks still style existing and missing targets,
    await expect(preview.locator('a.internal-link[href="./other.md"]').first()).toBeVisible()
    await expect(preview.locator('a.broken-link[href="./missing-1.md"]')).toHaveCount(1)
    // – and the diagrams are still drawn.
    await expect(preview.locator('.mermaid-diagram svg').first()).toBeVisible()
  })

  test('scroll sync follows the remounted preview after split -> split-horizontal and typing', async ({
    windowWithTestProject: page
  }) => {
    const { panel, monaco } = await openAtEndOf(page, LARGE, 'Typing anchor paragraph.')
    // The preview is keyed by view mode: this switch replaces its DOM.
    await panel.setViewMode('split-horizontal')
    await monaco.waitForReady()
    await monaco.getEditor().locator('.view-line', { hasText: 'Typing anchor paragraph.' }).click()
    await page.keyboard.press('End')
    await typeBurst(monaco, [' after', ' the', ' switch'])

    const preview = panel.previewPane()
    await expect(preview).toContainText('Typing anchor paragraph. after the switch', { timeout: 15_000 })

    // Jumping the editor to the end must carry the (new) preview to its end:
    // the scroll map was built from the remounted preview, and kept current
    // after the typing above.
    // Monaco's "cursor to end of document": Cmd+Down on macOS, Ctrl+End elsewhere.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await expect
      .poll(
        () =>
          preview.evaluate((el) => (el.scrollTop + el.clientHeight) / el.scrollHeight),
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0.9)
  })

  test('a small document updates as it is typed', async ({ windowWithTestProject: page }) => {
    const { panel, monaco } = await openAtEndOf(page, SMALL, 'Short note.')

    await monaco.typeWithoutWaiting(' Added live.')

    await expect(panel.previewPane()).toContainText('Short note. Added live.', { timeout: 5_000 })
  })
})

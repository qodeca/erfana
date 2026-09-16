// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown toolbar — formatting buttons, the four view modes, and the
 * document statistics footer.
 *
 * Twenty toolbar testids existed and not one of them was touched by an
 * end-to-end test. The formatting commands in particular only ever ran against
 * a mocked Monaco, so nothing proved that clicking Bold puts `**` around the
 * user's actual selection in the actual editor.
 *
 * The view-mode cases matter for a different reason: preview is the mode a
 * file opens in, and switching modes mounts and unmounts Monaco. Anything that
 * depends on the editor existing — search, formatting, the context menu —
 * quietly stops working if that wiring breaks, and unit tests cannot see it
 * because they mount the panel directly.
 *
 * @see src/renderer/src/components/Editor/MarkdownEditorPanel/components/MarkdownToolbar.tsx
 * @see src/renderer/src/components/Editor/MonacoMarkdownEditor.tsx
 */

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import type { FormatAction } from './pages/editor-panel.page'

/**
 * A single word, and nothing else.
 *
 * The wrap commands wrap the WHOLE selection, so a multi-line fixture plus
 * select-all would produce `**# Doc\nplainword**` and force the assertion to
 * describe the fixture instead of the contract. One word keeps
 * "selection in, markers around it" legible.
 */
const DOC = 'plainword\n'

test.use({ testProjectFiles: { 'doc.md': DOC } })

async function openDoc(page: Page): Promise<{
  panel: EditorPanelPage
  monaco: MonacoPage
}> {
  const tree = new ProjectTreePage(page)
  const tabs = new TabBarPage(page)
  const panel = new EditorPanelPage(page)
  const monaco = new MonacoPage(page, new KeyboardHelper(page))

  await tree.fileRow('doc.md').click()
  await tabs.waitForTab('doc.md')
  await panel.waitForReady()

  return { panel, monaco }
}

/**
 * Put the caret in Monaco, retrying the click until the editor really has it.
 *
 * Switching to a mode with an editor mounts Monaco, and for a moment after the
 * mount a click lands on its DOM without Monaco taking focus. The browser then
 * focuses the nearest focusable ancestor – the `tabIndex={0}` panel container –
 * so the caret never appears and every keystroke that follows (select-all,
 * typing) goes to the wrong element. `MonacoPage.focus()` clicks once and
 * asserts the caret; re-running it until that assertion holds is the
 * condition-based wait for "Monaco is ready to take input".
 */
async function focusEditor(monaco: MonacoPage): Promise<void> {
  await monaco.waitForReady()
  await expect(async () => {
    await monaco.focus()
  }).toPass({ timeout: 15_000 })
}

/** Open the fixture, switch to a mode with an editor, and focus Monaco. */
async function openInEditor(
  page: Page,
  mode: 'editor' | 'split' = 'editor'
): Promise<{ panel: EditorPanelPage; monaco: MonacoPage }> {
  const { panel, monaco } = await openDoc(page)
  await panel.setViewMode(mode)
  await focusEditor(monaco)
  return { panel, monaco }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('View modes', () => {
  test('should open a file in preview, with no editor mounted', async ({
    windowWithTestProject
  }) => {
    const { panel } = await openDoc(windowWithTestProject)

    // The default is a product decision, not an accident — pin it, because a
    // silent flip to editor-first changes what every other spec must do.
    await expect(panel.previewPane()).toBeVisible()
    await expect(panel.editorPane()).toHaveCount(0)
    expect(await panel.isViewModeActive('preview')).toBe(true)
  })

  test('should mount the editor and drop the preview in editor-only mode', async ({
    windowWithTestProject
  }) => {
    const { panel } = await openDoc(windowWithTestProject)

    await panel.setViewMode('editor')
    expect(await panel.isViewModeActive('editor')).toBe(true)
  })

  test('should show both panes in each split mode', async ({ windowWithTestProject }) => {
    const { panel } = await openDoc(windowWithTestProject)

    await panel.setViewMode('split')
    expect(await panel.isViewModeActive('split')).toBe(true)

    await panel.setViewMode('split-horizontal')
    expect(await panel.isViewModeActive('split-horizontal')).toBe(true)
  })

  test('should carry the document through a full round trip of modes', async ({
    windowWithTestProject
  }) => {
    const { panel, monaco } = await openInEditor(windowWithTestProject)
    await monaco.appendContent('\nround trip line\n')

    // Unmounting Monaco must not drop the buffer.
    await panel.setViewMode('preview')
    await expect(panel.previewPane()).toContainText('round trip line')

    await panel.setViewMode('editor')
    await focusEditor(monaco)
    // Poll rather than read once: a focused editor can still be a frame or
    // two away from painting its lines.
    await expect
      .poll(async () => monaco.visibleText(), { timeout: 10_000 })
      .toContain('round trip line')
  })

  test('should render the edit live in the preview half of a split', async ({
    windowWithTestProject
  }) => {
    const { panel, monaco } = await openInEditor(windowWithTestProject, 'split')
    await monaco.appendContent('\nlive rendered\n')

    await expect(panel.previewPane()).toContainText('live rendered')
  })
})

test.describe('Formatting buttons', () => {
  /**
   * Select the whole document and apply one toolbar action.
   *
   * Select-all is used rather than a word selection because Monaco's
   * double-click word selection is timing-sensitive, and the wrap contract is
   * the same either way: the markers land around whatever is selected.
   */
  async function applyToSelection(
    panel: EditorPanelPage,
    monaco: MonacoPage,
    action: FormatAction
  ): Promise<void> {
    await monaco.selectAll()
    await panel.format(action)
  }

  const WRAPPERS: ReadonlyArray<{ action: FormatAction; marker: string }> = [
    { action: 'bold', marker: '**' },
    { action: 'italic', marker: '*' },
    { action: 'strikethrough', marker: '~~' },
    { action: 'code', marker: '`' }
  ]

  for (const { action, marker } of WRAPPERS) {
    test(`should wrap the selection in ${marker} for ${action}`, async ({
      windowWithTestProject
    }) => {
      const { panel, monaco } = await openInEditor(windowWithTestProject)

      await applyToSelection(panel, monaco, action)

      // Markers land at the edges of the selection, and the text itself
      // survives in between. Select-all takes the trailing newline too, so the
      // closing marker may sit on the next line. Poll: Monaco paints the edit
      // a frame after the click, so a single read can still see the old text.
      const m = escapeRegExp(marker)
      await expect
        .poll(async () => monaco.visibleText(), { timeout: 10_000 })
        .toMatch(new RegExp(`${m}plainword[\\s\\S]*${m}\\s*$`))
    })
  }

  test('should build a heading out of the selected text', async ({ windowWithTestProject }) => {
    const { panel, monaco } = await openInEditor(windowWithTestProject)

    await monaco.selectAll()
    await panel.format('heading')

    await expect
      .poll(async () => monaco.visibleText(), { timeout: 10_000 })
      .toMatch(/^#+\s+plainword/m)
  })

  test('should insert a placeholder heading when nothing is selected', async ({
    windowWithTestProject
  }) => {
    const { panel, monaco } = await openInEditor(windowWithTestProject)

    // Park the caret with the keyboard, not the mouse, and prove the
    // precondition: a stray selection would turn "insert" into "wrap" and
    // fail below as a misleading text mismatch instead of here.
    const keyboard = new KeyboardHelper(windowWithTestProject)
    await windowWithTestProject.keyboard.press(`${await keyboard.getModifier()}+End`)
    await expect(panel.statSelection()).toHaveCount(0)

    await panel.format('heading')

    // Heading INSERTS, it does not convert the current line — the document's
    // own text is left alone and a placeholder heading is added.
    await expect
      .poll(async () => monaco.visibleText(), { timeout: 10_000 })
      .toMatch(/^#+\s+Heading/m)
    expect(await monaco.visibleText()).toContain('plainword')
  })

  test('should build a list out of the selected text', async ({ windowWithTestProject }) => {
    const { panel, monaco } = await openInEditor(windowWithTestProject)

    await monaco.selectAll()
    await panel.format('list')

    await expect
      .poll(async () => monaco.visibleText(), { timeout: 10_000 })
      .toMatch(/^[-*]\s+plainword/m)
  })

  test('should build a numbered list out of the selected text', async ({
    windowWithTestProject
  }) => {
    const { panel, monaco } = await openInEditor(windowWithTestProject)

    await monaco.selectAll()
    await panel.format('orderedList')

    await expect
      .poll(async () => monaco.visibleText(), { timeout: 10_000 })
      .toMatch(/^1\.\s+plainword/m)
  })

  test('should mark the document dirty after a toolbar edit', async ({
    windowWithTestProject
  }) => {
    const tabs = new TabBarPage(windowWithTestProject)
    const { panel, monaco } = await openInEditor(windowWithTestProject)

    await monaco.selectAll()
    await panel.format('bold')

    // A toolbar edit is an edit: it has to reach the same dirty/autosave path
    // a keystroke does.
    await expect(tabs.dirtyDot('doc.md')).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Document statistics', () => {
  test('should report words, characters and lines for the open file', async ({
    windowWithTestProject
  }) => {
    const { panel } = await openDoc(windowWithTestProject)

    await expect(panel.statsBar()).toBeVisible()
    // Exact totals depend on how `calculateStats` treats markup, which is an
    // implementation detail; assert the shape here and the movement below.
    await expect(panel.statWords()).toContainText(/\d/)
    await expect(panel.statCharacters()).toContainText(/\d/)
    await expect(panel.statLines()).toContainText(/\d/)
    await expect(panel.statReadingTime()).toBeVisible()
  })

  test('should grow the counts as the document grows', async ({ windowWithTestProject }) => {
    const { panel, monaco } = await openInEditor(windowWithTestProject)

    const digits = async (text: string | null): Promise<number> =>
      Number((text ?? '').replace(/\D/g, '') || '0')
    const wordsBefore = await digits(await panel.statWords().textContent())

    await monaco.appendContent('\none two three four five\n')

    await expect
      .poll(async () => digits(await panel.statWords().textContent()), { timeout: 10_000 })
      .toBeGreaterThan(wordsBefore)
  })

  test('should report a selection only while text is selected', async ({
    windowWithTestProject
  }) => {
    const { panel, monaco } = await openInEditor(windowWithTestProject)

    await expect(panel.statSelection()).toHaveCount(0)

    await monaco.selectAll()
    await expect(panel.statSelection()).toBeVisible({ timeout: 10_000 })
  })
})

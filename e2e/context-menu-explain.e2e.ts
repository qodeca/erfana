// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E Tests for Context Menu – Explain prompt flow
 *
 * Validates the Explain prompt works end-to-end in both preview and editor
 * contexts: right-click → context menu → click Explain → terminal opens.
 *
 * Uses manual launch pattern (not composed fixtures) because
 * appWithTestProject/withOpenFile are fixme'd (fixture-smoke.e2e.ts:97-121).
 *
 * @see docs/prompts/README.md - Prompt template system
 * @see src/renderer/src/components/ContextMenu/ - Context menu components
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'path'
import {
  TEST_IDS,
  byTestId,
  waitForTestId,
  waitForAppReady,
  openProject,
  clickFileByName,
  keyboard,
  monaco,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'

const testSeed = {
  'test.md':
    '# Test Document\n\nThis is a paragraph that explains an important concept in detail.\n\nAnother paragraph with more details about the topic.\n'
}

/**
 * Atomically select the first paragraph inside a preview pane AND fire the
 * contextmenu event on it, in a single page.evaluate. This is the actual
 * user gesture being modeled: drag across text, then right-click on the
 * selection — the selection survives the right-mousedown.
 *
 * Why one atomic step. Doing select-then-dispatch as two separate Playwright
 * calls leaves an async gap during which React re-renders / focus changes
 * can clear `window.getSelection()`. MarkdownPreview's handler at
 * handleContextMenu reads `window.getSelection()` directly and returns
 * early when the selection is empty, so any gap that loses the selection
 * silently kills the menu render and the test times out waiting for it.
 *
 * Why dispatchEvent and not click({button:'right'}). Playwright's synthetic
 * right-click emits a mousedown that clears the selection BEFORE the
 * contextmenu event fires. dispatchEvent('contextmenu') bypasses the
 * mousedown step entirely; React's synthetic-event system at the root
 * still catches the bubbled native event and runs onContextMenu.
 *
 * For the "no-selection right-click does NOT open the menu" path, keep a
 * real `paragraph.click({button:'right'})` — that exercises the actual
 * user gesture where there is nothing selected.
 */
async function selectAndOpenPreviewContextMenu(
  page: Awaited<ReturnType<typeof electron.firstWindow>>,
  previewTestId: string
): Promise<void> {
  await page.evaluate((tid) => {
    const p = document.querySelector(`[data-testid="${tid}"] .markdown-preview-content p`)
    if (!p) throw new Error('Paragraph not found in preview')
    // Establish selection.
    const range = document.createRange()
    range.selectNodeContents(p)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    // Fire contextmenu atomically (no async gap that could clear selection).
    const rect = p.getBoundingClientRect()
    p.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + 50,
      clientY: rect.top + 10
    }))
  }, previewTestId)
}

test.describe('Context Menu – Explain prompt', () => {
  test('Preview: right-click with selection shows menu, Explain dispatches to terminal', async () => {
    test.setTimeout(90_000)

    const { projectPath, cleanup: cleanupProject } = await createTestProject(testSeed)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'ctx-menu-preview'
    )

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    try {
      window = await electronApp.firstWindow()
      await waitForAppReady(window)

      await openProject(window, projectPath)
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Open test.md – defaults to preview-only mode
      await clickFileByName(window, 'test.md')

      const previewPane = byTestId(window, TEST_IDS.EDITOR_PREVIEW)
      await expect(previewPane).toBeVisible({ timeout: 5000 })

      // Wait for markdown content to render
      const paragraph = previewPane.locator('.markdown-preview-content p').first()
      await expect(paragraph).toBeVisible({ timeout: 5000 })

      // ── Step 1: Right-click WITHOUT selection – menu should NOT appear ──
      // The preview context menu only shows when window.getSelection() is non-empty
      await paragraph.click({ button: 'right' })
      const previewMenu = byTestId(window, TEST_IDS.CONTEXT_MENU_PREVIEW)
      await expect(previewMenu).not.toBeVisible({ timeout: 1000 })

      // ── Step 2+3: Select text and open context menu (atomic) ──
      await selectAndOpenPreviewContextMenu(window, TEST_IDS.EDITOR_PREVIEW)
      await expect(previewMenu).toBeVisible({ timeout: 3000 })

      // ── Step 4: Verify prompt items are present ──
      const explainItem = byTestId(window, TEST_IDS.CONTEXT_MENU_ITEM_EXPLAIN)
      await expect(explainItem).toBeVisible()
      await expect(explainItem).toContainText('Explain')

      // Other prompt items should also be present
      await expect(byTestId(window, TEST_IDS.CONTEXT_MENU_ITEM_MODIFY)).toBeVisible()
      await expect(byTestId(window, TEST_IDS.CONTEXT_MENU_ITEM_ASK)).toBeVisible()
      await expect(byTestId(window, TEST_IDS.CONTEXT_MENU_ITEM_VISUALIZE)).toBeVisible()

      // ── Step 5: Dismiss with Escape ──
      await window.keyboard.press('Escape')
      await expect(previewMenu).not.toBeVisible({ timeout: 1000 })

      // ── Step 6: Click-outside dismissal (separate code path from Escape) ──
      await selectAndOpenPreviewContextMenu(window, TEST_IDS.EDITOR_PREVIEW)
      await expect(previewMenu).toBeVisible({ timeout: 3000 })
      await previewPane.click({ position: { x: 5, y: 5 } })
      await expect(previewMenu).not.toBeVisible({ timeout: 1000 })

      // ── Step 7: Re-select, right-click, click Explain ──
      await selectAndOpenPreviewContextMenu(window, TEST_IDS.EDITOR_PREVIEW)
      await expect(previewMenu).toBeVisible({ timeout: 3000 })

      // Click "Explain"
      await byTestId(window, TEST_IDS.CONTEXT_MENU_ITEM_EXPLAIN).click()

      // ── Step 8: Menu closes ──
      await expect(previewMenu).not.toBeVisible({ timeout: 2000 })

      // ── Step 9: Terminal opens (prompt was dispatched) ──
      // Explain has autoExecute: true, so clicking it sends the prompt to terminal
      const terminalInstance = byTestId(window, TEST_IDS.TERMINAL_INSTANCE)
      await expect(terminalInstance).toBeVisible({ timeout: 15000 })
    } finally {
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })

  test('Editor: right-click shows menu with disabled Explain when no selection, enabled after select', async () => {
    test.setTimeout(90_000)

    const { projectPath, cleanup: cleanupProject } = await createTestProject(testSeed)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'ctx-menu-editor'
    )

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    try {
      window = await electronApp.firstWindow()
      await waitForAppReady(window)

      await openProject(window, projectPath)
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Open test.md and switch to split view to get Monaco editor
      await clickFileByName(window, 'test.md')

      const splitViewBtn = byTestId(window, TEST_IDS.VIEW_MODE_BTN_SPLIT)
      await expect(splitViewBtn).toBeVisible({ timeout: 5000 })
      await splitViewBtn.click()

      await monaco.waitForReady(window)

      // ── Step 1: Right-click without selection – menu shows, Explain disabled ──
      // Focus editor first, then right-click on the editing surface
      await monaco.focus(window)
      const viewLines = monaco.getEditor(window).locator('.view-lines')
      await viewLines.click({ button: 'right' })

      const editorMenu = byTestId(window, TEST_IDS.CONTEXT_MENU_EDITOR)
      await expect(editorMenu).toBeVisible({ timeout: 3000 })

      // Explain should be present but disabled (aria-disabled)
      const explainItem = byTestId(window, TEST_IDS.CONTEXT_MENU_ITEM_EXPLAIN)
      await expect(explainItem).toBeVisible()
      await expect(explainItem).toHaveAttribute('aria-disabled', 'true')

      // Clicking a disabled item should be a no-op – menu stays open
      await explainItem.click({ force: true })
      await expect(editorMenu).toBeVisible()

      // ── Step 2: Dismiss menu ──
      await window.keyboard.press('Escape')
      await expect(editorMenu).not.toBeVisible({ timeout: 1000 })

      // ── Step 3: Select all text ──
      await monaco.focus(window)
      await keyboard.selectAll(window)

      // ── Step 4: Right-click with selection – menu shows, Explain enabled ──
      await viewLines.click({ button: 'right' })
      await expect(editorMenu).toBeVisible({ timeout: 3000 })

      const explainItemEnabled = byTestId(window, TEST_IDS.CONTEXT_MENU_ITEM_EXPLAIN)
      await expect(explainItemEnabled).toBeVisible()
      await expect(explainItemEnabled).not.toHaveAttribute('aria-disabled')

      // ── Step 5: Click Explain ──
      await explainItemEnabled.click()

      // ── Step 6: Menu closes + terminal opens ──
      await expect(editorMenu).not.toBeVisible({ timeout: 2000 })
      const terminalInstance = byTestId(window, TEST_IDS.TERMINAL_INSTANCE)
      await expect(terminalInstance).toBeVisible({ timeout: 15000 })
    } finally {
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})

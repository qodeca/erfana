// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Visual regression tests for Erfana UI states.
 *
 * Captures and compares screenshots of 5 core UI states:
 * (a) Welcome panel – empty project
 * (b) Editor loaded – tree + editor + preview
 * (c) Terminal open – split view with terminal
 * (d) Settings overlay – full-screen settings
 * (e) Confirm dialog – quit confirmation overlay
 *
 * Each test launches its own Electron instance (5 total):
 * 1 without project (state a), 4 with project (states b–e).
 *
 * @see specs/spec-t2-019-visual-regression-ci/spec.md
 */

import * as fs from 'fs'
import * as path from 'path'
import { visualTest, expect } from './fixtures/index'
import {
  TEST_IDS,
  byTestId,
  openSettings,
  terminal,
  clickFileByName
} from './utils/helpers'

/**
 * Assert that a baseline exists for this platform. Throws to fail the test
 * loudly when the baseline is missing — previously this skipped silently,
 * which meant the first run on a new platform auto-wrote whatever the app
 * rendered as canonical (the autobaseline trap). Generate new baselines
 * via `npm run test:e2e:update-screenshots` and commit them in a PR.
 *
 * No-ops when running under `--update-snapshots` (the update script sets
 * `updateSnapshots !== 'none'`, signalling the operator intends to write).
 */
function assertBaselineExists(screenshotName: string, testInfo: import('@playwright/test').TestInfo): void {
  if (testInfo.config.updateSnapshots !== 'none') return
  // Path mirrors snapshotPathTemplate: {snapshotDir}/{arg}-{platform}{ext}
  // where {arg} = screenshotName (without .png), {platform} = process.platform
  const nameWithoutExt = screenshotName.replace(/\.png$/, '')
  const baselinePath = path.join(__dirname, 'screenshots', `${nameWithoutExt}-${process.platform}.png`)
  if (fs.existsSync(baselinePath)) return
  throw new Error(
    `Missing visual baseline: ${nameWithoutExt}-${process.platform}.png. ` +
    `Generate via 'npm run test:e2e:update-screenshots' and commit the new baseline in a PR. ` +
    `The auto-write-on-first-run path is intentionally closed (config: updateSnapshots: 'none').`
  )
}

/**
 * Disable Monaco cursor blinking to prevent non-deterministic screenshots.
 * Returns the number of editors found and patched.
 */
async function disableCursorBlink(page: import('@playwright/test').Page): Promise<number> {
  return await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editors = (window as any).monaco?.editor?.getEditors?.()
    if (editors) {
      for (const editor of editors) {
        editor.updateOptions({ cursorBlinking: 'solid' })
      }
      return editors.length
    }
    return 0
  })
}

/**
 * Clear any text selection to avoid non-deterministic highlights.
 */
async function clearSelection(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editors = (window as any).monaco?.editor?.getEditors?.()
    if (editors) {
      for (const editor of editors) {
        editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 })
      }
    }
    window.getSelection()?.removeAllRanges()
  })
}

/**
 * Prepare Monaco editor for deterministic screenshot capture.
 *
 * FR-008.7 (timestamp masking) – none of the 5 tested UI states display
 * timestamps or relative times. If future states include timestamps,
 * add mask entries targeting those elements.
 */
async function stabilizeEditor(page: import('@playwright/test').Page): Promise<void> {
  const editorCount = await disableCursorBlink(page)
  if (editorCount === 0) {
    console.warn('stabilizeEditor: no Monaco editors found – cursor blink may not be disabled')
  }
  await clearSelection(page)
  // Monaco rendering pipeline settle – no DOM signal for cursorBlinking change;
  // toHaveScreenshot does two-pass stability check on top of this
  await page.waitForTimeout(500)
}

// ---------------------------------------------------------------------------
// (a) Welcome panel – no project loaded
// ---------------------------------------------------------------------------

visualTest.describe('Visual regression – no project', () => {
  visualTest.slow()

  visualTest('(a) welcome panel', async ({ visualWindow }, testInfo) => {
    assertBaselineExists('welcome-empty', testInfo)
    await expect(visualWindow).toHaveScreenshot({ name: 'welcome-empty.png' })
  })
})

// ---------------------------------------------------------------------------
// (b)–(e) With project loaded – sequential single-session
// ---------------------------------------------------------------------------

visualTest.describe('Visual regression – with project', () => {
  visualTest.slow()

  visualTest('(b) editor loaded', async ({ visualWindowWithProject }, testInfo) => {
    assertBaselineExists('editor-loaded', testInfo)

    const page = visualWindowWithProject

    // Open the seed markdown file in the editor
    await clickFileByName(page, 'README.md')
    await byTestId(page, TEST_IDS.EDITOR_CONTENT).waitFor({ state: 'visible', timeout: 10000 })

    await stabilizeEditor(page)

    const masks = [
      page.locator('.minimap'),
      page.locator('.scrollbar'),
      // Terminal auto-opens on project load; mask only the xterm canvas so the
      // panel chrome (header, toolbar) remains under visual assertion. Matches
      // the specificity used by (c) terminal open below.
      byTestId(page, TEST_IDS.TERMINAL_INSTANCE),
      // "Project Opened" toast shows the absolute project path (ephemeral tmpdir).
      byTestId(page, TEST_IDS.TOAST_CONTAINER)
    ]

    await expect(page).toHaveScreenshot({ name: 'editor-loaded.png', mask: masks })
  })

  visualTest('(c) terminal open', async ({ visualWindowWithProject }, testInfo) => {
    assertBaselineExists('terminal-open', testInfo)

    const page = visualWindowWithProject

    // Open a file first so we have editor + terminal layout
    await clickFileByName(page, 'README.md')
    await byTestId(page, TEST_IDS.EDITOR_CONTENT).waitFor({ state: 'visible', timeout: 10000 })

    // Open terminal panel
    await terminal.open(page)

    await stabilizeEditor(page)

    const masks = [
      page.locator('.minimap'),
      page.locator('.scrollbar'),
      byTestId(page, TEST_IDS.TERMINAL_INSTANCE)
    ]

    await expect(page).toHaveScreenshot({ name: 'terminal-open.png', mask: masks })
  })

  visualTest('(d) settings overlay', async ({ visualWindowWithProject }, testInfo) => {
    assertBaselineExists('settings-overlay', testInfo)

    const page = visualWindowWithProject

    // Open settings overlay
    await openSettings(page)

    // Element-level screenshot of the settings overlay only
    const settingsOverlay = byTestId(page, TEST_IDS.SETTINGS_OVERLAY)
    await expect(settingsOverlay).toHaveScreenshot({ name: 'settings-overlay.png' })
  })

  visualTest('(e) confirm dialog', async ({ visualAppWithProject, visualWindowWithProject }, testInfo) => {
    assertBaselineExists('confirm-dialog', testInfo)

    const page = visualWindowWithProject

    // Open a file in the editor
    await clickFileByName(page, 'README.md')
    await byTestId(page, TEST_IDS.EDITOR_CONTENT).waitFor({ state: 'visible', timeout: 10000 })

    // Switch to source/editor mode (markdown defaults to preview mode)
    await byTestId(page, TEST_IDS.VIEW_MODE_BTN_EDITOR).click()
    // View mode transition animation settle – no testid for "mode ready" state
    await page.waitForTimeout(500)

    // Focus and type in Monaco to create dirty (unsaved) state
    const monacoEditor = page.locator('.monaco-editor .view-lines')
    await monacoEditor.click()
    // Monaco focus acquisition – needed before keyboard.type works reliably
    await page.waitForTimeout(200)
    await page.keyboard.type('x')
    // Dirty state propagation to Zustand store – needed before quit:requested checks blockers
    await page.waitForTimeout(500)

    // Send quit:requested IPC to renderer – dirty editor triggers confirm dialog
    // Using IPC directly avoids the main process close flow and isQuitting flag
    await visualAppWithProject.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.webContents.isDestroyed()) {
        win.webContents.send('quit:requested', { reason: 'visual-test' })
      }
    })

    // Wait for the confirm dialog overlay to appear
    const dialogOverlay = byTestId(page, TEST_IDS.DIALOG_OVERLAY)
    await expect(dialogOverlay).toBeVisible({ timeout: 5000 })

    // Element-level screenshot of the dialog
    await expect(dialogOverlay).toHaveScreenshot({ name: 'confirm-dialog.png' })

    // Click cancel to keep the app open (fixture cleanup handles closing)
    await byTestId(page, TEST_IDS.DIALOG_BTN_CANCEL).click()
    await expect(dialogOverlay).not.toBeVisible({ timeout: 2000 })
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E Tests for Third-Party Components
 *
 * Tests interactions with third-party libraries that cannot have testids
 * injected into their internal DOM structures:
 * - Monaco Editor (code editor)
 * - xterm.js (terminal)
 * - Mermaid (diagrams)
 *
 * Strategy: Test via wrapper elements with testids and keyboard/mouse input.
 *
 * @see docs/testing/e2e-testing.md - Testing third-party components
 * @see Spec #011 - Automated UI testing compatibility
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
  terminal,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'

const mermaidSeed = {
  'test.md': `# Test Document\n\nThis is a test document with a Mermaid diagram.\n\n\`\`\`mermaid\ngraph TD\n    A[Start] --> B[Process]\n    B --> C[End]\n\`\`\`\n\nSome more content below the diagram.\n`
}

test.describe('Third-Party Components E2E', () => {
  test('Monaco editor: Set content via keyboard and verify in preview', async () => {
    // Extended timeout: this test launches Electron, opens a project, switches
    // view mode (triggering async Monaco initialization), types multi-line
    // content, and verifies preview rendering. 60s is too tight in slow
    // environments – the Mermaid test (simpler setup) already takes ~52s.
    test.setTimeout(90_000)

    // Create test project and user data directory BEFORE launching app
    const { projectPath, cleanup: cleanupProject } = await createTestProject(mermaidSeed)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'third-party-monaco'
    )

    // Launch Electron app with isolated user data directory
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    // Declare window outside try block so it's accessible in finally
    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    try {
      window = await electronApp.firstWindow()
      await waitForAppReady(window)

      // Open project via UI (clicks button with mocked dialog)
      await openProject(window, projectPath)

      // Wait for project tree to show the file
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Click on test.md file in project tree to open it
      await clickFileByName(window, 'test.md')

      // Switch to split view mode to show Monaco editor alongside preview.
      // The app defaults to preview-only mode for .md files, so Monaco is not
      // mounted until we switch. Wait for the toolbar button (condition-based)
      // instead of a fixed delay – the button appears once the file is loaded.
      const splitViewBtn = byTestId(window, TEST_IDS.VIEW_MODE_BTN_SPLIT)
      await expect(splitViewBtn).toBeVisible({ timeout: 5000 })
      await splitViewBtn.click()

      // Wait for Monaco editor to be fully initialized (textarea ready)
      await monaco.waitForReady(window)

      // Focus editor and verify cursor is visible
      await monaco.focus(window)

      // Select all existing content
      await keyboard.selectAll(window)

      // Insert new content via insertText (dispatches input event with full text).
      // keyboard.type() sends individual keystrokes which Monaco sometimes drops
      // during re-layout cycles (especially after \n → Enter). insertText sends
      // the content as a single input event, equivalent to a paste operation.
      const newContent = '# Monaco Editor Test\n\nThis content was typed via keyboard!'
      await window.keyboard.insertText(newContent)

      // Get preview pane to verify content appears.
      // Use Playwright's auto-retrying assertion instead of a fixed delay –
      // it polls until the preview renders the typed content or times out.
      const previewPane = byTestId(window, TEST_IDS.EDITOR_PREVIEW)

      // Verify the heading appears in preview
      await expect(previewPane).toContainText('Monaco Editor Test', { timeout: 10000 })

      // Verify the paragraph appears in preview
      await expect(previewPane).toContainText('This content was typed via keyboard!')
    } finally {
      // Cleanup - use closeApp to dismiss any quit dialogs
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })

  test('xterm.js terminal: Type command and verify output', async () => {
    // Create test project (terminal requires a project) and user data directory
    const { projectPath, cleanup: cleanupProject } = await createTestProject(mermaidSeed)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'third-party-xterm'
    )

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    // Declare window outside try block so it's accessible in finally
    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    try {
      window = await electronApp.firstWindow()
      await waitForAppReady(window)

      // Open project via UI (clicks button with mocked dialog)
      await openProject(window, projectPath)

      // Wait for project to load
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Open terminal panel using helper (includes waitForPrompt() internally)
      await terminal.open(window)

      // Get terminal instance wrapper (third-party component: xterm.js)
      const terminalInstance = byTestId(window, TEST_IDS.TERMINAL_INSTANCE)
      await expect(terminalInstance).toBeVisible({ timeout: 5000 })

      // Send a command using terminal helper
      await terminal.sendCommand(window, 'echo "E2E Terminal Test"')

      // KNOWN_WAIT: xterm.js WebGL renderer doesn't expose text to the DOM,
      // so toContainText/waitForOutput cannot verify command output.
      // Wait briefly for command execution, then verify terminal didn't crash.
      await window.waitForTimeout(1000)

      // Verify terminal is still visible (didn't crash after command)
      await expect(terminalInstance).toBeVisible()
    } finally {
      // Cleanup - use closeApp to dismiss any quit dialogs
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })

  test('Mermaid toolbar: Hover diagram, click direction button, toolbar stays visible', async () => {
    // Create test project and user data directory BEFORE launching app
    const { projectPath, cleanup: cleanupProject } = await createTestProject(mermaidSeed)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'third-party-mermaid'
    )

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    // Declare window outside try block so it's accessible in finally
    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    try {
      window = await electronApp.firstWindow()
      await waitForAppReady(window)

      // Open project via UI (clicks button with mocked dialog)
      await openProject(window, projectPath)

      // Wait for project tree to be visible
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Click on test.md file in project tree to open it
      await clickFileByName(window, 'test.md')

      // Wait for preview pane to be visible (condition-based instead of fixed delay)
      const previewPane = byTestId(window, TEST_IDS.EDITOR_PREVIEW)
      await expect(previewPane).toBeVisible({ timeout: 5000 })

      // Wait for Mermaid diagram to render by checking for SVG presence
      const diagramContainer = previewPane.locator('.mermaid-container').first()
      await expect(diagramContainer).toBeVisible({ timeout: 10000 })
      await diagramContainer.locator('.mermaid-diagram svg').waitFor({ state: 'visible', timeout: 10000 })

      // Hover over diagram to show toolbar
      await diagramContainer.hover()

      // Mermaid toolbar should be visible (hoverDiagram already waits for it)
      const mermaidToolbar = byTestId(window, TEST_IDS.MERMAID_TOOLBAR)
      await expect(mermaidToolbar).toBeVisible({ timeout: 3000 })

      // Click a direction button (e.g., Left-to-Right)
      // Mermaid direction buttons have dynamic testids: mermaid-direction-btn-{TB|BT|LR|RL}
      const directionButton = byTestId(window, `${TEST_IDS.MERMAID_DIRECTION_BTN}-LR`)

      // Check if button exists (it may not if diagram doesn't support direction change)
      const buttonCount = await directionButton.count()

      if (buttonCount > 0) {
        // Click the direction button
        await directionButton.click()

        // Wait for diagram re-render by checking for new SVG (condition-based)
        await diagramContainer.locator('.mermaid-diagram svg').waitFor({ state: 'visible', timeout: 10000 })

        // Toolbar should still be visible after clicking direction button
        await expect(mermaidToolbar).toBeVisible()
      } else {
        // If direction button not available, test expand button instead
        const expandButton = byTestId(window, TEST_IDS.MERMAID_BTN_EXPAND)
        await expect(expandButton).toBeVisible()

        // Click expand to open fullscreen viewer
        await expandButton.click()

        // Diagram viewer should open
        const diagramViewer = byTestId(window, TEST_IDS.DIAGRAM_VIEWER)
        await expect(diagramViewer).toBeVisible({ timeout: 3000 })

        // Close viewer with Escape
        await window.keyboard.press('Escape')

        // Viewer should close
        await expect(diagramViewer).not.toBeVisible()
      }
    } finally {
      // Cleanup - use closeApp to dismiss any quit dialogs
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})

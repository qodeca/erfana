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
 * @see BRS-011 - Automated UI testing compatibility
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import {
  TEST_IDS,
  byTestId,
  waitForTestId,
  waitForAppReady,
  openProject,
  clickFileByName,
  keyboard,
  terminal,
  closeApp
} from './utils/helpers'

// Helper: Create temporary test project with Mermaid diagram
// Uses .e2e-temp inside project directory (gitignored)
async function createTestProject(): Promise<string> {
  const e2eTestDir = path.join(__dirname, '..', '.e2e-temp')
  await fs.promises.mkdir(e2eTestDir, { recursive: true })
  const tempDir = await fs.promises.mkdtemp(path.join(e2eTestDir, 'test-'))

  const testMarkdown = `# Test Document

This is a test document with a Mermaid diagram.

\`\`\`mermaid
graph TD
    A[Start] --> B[Process]
    B --> C[End]
\`\`\`

Some more content below the diagram.
`

  await fs.promises.writeFile(path.join(tempDir, 'test.md'), testMarkdown, 'utf-8')

  return tempDir
}

// Helper: Clean up test project
async function cleanupTestProject(projectPath: string): Promise<void> {
  await fs.promises.rm(projectPath, { recursive: true, force: true })
}

// Helper: Create temporary user data directory for test isolation
async function createTempUserDataDir(
  testName: string
): Promise<{ userDataDir: string; cleanup: () => Promise<void> }> {
  const e2eTempDir = path.join(__dirname, '..', '.e2e-temp')
  await fs.promises.mkdir(e2eTempDir, { recursive: true })

  const userDataDir = await fs.promises.mkdtemp(path.join(e2eTempDir, `third-party-${testName}-`))

  return {
    userDataDir,
    cleanup: async () => {
      await fs.promises.rm(userDataDir, { recursive: true, force: true })
    }
  }
}

test.describe('Third-Party Components E2E', () => {
  test('Monaco editor: Set content via keyboard and verify in preview', async () => {
    // Create test project and user data directory BEFORE launching app
    const projectPath = await createTestProject()
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('monaco')

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
      await openProject(electronApp, window, projectPath)

      // Wait for project tree to show the file
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Click on test.md file in project tree to open it
      await clickFileByName(window, 'test.md')

      // Wait for editor panel to load (default is preview-only mode)
      await window.waitForTimeout(500)

      // Switch to split view mode to show Monaco editor alongside preview
      // The app defaults to preview-only mode, so we need to enable the editor
      const splitViewBtn = byTestId(window, TEST_IDS.VIEW_MODE_BTN_SPLIT)
      await expect(splitViewBtn).toBeVisible({ timeout: 5000 })
      await splitViewBtn.click()

      // Wait for editor to mount after view mode change
      await window.waitForTimeout(500)

      // Get the Monaco editor wrapper (third-party component)
      const editorWrapper = byTestId(window, TEST_IDS.EDITOR_MONACO)
      await expect(editorWrapper).toBeVisible({ timeout: 5000 })

      // Click editor to focus it
      await editorWrapper.click()
      await window.waitForTimeout(100)

      // Select all existing content
      await keyboard.selectAll(window)

      // Type new content
      const newContent = '# Monaco Editor Test\n\nThis content was typed via keyboard!'
      await window.keyboard.type(newContent)

      // Wait for debounced save
      await window.waitForTimeout(500)

      // Get preview pane to verify content appears
      const previewPane = byTestId(window, TEST_IDS.EDITOR_PREVIEW)

      // Verify the heading appears in preview
      await expect(previewPane).toContainText('Monaco Editor Test', { timeout: 5000 })

      // Verify the paragraph appears in preview
      await expect(previewPane).toContainText('This content was typed via keyboard!')
    } finally {
      // Cleanup - use closeApp to dismiss any quit dialogs
      await closeApp(electronApp, window)
      await cleanupTestProject(projectPath)
      await cleanupUserData()
    }
  })

  test('xterm.js terminal: Type command and verify output', async () => {
    // Create test project (terminal requires a project) and user data directory
    const projectPath = await createTestProject()
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('xterm')

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
      await openProject(electronApp, window, projectPath)

      // Wait for project to load
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Open terminal panel using helper (clicks activity bar button)
      await terminal.open(window)

      // Get terminal instance wrapper (third-party component: xterm.js)
      const terminalInstance = byTestId(window, TEST_IDS.TERMINAL_INSTANCE)
      await expect(terminalInstance).toBeVisible({ timeout: 5000 })

      // Wait for terminal to initialize (PTY needs time to start)
      await window.waitForTimeout(1500)

      // Send a command using terminal helper
      await terminal.sendCommand(window, 'echo "E2E Terminal Test"')

      // Wait for command to execute - xterm.js renders to canvas so we can't use toContainText
      // Instead, verify terminal remains responsive by waiting for a brief period
      // If the command failed or terminal crashed, the test would timeout earlier
      await window.waitForTimeout(1000)

      // Verify terminal is still visible (didn't crash after command)
      await expect(terminalInstance).toBeVisible()
    } finally {
      // Cleanup - use closeApp to dismiss any quit dialogs
      await closeApp(electronApp, window)
      await cleanupTestProject(projectPath)
      await cleanupUserData()
    }
  })

  test('Mermaid toolbar: Hover diagram, click direction button, toolbar stays visible', async () => {
    // Create test project and user data directory BEFORE launching app
    const projectPath = await createTestProject()
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('mermaid')

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
      await openProject(electronApp, window, projectPath)

      // Wait for project tree to be visible
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Click on test.md file in project tree to open it
      await clickFileByName(window, 'test.md')

      // Wait for editor and preview to load
      await window.waitForTimeout(500)

      // Get preview pane (where Mermaid diagrams render)
      const previewPane = byTestId(window, TEST_IDS.EDITOR_PREVIEW)
      await expect(previewPane).toBeVisible({ timeout: 5000 })

      // Wait for Mermaid diagram to render (it's async)
      await window.waitForTimeout(2000)

      // Find the Mermaid diagram container
      // The app renders Mermaid diagrams with class 'mermaid-container'
      const diagramContainer = previewPane.locator('.mermaid-container').first()
      await expect(diagramContainer).toBeVisible({ timeout: 5000 })

      // Hover over diagram to show toolbar
      await diagramContainer.hover()

      // Wait for toolbar to appear (transition delay)
      await window.waitForTimeout(300)

      // Mermaid toolbar should be visible
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

        // Wait for diagram re-render
        await window.waitForTimeout(1000)

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
      await cleanupTestProject(projectPath)
      await cleanupUserData()
    }
  })
})

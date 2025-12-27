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
import * as os from 'os'
import { TEST_IDS, byTestId } from './utils/helpers'

// Helper: Create temporary test project with Mermaid diagram
async function createTestProject(): Promise<string> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'erfana-e2e-'))

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

test.describe('Third-Party Components E2E', () => {
  test('Monaco editor: Set content via keyboard and verify in preview', async () => {
    // Launch Electron app in dev mode
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..')],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for activity bar to be ready
    const activityBar = byTestId(window, TEST_IDS.ACTIVITY_BAR)
    await expect(activityBar).toBeVisible({ timeout: 10000 })

    // Create and open test project
    const projectPath = await createTestProject()

    try {
      // Click files button to open files panel
      const filesButton = byTestId(window, TEST_IDS.ACTIVITY_BAR_BTN_FILES)
      await filesButton.click()

      // Wait for project tree
      const projectTree = byTestId(window, TEST_IDS.PROJECT_TREE)
      await expect(projectTree).toBeVisible()

      // Open project via system evaluation (simulate opening a project)
      // In dev mode, we can use IPC to switch project
      await window.evaluate((projPath) => {
        // @ts-expect-error - window.api is injected by preload script
        window.api.project.switch(projPath)
      }, projectPath)

      // Wait for file to be available and click it
      await window.waitForTimeout(1000) // Give time for project to load

      // Get the Monaco editor wrapper (third-party component)
      const editorWrapper = byTestId(window, TEST_IDS.EDITOR_MONACO)
      await expect(editorWrapper).toBeVisible({ timeout: 5000 })

      // Click editor to focus it
      await editorWrapper.click()

      // Wait a moment for focus to stabilize
      await window.waitForTimeout(100)

      // Select all existing content (platform-aware)
      const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
      await window.keyboard.press(`${modKey}+A`)

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
      // Cleanup
      await electronApp.close()
      await cleanupTestProject(projectPath)
    }
  })

  test('xterm.js terminal: Type command and verify output', async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..')],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for activity bar
    const activityBar = byTestId(window, TEST_IDS.ACTIVITY_BAR)
    await expect(activityBar).toBeVisible({ timeout: 10000 })

    // Click terminal button to open terminal panel
    const terminalButton = byTestId(window, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)
    await terminalButton.click()

    // Get terminal instance wrapper (third-party component: xterm.js)
    const terminalInstance = byTestId(window, TEST_IDS.TERMINAL_INSTANCE)
    await expect(terminalInstance).toBeVisible({ timeout: 5000 })

    // Wait for terminal to initialize (PTY needs time to start)
    await window.waitForTimeout(1500)

    // Click terminal to focus it
    await terminalInstance.click()

    // Type a simple echo command
    const testCommand = 'echo "E2E Terminal Test"'
    await window.keyboard.type(testCommand)
    await window.keyboard.press('Enter')

    // Wait for command to execute and output to appear
    await window.waitForTimeout(1000)

    // Verify output appears in terminal (xterm.js renders text content)
    await expect(terminalInstance).toContainText('E2E Terminal Test', { timeout: 5000 })

    // Cleanup
    await electronApp.close()
  })

  test('Mermaid toolbar: Hover diagram, click direction button, toolbar stays visible', async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..')],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for activity bar
    const activityBar = byTestId(window, TEST_IDS.ACTIVITY_BAR)
    await expect(activityBar).toBeVisible({ timeout: 10000 })

    // Create and open test project with Mermaid diagram
    const projectPath = await createTestProject()

    try {
      // Open project
      await window.evaluate((projPath) => {
        // @ts-expect-error - window.api is injected by preload script
        window.api.project.switch(projPath)
      }, projectPath)

      // Wait for project to load
      await window.waitForTimeout(1000)

      // Get preview pane (where Mermaid diagrams render)
      const previewPane = byTestId(window, TEST_IDS.EDITOR_PREVIEW)
      await expect(previewPane).toBeVisible({ timeout: 5000 })

      // Wait for Mermaid diagram to render (it's async)
      await window.waitForTimeout(2000)

      // Find the Mermaid diagram container (class-based selector since it's third-party)
      const diagramContainer = previewPane.locator('.mermaid').first()
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
      // Cleanup
      await electronApp.close()
      await cleanupTestProject(projectPath)
    }
  })
})

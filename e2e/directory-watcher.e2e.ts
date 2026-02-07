/**
 * E2E Tests for Directory Watcher Pipeline
 *
 * Verifies the complete directory watcher pipeline: creating a file via
 * the terminal and confirming it appears in the Project Tree within a
 * latency budget.
 *
 * Targets:
 * - 016-NFR-001: 500ms target latency for file appearance
 * - E2E threshold: 2000ms (accounts for CI overhead)
 *
 * @see specs/spec-t3-016-project-tree-refresh
 * @see docs/file-watching/README.md
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  TEST_IDS,
  waitForAppReady,
  openProject,
  terminal,
  closeApp
} from './utils/helpers'

// =============================================================================
// Local helpers
// =============================================================================

/**
 * Creates a temporary test project with a single seed markdown file.
 * Uses `.e2e-temp/` inside the project directory (gitignored).
 *
 * @returns Object with projectPath and async cleanup function.
 */
async function createTestProject(): Promise<{ projectPath: string; cleanup: () => Promise<void> }> {
  const e2eTempDir = path.join(__dirname, '..', '.e2e-temp')
  await fs.promises.mkdir(e2eTempDir, { recursive: true })

  const projectPath = await fs.promises.mkdtemp(path.join(e2eTempDir, 'dir-watcher-'))
  await fs.promises.writeFile(path.join(projectPath, 'test.md'), '# Test\n', 'utf-8')

  return {
    projectPath,
    cleanup: async () => {
      try {
        await fs.promises.rm(projectPath, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Creates an isolated user data directory for Electron.
 * Ensures each test run does not share persisted state.
 *
 * @param testName - Short label used in the temp directory name.
 * @returns Object with userDataDir path and async cleanup function.
 */
async function createTempUserDataDir(testName: string): Promise<{
  userDataDir: string
  cleanup: () => Promise<void>
}> {
  const e2eTempDir = path.join(__dirname, '..', '.e2e-temp')
  await fs.promises.mkdir(e2eTempDir, { recursive: true })

  const userDataDir = await fs.promises.mkdtemp(path.join(e2eTempDir, `dir-watcher-${testName}-`))

  return {
    userDataDir,
    cleanup: async () => {
      try {
        await fs.promises.rm(userDataDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// =============================================================================
// Tests
// =============================================================================

test.describe('Directory watcher pipeline', () => {
  test('file created via terminal appears in Project Tree within latency budget', async () => {
    const { projectPath, cleanup: cleanupProject } = await createTestProject()
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('latency')

    let electronApp: ElectronApplication | undefined
    let window: Page | undefined

    try {
      electronApp = await electron.launch({
        args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
        env: {
          ...process.env,
          NODE_ENV: 'development'
        }
      })

      window = await electronApp.firstWindow()
      await waitForAppReady(window)

      // Open project via IPC API (bypasses native dialog)
      await openProject(electronApp, window, projectPath)

      // Wait for project tree to show the seed file – confirms watchers are active
      await expect(
        window
          .locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
          .filter({ hasText: 'test.md' })
      ).toBeVisible({ timeout: 15000 })

      // Open terminal panel
      await terminal.open(window)

      // Generate unique filename to avoid conflicts across retries
      const fileName = `e2e-watcher-${Date.now()}.md`

      // Send command and start timing AFTER Enter is pressed (when the file is created on disk)
      await terminal.sendCommand(window, `touch "${path.join(projectPath, fileName)}"`)
      const startTime = Date.now()

      // Wait for file to appear in Project Tree
      const fileLocator = window
        .locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
        .filter({ hasText: fileName })

      await fileLocator.waitFor({ state: 'visible', timeout: 2000 })
      const endTime = Date.now()
      const elapsed = endTime - startTime

      // Log timing for monitoring
      console.log(
        `Directory watcher pipeline latency: ${elapsed}ms (target: 500ms, threshold: 2000ms)`
      )
      if (elapsed <= 500) {
        console.log('Within 016-NFR-001 target (500ms)')
      } else {
        console.log(
          `Exceeds 016-NFR-001 target by ${elapsed - 500}ms (still within E2E threshold)`
        )
      }

      expect(elapsed).toBeLessThan(2000)
    } finally {
      // Cleanup: close app first, then remove dirs
      if (electronApp && window) {
        await closeApp(electronApp, window)
      } else if (electronApp) {
        await electronApp.close().catch(() => {})
      }
      await cleanupProject()
      await cleanupUserData()
    }
  })
})

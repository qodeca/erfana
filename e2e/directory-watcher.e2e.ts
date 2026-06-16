// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
import * as path from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  TEST_IDS,
  waitForAppReady,
  openProject,
  terminal,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'

// =============================================================================
// Tests
// =============================================================================

test.describe('Directory watcher pipeline', () => {
  // Budget assertions must not be retried — a transient slow run silently
  // hidden by a fast retry masks real performance regressions. Same discipline
  // as `visual-regression.e2e.ts` (spec-019-FR-003).
  test.describe.configure({ retries: 0 })

  // Platform-specific latency budget:
  // - POSIX (macOS, Linux): inotify-class notifications, typical 200-600 ms.
  //   The 2000 ms ceiling catches a regression (2-3× slowdown) while leaving
  //   headroom for UI reconciliation + IPC overhead.
  // - Windows: chokidar uses `ReadDirectoryChangesW` with larger latencies;
  //   Defender on-access scanning of the new file adds another 200-800 ms
  //   before the FS notification fires. Observed end-to-end 1500-2500 ms on
  //   local dev; `windows-latest` GHA VMs are typically 1.5-2× slower due
  //   to shared disk I/O and Defender-by-default, so 6000 ms leaves safety
  //   margin without masking a 4× regression.
  // See `docs/known-issues.md` "Directory watcher latency on Windows".
  //
  // Architectural note: per-platform branching in test body is tactical, not
  // architecturally clean — the right long-term home is Playwright `projects:`
  // metadata in `playwright.config.ts`. Follows the existing precedent at
  // `e2e/visual-regression.e2e.ts:35-37` rather than promoting to config,
  // which would be a separate refactor with broader scope.
  const LATENCY_BUDGET_MS = process.platform === 'win32' ? 6000 : 2000

  test('file created via terminal appears in Project Tree within latency budget', async () => {
    const { projectPath, cleanup: cleanupProject } = await createTestProject({
      'test.md': '# Test\n'
    })
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'dir-watcher-latency'
    )

    let electronApp: ElectronApplication | undefined
    let window: Page | undefined

    try {
      electronApp = await electron.launch({
        args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
        env: {
          ...process.env,
          NODE_ENV: 'development',
          // Force the PTY bootstrap to exec into /bin/sh -i instead of the
          // user's login interactive $SHELL, so the test does not race a
          // multi-second `source ~/.zshrc`. See docs/known-issues.md §
          // "E2E terminal-driven tests sensitive to user's shell init speed".
          ERFANA_E2E_FAST_SHELL: '1'
        }
      })

      window = await electronApp.firstWindow()
      await waitForAppReady(window)

      // Open project via IPC API (bypasses native dialog)
      await openProject(window, projectPath)

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

      await fileLocator.waitFor({ state: 'visible', timeout: LATENCY_BUDGET_MS })
      const endTime = Date.now()
      const elapsed = endTime - startTime

      // Log timing for monitoring
      console.log(
        `Directory watcher pipeline latency: ${elapsed}ms (target: 500ms, threshold: ${LATENCY_BUDGET_MS}ms, platform: ${process.platform})`
      )
      if (elapsed <= 500) {
        console.log('Within 016-NFR-001 target (500ms)')
      } else {
        console.log(
          `Exceeds 016-NFR-001 target by ${elapsed - 500}ms (still within E2E threshold)`
        )
      }

      // Emit structured data for trend tracking (picked up by Playwright trace /
      // CI log analysis). The 500 ms NFR-001 target is asserted in the
      // integration test at `src/main/services/DirectoryWatcherService.pipeline.test.ts`
      // where mocked chokidar isolates from Defender + UI noise.
      await test.info().attach('latency-trend', {
        body: JSON.stringify({
          elapsedMs: elapsed,
          budgetMs: LATENCY_BUDGET_MS,
          platform: process.platform,
          nfr001TargetMs: 500
        }),
        contentType: 'application/json'
      })

      expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS)
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

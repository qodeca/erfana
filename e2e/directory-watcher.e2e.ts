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
import * as fs from 'fs'
import * as path from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  ProjectTreePage,
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

  // Issue #211 (design W15, AC1/AC3/AC4): a folder listed in the project's
  // `files.exclude` never enters the tree, and heavy churn inside it does not
  // delay a change in a visible folder beyond the same latency budget.
  test('should keep excluded folder out of the tree and still show a visible change when the excluded folder churns', async () => {
    const { projectPath, cleanup: cleanupProject } = await createTestProject({
      'test.md': '# Test\n'
    })
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'dir-watcher-exclude'
    )

    // Seed the project: an excluded folder with content (so "absent" means
    // excluded, not merely empty), a visible folder, and the project settings.
    await fs.promises.mkdir(path.join(projectPath, 'scratch'), { recursive: true })
    await fs.promises.writeFile(path.join(projectPath, 'scratch', 'seed.md'), '# seed\n', 'utf-8')
    await fs.promises.mkdir(path.join(projectPath, 'visible'), { recursive: true })
    await fs.promises.writeFile(path.join(projectPath, 'visible', 'seed.md'), '# seed\n', 'utf-8')
    await fs.promises.mkdir(path.join(projectPath, '.erfana'), { recursive: true })
    await fs.promises.writeFile(
      path.join(projectPath, '.erfana', 'settings.json'),
      JSON.stringify({ files: { exclude: ['scratch'] } }),
      'utf-8'
    )

    const runId = Date.now()
    const visibleName = `visible-${runId}.md`
    const afterName = `after-${runId}.md`
    // The terminal paints to a canvas, so its output cannot be read from the
    // DOM; the churn script signals completion with a file OUTSIDE the project.
    const churnDoneFile = path.join(userDataDir, `w15-churn-done-${runId}`)

    // Scripts live OUTSIDE the project (in the temp user-data dir) and are run
    // with `node "<path>"`, which quotes the same way in pwsh, cmd and POSIX
    // shells – so the test does not depend on which shell the host resolves.
    // Forward slashes keep the path literal inside a POSIX double-quoted arg.
    const toArg = (p: string): string => p.replace(/\\/g, '/')
    const scratchDir = path.join(projectPath, 'scratch')
    const churnScript = path.join(userDataDir, 'w15-churn.js')
    await fs.promises.writeFile(
      churnScript,
      [
        "const fs = require('fs')",
        "const path = require('path')",
        `const scratch = ${JSON.stringify(scratchDir)}`,
        `const visible = ${JSON.stringify(path.join(projectPath, 'visible', visibleName))}`,
        // Churn before and after the visible write, so the watcher is busy
        // with excluded events on both sides of the change it must report.
        'for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(scratch, `c-${i}.txt`), String(i))',
        "fs.writeFileSync(visible, '# visible\\n')",
        'for (let i = 200; i < 1000; i++) fs.writeFileSync(path.join(scratch, `c-${i}.txt`), String(i))',
        'for (let i = 0; i < 1000; i += 2) fs.rmSync(path.join(scratch, `c-${i}.txt`))',
        `fs.writeFileSync(${JSON.stringify(churnDoneFile)}, 'done')`
      ].join('\n'),
      'utf-8'
    )
    const afterScript = path.join(userDataDir, 'w15-after.js')
    await fs.promises.writeFile(
      afterScript,
      [
        "const fs = require('fs')",
        `fs.writeFileSync(${JSON.stringify(path.join(projectPath, 'visible', afterName))}, '# after\\n')`
      ].join('\n'),
      'utf-8'
    )

    let electronApp: ElectronApplication | undefined
    let window: Page | undefined

    try {
      electronApp = await electron.launch({
        args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
        env: {
          ...process.env,
          NODE_ENV: 'development',
          ERFANA_E2E_FAST_SHELL: '1'
        }
      })

      window = await electronApp.firstWindow()
      await waitForAppReady(window)
      await openProject(window, projectPath)

      const tree = new ProjectTreePage(window)
      await expect(tree.fileRow('test.md')).toBeVisible({ timeout: 15000 })
      // `visible` is listed; `scratch` is not (the exclusion applied on open).
      await expect(tree.folderRow('visible')).toBeVisible({ timeout: 15000 })
      await expect(tree.folderRow('scratch')).toHaveCount(0)
      await tree.expandTo(['visible'])
      await expect(tree.fileRow('visible/seed.md')).toBeVisible()

      await terminal.open(window)

      // Timing starts after Enter, so node start-up and the 200 churn writes
      // ahead of the visible file count against the budget (strict side).
      await terminal.sendCommand(window, `node "${toArg(churnScript)}"`)
      const startTime = Date.now()

      await tree
        .fileRow(`visible/${visibleName}`)
        .waitFor({ state: 'visible', timeout: LATENCY_BUDGET_MS })
      const elapsed = Date.now() - startTime
      console.log(
        `Visible change under excluded churn: ${elapsed}ms (threshold: ${LATENCY_BUDGET_MS}ms, platform: ${process.platform})`
      )
      await test.info().attach('latency-trend-excluded-churn', {
        body: JSON.stringify({ elapsedMs: elapsed, budgetMs: LATENCY_BUDGET_MS, platform: process.platform }),
        contentType: 'application/json'
      })
      expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS)

      // Let the churn finish, then prove the watcher has processed everything
      // up to a later visible change before asserting `scratch` is still absent
      // – otherwise the absence check could pass before any late event landed.
      await expect
        .poll(() => fs.existsSync(churnDoneFile), {
          timeout: 30000,
          message: 'churn script did not finish'
        })
        .toBe(true)
      await terminal.sendCommand(window, `node "${toArg(afterScript)}"`)
      await expect(tree.fileRow(`visible/${afterName}`)).toBeVisible({
        timeout: LATENCY_BUDGET_MS
      })

      await expect(tree.folderRow('scratch')).toHaveCount(0)
      await expect(tree.fileRow('scratch/c-1.txt')).toHaveCount(0)
    } finally {
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

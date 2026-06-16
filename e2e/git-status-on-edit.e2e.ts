// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E test: Project Tree git status badge updates after an in-editor edit
 * without requiring a manual refresh.
 *
 * Closes the regression where a Monaco autosave wrote to disk via in-place
 * fs.writeFile (chokidar `change` event), but DirectoryWatcherService never
 * subscribed to chokidar's `change` event — so the broadcast that wakes
 * `useGitStatus.debouncedRefresh` never fired and the M badge only appeared
 * after pressing Cmd/Ctrl+Alt+R.
 *
 * Asserts the full chain:
 *   keystroke → autosave (2 s debounce) → fs.writeFile → chokidar `change`
 *   → DirectoryWatcherService → 'directory-watch:changed' IPC
 *   → useGitStatus.debouncedRefresh → git.getStatus → store → row repaints
 *
 * @see src/main/services/DirectoryWatcherService.ts:244-267 — the new listener
 * @see src/renderer/src/hooks/useGitStatus.ts:247-255 — the subscriber
 * @see docs/file-watching/README.md — architectural notes
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'path'
import { promisify } from 'util'
import { execFile } from 'child_process'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  TEST_IDS,
  waitForAppReady,
  openProject,
  closeApp,
  createTestProject,
  createTempUserDataDir,
  MonacoPage,
  KeyboardHelper,
  ProjectTreePage,
  byTestId
} from './utils/helpers'

const execFileAsync = promisify(execFile)

/**
 * Probe for `git` on PATH without calling `test.skip` from a wrapper – that
 * pattern can fail to propagate per Playwright issue
 * https://github.com/microsoft/playwright/issues/22834 and cause a confusing
 * failure on machines without git installed. The caller invokes `test.skip`
 * directly in the test body when this returns false.
 */
async function hasGitOnPath(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'])
    return true
  } catch {
    return false
  }
}

/**
 * Initialise a git repo with one tracked, committed file so that subsequent
 * edits produce a "modified" status. Assumes `hasGitOnPath` already returned
 * true – callers must `test.skip(!await hasGitOnPath(), …)` first.
 */
async function gitInitWithCommit(projectPath: string, fileName: string): Promise<void> {
  // Use --initial-branch to avoid the "hint: Using 'master'" warning some git
  // versions emit; keep noise out of CI logs.
  await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: projectPath })
  // Local identity so commit succeeds without relying on global git config
  await execFileAsync('git', ['config', 'user.email', 'e2e@erfana.local'], { cwd: projectPath })
  await execFileAsync('git', ['config', 'user.name', 'Erfana E2E'], { cwd: projectPath })
  await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: projectPath })
  await execFileAsync('git', ['add', fileName], { cwd: projectPath })
  await execFileAsync('git', ['commit', '-m', 'baseline'], { cwd: projectPath })
}

test.describe('Git status badge auto-refresh on editor save', () => {
  // No retries on a budget assertion – masking a slow run hides regressions.
  // Same discipline as directory-watcher.e2e.ts and visual-regression.e2e.ts.
  test.describe.configure({ retries: 0 })

  // Latency budget: autosave debounce (2000 ms) + DirectoryWatcher pipeline
  // (~275 ms collect+throttle) + renderer debounce (250 ms) + worst-case
  // cooldown gating (500 ms) + git status execution (~150-500 ms) ≈ 3500 ms
  // baseline. Add CI overhead + Defender + GH Actions runner I/O.
  //   POSIX local & CI: 8000 ms (>2x baseline)
  //   Windows: 12000 ms (Defender on-access scanning of every write adds
  //     several hundred ms per file event; chokidar uses
  //     ReadDirectoryChangesW which is also slower than FSEvents).
  const BADGE_BUDGET_MS = process.platform === 'win32' ? 12000 : 8000

  test('M badge appears after Monaco autosave without manual refresh', async () => {
    // Skip-probe runs in the test body, not inside a helper – Playwright
    // issue #22834 documents that test.skip() called from wrappers can fail
    // to propagate, causing the test to continue and fail with a confusing
    // error rather than being marked skipped.
    const gitAvailable = await hasGitOnPath()
    test.skip(!gitAvailable, 'git binary not available on PATH – cannot verify git status badge')

    const fileName = 'notes.md'
    const { projectPath, cleanup: cleanupProject } = await createTestProject({
      [fileName]: '# Notes\n\nOriginal content.\n'
    })
    await gitInitWithCommit(projectPath, fileName)

    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'git-status-on-edit'
    )

    let electronApp: ElectronApplication | undefined
    let window: Page | undefined

    try {
      electronApp = await electron.launch({
        args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
        env: {
          ...process.env,
          NODE_ENV: 'development',
          // Same fast-shell flag as directory-watcher.e2e.ts to avoid racing
          // a multi-second shell init when the test does not use the terminal.
          ERFANA_E2E_FAST_SHELL: '1'
        }
      })

      window = await electronApp.firstWindow()
      await waitForAppReady(window)
      await openProject(window, projectPath)

      // Wait for the seed file row to appear – proves the project loaded
      const fileRow = window
        .locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
        .filter({ hasText: fileName })
      await expect(fileRow).toBeVisible({ timeout: 15000 })

      // Baseline: the committed file must NOT show a status badge yet.
      // Target the badge span specifically (.git-status-badge) — the filename
      // span ALSO carries data-git-status for color styling, so a bare
      // [data-git-status="modified"] selector would match both.
      const modifiedBadge = fileRow.locator('.git-status-badge[data-git-status="modified"]')
      await expect(modifiedBadge).toHaveCount(0)

      // Open the file in the editor area. Markdown files default to preview-only
      // view (Monaco hidden), so after the row click we toggle into editor view
      // before waiting for Monaco to mount. See fixture-smoke.e2e.ts:104-108 for
      // the same constraint.
      const keyboard = new KeyboardHelper(window)
      const projectTree = new ProjectTreePage(window)
      const monaco = new MonacoPage(window, keyboard)
      await projectTree.clickFileByName(fileName)
      await byTestId(window, TEST_IDS.VIEW_MODE_BTN_EDITOR).click()
      await monaco.waitForReady()
      await monaco.appendContent('\nAdded by e2e to trigger modified status.\n')

      // Track elapsed from the moment the edit hits the editor buffer.
      // The autosave debounce alone is 2 s; total chain ≈ 3.5 s under ideal
      // conditions. The strict assertion below is that the badge appears
      // before BADGE_BUDGET_MS — NO manual refresh, NO Cmd+S force-flush.
      const startTime = Date.now()

      // Wait for the modified badge to appear on the file row.
      // CRITICAL: this assertion must succeed WITHOUT clicking the refresh
      // button or pressing Cmd+S. If it only passes after a manual nudge,
      // the regression is back and this assertion has been weakened.
      await expect(modifiedBadge).toBeVisible({ timeout: BADGE_BUDGET_MS })
      const elapsed = Date.now() - startTime

      // Stability gate: ensure the badge stays visible after appearing.
      // Catches a regression where status flips back to "clean" after a
      // brief flash (cooldown race, stale store update overwriting fresh
      // state) — a fleeting render would otherwise satisfy toBeVisible.
      await window.waitForTimeout(500)
      await expect(modifiedBadge).toBeVisible()

      // Assert the badge content — a regression that changes the status
      // letter to 'A' (added), 'U' (untracked), or '!' (conflicted) would
      // pass toBeVisible alone; only this catches a wrong status type.
      await expect(modifiedBadge).toHaveText('M')

      console.log(
        `Git status auto-refresh latency: ${elapsed}ms ` +
          `(budget: ${BADGE_BUDGET_MS}ms, platform: ${process.platform})`
      )

      await test.info().attach('git-status-refresh-trend', {
        body: JSON.stringify({
          elapsedMs: elapsed,
          budgetMs: BADGE_BUDGET_MS,
          platform: process.platform
        }),
        contentType: 'application/json'
      })
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

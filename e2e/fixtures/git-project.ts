// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git-status E2E fixtures.
 *
 * Provides a temporary git repository pre-seeded into EVERY change state the
 * Project Tree decorates (modified / untracked / deleted / staged / renamed /
 * conflicted), with a nested folder layout chosen so folder-dot priority
 * bubbling can be asserted. All mutations are applied on disk BEFORE the
 * Electron app opens, so the first git refresh the renderer performs already
 * reflects the final state — no in-app file editing, no fixed timeouts.
 *
 * Layered onto the base `test` from ./index via `test.extend`. Keeps index.ts
 * untouched (it is already near the size budget); tests import `test`/`expect`
 * from THIS module.
 *
 * @see e2e/utils/git-helpers.ts - the git CLI seeding wrappers
 * @see src/renderer/src/utils/gitStatus.logic.ts - STATUS_PRIORITY map
 */

import { test as base, expect } from './index'
import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { sep } from 'path'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'
import {
  initRepoWithCommit,
  writeFileTree,
  deleteFile,
  createMergeConflict,
  porcelainStatus,
  runGit
} from '../utils/git-helpers'

const PROJECT_ROOT = path.join(__dirname, '..', '..')

/**
 * Relative paths the git-status spec asserts against. Centralised so the test
 * and the fixture agree without duplicating string literals.
 */
export const GIT_PATHS = {
  // file → modified (edited after the initial commit)
  modifiedFile: 'src/components/Button/Button.tsx',
  // file → untracked (written, never `git add`ed); sibling subtree of the
  // modified file so `src/components` mixes modified+untracked and the folder
  // dot must bubble to `modified` (priority 3 > untracked 2).
  untrackedFile: 'src/components/Card/Card.tsx',
  // file → deleted in the worktree (unstaged ` D`). A deleted file has NO
  // on-disk tree node (so no FILE letter-badge is observable); its `deleted`
  // status is asserted via the parent FOLDER dot. `utilsKeep` is a committed,
  // untouched sibling that keeps `src/utils` present in the tree after the
  // delete (an otherwise-empty dir is pruned by git checkout during seeding).
  deletedFile: 'src/utils/helper.ts',
  utilsKeep: 'src/utils/keep.ts',
  // file → staged new file (`A `)
  stagedFile: 'src/staged-new.ts',
  // rename via `git mv`; with the worker's `--no-renames` this surfaces as a
  // deleted old path + staged new path (NOT a single `R` row).
  renameOld: 'src/legacy/old-name.ts',
  renameNew: 'src/legacy/new-name.ts',
  // single-line file that becomes a real merge conflict (`UU`)
  conflictFile: 'docs/guide.md',
  // committed and never touched → unmodified (no badge / no dot)
  cleanFile: 'README.md',
  // committed file inside a folder whose subtree has NO changes → the folder
  // must carry no dot (negative bubbling case).
  cleanFolderFile: 'src/clean/keep.ts'
} as const

/** Initial committed tree (relative path → content). */
const SEED_FILES: Record<string, string> = {
  [GIT_PATHS.modifiedFile]: 'export const Button = () => null\n',
  [GIT_PATHS.deletedFile]: 'export const helper = () => 1\n',
  [GIT_PATHS.utilsKeep]: 'export const keep = true\n',
  [GIT_PATHS.renameOld]: 'export const legacy = true\n',
  // Single line, NO trailing newline, so the conflict recipe replaces exactly
  // one line on both branches and git cannot auto-merge.
  [GIT_PATHS.conflictFile]: 'original guide line',
  [GIT_PATHS.cleanFile]: '# Readme\n\nUntouched.\n',
  [GIT_PATHS.cleanFolderFile]: 'export const keep = true\n'
}

/**
 * Apply every change state to an already-initialised repo. Order is documented
 * and independent across states (the conflict is produced last because it
 * leaves the repo MERGING).
 */
function applyMutations(repo: string): void {
  // modified: overwrite a tracked file's content.
  writeFileTree(repo, GIT_PATHS.modifiedFile, 'export const Button = () => <div />\n')

  // untracked: brand-new file, never added.
  writeFileTree(repo, GIT_PATHS.untrackedFile, 'export const Card = () => null\n')

  // deleted: remove a tracked file from the worktree (unstaged deletion).
  deleteFile(repo, GIT_PATHS.deletedFile)

  // staged: new file added to the index.
  writeFileTree(repo, GIT_PATHS.stagedFile, 'export const staged = 1\n')
  runGit(repo, 'add', GIT_PATHS.stagedFile)

  // rename: `git mv` → coupled to the worker's `--no-renames`, this is
  // observed as deleted(old) + staged(new), not a single renamed row.
  runGit(repo, 'mv', GIT_PATHS.renameOld, GIT_PATHS.renameNew)

  // conflicted: real MERGING state with `UU docs/guide.md`.
  createMergeConflict(repo, GIT_PATHS.conflictFile, {
    branch: 'feature',
    featureLine: 'feature guide line',
    mainLine: 'main guide line'
  })

  // Settle gate precondition: the conflict MUST be present before the app opens.
  const status = porcelainStatus(repo)
  if (!/UU\s+docs\/guide\.md/.test(status)) {
    throw new Error(
      `git-project fixture: expected "UU docs/guide.md" in status before launch, got:\n${status}`
    )
  }
}

type GitProjectFixtures = {
  /** Temp repo path, fully seeded + mutated before the value is yielded. */
  gitTestProject: { path: string }
  /** Electron window with the seeded repo opened, git status settled. */
  windowWithGitProject: Page
}

export const test = base.extend<GitProjectFixtures>({
  // eslint-disable-next-line no-empty-pattern
  gitTestProject: async ({}, use) => {
    const e2eTempDir = path.join(PROJECT_ROOT, '.e2e-temp')
    await fs.promises.mkdir(e2eTempDir, { recursive: true })
    const repo = await fs.promises.mkdtemp(path.join(e2eTempDir, 'git-'))

    initRepoWithCommit(repo, SEED_FILES)
    applyMutations(repo)

    await use({ path: repo })

    // Teardown: caller closes the app first (windowWithGitProject depends on
    // this fixture, so its teardown runs before ours). Force + retry survives
    // Windows EBUSY from lingering `.git` / MERGING handles.
    try {
      await fs.promises.rm(repo, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      console.warn('[git-project teardown] repo cleanup failed:', error)
    }
  },

  windowWithGitProject: async ({ userDataDir, gitTestProject }, use) => {
    const app: ElectronApplication = await electron.launch({
      args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'development' }
    })

    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })

    // Open the repo via IPC (main does not parse a project path from argv; same
    // pattern as windowWithTestProject in index.ts).
    await window.evaluate(async (projectPath: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).api.file.openProjectByPath(projectPath)
    }, gitTestProject.path)

    await byTestId(window, TEST_IDS.PROJECT_TREE).waitFor({ state: 'visible', timeout: 15000 })

    // Mandatory manual refresh: forces a status read on demand rather than
    // relying on the initial-load timing.
    await byTestId(window, TEST_IDS.PROJECT_TREE_BTN_REFRESH).click()

    // GIT-STATUS SETTLE GATE: wait until git decorations have rendered.
    // No changed FILE lives directly at the repo root (README.md is clean), and
    // a file row only mounts once its folder is expanded. The top-level `src`
    // FOLDER, however, is visible immediately and must carry a bubbled dot once
    // status settles — so gate on its dot. Located by `data-path` suffix +
    // `data-git-status` (NOT the path-hashed test-id, whose drive-letter casing
    // can differ from the temp dir on Windows). This proves the renderer
    // consumed the worker's status before any assertions run.
    // `data-git-status` lives on the `.git-status-dot` CHILD span, not on the
    // `.project-tree-item` row (which carries data-path/data-type). Escape the
    // separator: a lone backslash is a CSS escape char.
    const srcSuffix = `${sep}src`.replace(/\\/g, '\\\\')
    const srcDot = window.locator(
      `.project-tree-item[data-type="directory"][data-path$="${srcSuffix}"] .git-status-dot`
    )
    await expect(srcDot).toBeVisible({ timeout: 15000 })

    await use(window)

    // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
    await new Promise((resolve) => setTimeout(resolve, 100))
    try {
      await app.close()
    } catch (error) {
      console.warn('[git-project teardown] app.close() failed:', error)
    }
  }
})

export { expect }

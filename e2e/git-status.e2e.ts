// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: Git change statuses render in the Project Tree.
 *
 * Scope: this is INTEGRATION / WIRING coverage — it proves the live pipeline
 * (native `git status` in the worker → IPC → useGitStatus store →
 * calculateFolderStatuses → ProjectTreeNode → GitStatusBadge DOM) decorates
 * files with letter-badges and folders with priority-bubbled dots.
 *
 * It is NOT the cross-platform #237 regression guard: the canonical guard for
 * the Windows backslash folder-path bug is the unit suite in
 * `src/renderer/src/utils/gitStatus.logic.test.ts`, which exercises both `/`
 * and `\` separators deterministically on any host. This E2E only happens to
 * traverse the backslash branch when run on a Windows host, and `e2e.yml` is
 * CI-disabled — so treat this as a local wiring smoke, not the separator guard.
 *
 * Single Electron launch; assertions are split into labelled `test.step()`
 * blocks so a failure pinpoints which facet (file badges / folder dots /
 * priority bubbling / negatives) regressed.
 */

import { test, GIT_PATHS } from './fixtures/git-project'
import { ProjectTreePage } from './pages/project-tree.page'
import { isGitAvailable } from './utils/git-helpers'

test.describe('Project Tree git status decorations', () => {
  test('renders file badges, folder dots, and priority bubbling', async ({
    windowWithGitProject
  }) => {
    const tree = new ProjectTreePage(windowWithGitProject)

    // The fixture shells real `git`, so a binary is present; this guards only
    // the conflicted assertions, which REQUIRE the native-git strategy (the
    // isomorphic-git fallback cannot emit `conflicted`/`UU` rows).
    const gitPresent = isGitAvailable()

    await test.step('file badges reflect each working-tree change', async () => {
      // Expand the folders that contain each changed file so their rows mount.
      await tree.expandTo(['src', 'src/components', 'src/components/Button'])
      await tree.expectStatus(tree.gitBadge(GIT_PATHS.modifiedFile), 'modified')

      await tree.expandTo(['src/components/Card'])
      await tree.expectStatus(tree.gitBadge(GIT_PATHS.untrackedFile), 'untracked')

      // Staged new file lives directly under src/ (already expanded above).
      await tree.expectStatus(tree.gitBadge(GIT_PATHS.stagedFile), 'staged')

      // Rename via `git mv` under the worker's `--no-renames` is observed as a
      // deleted OLD path + a staged NEW path. Only the NEW path has an on-disk
      // tree node, so its `staged` badge is the observable file-level signal
      // (assert data-git-status only, never a staged boolean). The deleted OLD
      // path — like any deleted file — has NO file node, so it is asserted via
      // the parent folder dot in the bubbling step below.
      await tree.expandTo(['src/legacy'])
      await tree.expectStatus(tree.gitBadge(GIT_PATHS.renameNew), 'staged')
    })

    await test.step('folder dots appear on every ancestor of a changed file (#237 wiring)', async () => {
      // Each leaf folder bubbles its single changed file's status. Deleted
      // files (helper.ts; the rename old path) have no FILE node, so the folder
      // dot is the only place their `deleted` status surfaces.
      await tree.expectStatus(tree.gitDot('src/components/Button'), 'modified')
      await tree.expectStatus(tree.gitDot('src/components/Card'), 'untracked')
      await tree.expectStatus(tree.gitDot('src/utils'), 'deleted')
    })

    await test.step('folder dots bubble the highest-priority descendant status', async () => {
      // src/components mixes modified (3) + untracked (2) → modified wins.
      await tree.expectStatus(tree.gitDot('src/components'), 'modified')

      // Priority-1 tie context: src/legacy holds only a `git mv` (deleted old +
      // staged new). Deleted (4) outranks staged (1), so the legacy folder dot
      // is deleted — documenting the emitted bubbled status for the rename case.
      await tree.expectStatus(tree.gitDot('src/legacy'), 'deleted')

      // src/ aggregates deleted (4, from helper.ts + the rename old path),
      // modified (3), untracked (2), staged (1). The conflict lives under docs/,
      // NOT src/, so src/ bubbles to its own max: deleted.
      await tree.expectStatus(tree.gitDot('src'), 'deleted')

      if (gitPresent) {
        // Conflicted (5) is the global max and requires the native-git strategy
        // (iso fallback emits no `conflicted` rows); the fixture shells git so a
        // binary is present. The repo root sees the docs/ conflict, so the root
        // folder and docs/ both bubble to conflicted.
        await tree.expectStatus(tree.gitDotRoot(), 'conflicted')

        await tree.expandTo(['docs'])
        await tree.expectStatus(tree.gitBadge(GIT_PATHS.conflictFile), 'conflicted')
        await tree.expectStatus(tree.gitDot('docs'), 'conflicted')
      } else {
        test.skip(true, 'conflicted status requires a native git binary (iso fallback emits none)')
      }
    })

    await test.step('clean file and clean folder carry no decoration', async () => {
      // README.md is committed and untouched → no badge.
      await tree.expectNoStatus(tree.fileRow(GIT_PATHS.cleanFile))

      // src/clean has no changed descendant → no dot. The folder row is mounted
      // because src/ is expanded; assert the absence of any decoration on it.
      await tree.expectNoStatus(tree.folderRow('src/clean'))
    })
  })
})

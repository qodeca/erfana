// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git helpers for E2E fixtures.
 *
 * Thin synchronous wrappers around the `git` CLI for SEEDING a temporary
 * repository into a known set of change states BEFORE the Electron app opens.
 * These run in the Playwright/node fixture process (never in the renderer).
 *
 * Why shell git (not isomorphic-git):
 *  - The production worker prefers native `git status --porcelain --no-renames
 *    -uall`; only native git emits `conflicted` (`UU`) rows. The iso fallback
 *    cannot reproduce a merge-conflict matrix, so to exercise the conflicted
 *    badge/dot we must produce a real on-disk MERGING state with the same
 *    binary the worker will read.
 *  - Mirroring autocrlf/safecrlf config locally keeps the seeded worktree
 *    byte-identical across platforms, so the status the app reads is the
 *    status we intended (no CRLF false-positives on Windows hosts).
 */

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Run a git command, keyed on EXIT CODE ONLY.
 *
 * `git` writes informational text to stderr on success (e.g. autocrlf
 * warnings, "Switched to branch", merge progress). Treating any stderr as
 * failure would spuriously fail seeding, so success is `execFileSync` not
 * throwing (non-zero exit throws). Returns trimmed stdout.
 *
 * @throws when git exits non-zero (caller can catch to assert expected
 *   failures, e.g. a merge that MUST conflict).
 */
export function runGit(cwd: string, ...args: string[]): string {
  const stdout = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    // Merge conflicts / hook output can be large; give generous headroom.
    maxBuffer: 10 * 1024 * 1024,
    // Pipe stderr so a thrown error carries git's message for diagnostics,
    // but never inspect it for success — exit code is the only signal.
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return stdout.trim()
}

/**
 * Initialise a repo on the `main` branch with one initial commit containing
 * `files` (relative-path → content). Creates intermediate directories.
 *
 * All git identity / line-ending config is set LOCALLY (repo-scoped) so the
 * helper never mutates the host's global git config and the seeded worktree
 * is deterministic regardless of the host's `core.autocrlf` default.
 */
export function initRepoWithCommit(cwd: string, files: Record<string, string>): void {
  runGit(cwd, 'init', '-b', 'main')
  runGit(cwd, 'config', 'user.email', 'e2e@erfana.test')
  runGit(cwd, 'config', 'user.name', 'Erfana E2E')
  // Deterministic, platform-independent worktree bytes.
  runGit(cwd, 'config', 'core.autocrlf', 'false')
  runGit(cwd, 'config', 'core.safecrlf', 'false')

  for (const [rel, content] of Object.entries(files)) {
    writeFileTree(cwd, rel, content)
  }

  runGit(cwd, 'add', '-A')
  runGit(cwd, 'commit', '-m', 'init')
}

/**
 * Write a file relative to `cwd`, creating parent directories. Guards against
 * path traversal so a malformed fixture key cannot escape the temp repo.
 */
export function writeFileTree(cwd: string, rel: string, content: string): void {
  const resolved = path.resolve(cwd, rel)
  const relCheck = path.relative(path.resolve(cwd), resolved)
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new Error(`git-helpers: refusing to write outside repo: "${rel}"`)
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, content, 'utf8')
}

/** Delete a tracked file from the worktree (produces an unstaged ` D` deletion). */
export function deleteFile(cwd: string, rel: string): void {
  fs.rmSync(path.resolve(cwd, rel), { force: true })
}

/**
 * Produce a real merge conflict on a single-line file, leaving the repo in a
 * MERGING state with `UU <file>` in `git status --porcelain`.
 *
 * Recipe (all on `main` as the final checked-out branch):
 *  1. `file` is already committed on main with `baseLine`.
 *  2. Branch `feature`; replace the line with `featureLine`; commit.
 *  3. Checkout main; replace the SAME line with `mainLine`; commit.
 *  4. `git merge feature` → MUST conflict (non-zero exit).
 *
 * @returns true if the merge conflicted as required.
 * @throws if the merge unexpectedly succeeds (no conflict produced).
 */
export function createMergeConflict(
  cwd: string,
  rel: string,
  opts: { branch: string; featureLine: string; mainLine: string }
): boolean {
  const { branch, featureLine, mainLine } = opts

  runGit(cwd, 'checkout', '-b', branch)
  writeFileTree(cwd, rel, featureLine)
  runGit(cwd, 'commit', '-am', `${branch}: edit ${rel}`)

  runGit(cwd, 'checkout', 'main')
  writeFileTree(cwd, rel, mainLine)
  runGit(cwd, 'commit', '-am', `main: edit ${rel}`)

  let conflicted = false
  try {
    runGit(cwd, 'merge', branch)
  } catch {
    // Expected: merge exits non-zero on conflict. Verify the conflict shape.
    conflicted = true
  }
  if (!conflicted) {
    throw new Error(`createMergeConflict: merge of "${branch}" did not conflict for "${rel}"`)
  }
  return conflicted
}

/** Return porcelain status lines (stable, machine-readable) for assertions. */
export function porcelainStatus(cwd: string): string {
  return runGit(cwd, 'status', '--porcelain')
}

/** True if a working `git` binary is on PATH (gate for conflicted-status tests). */
export function isGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Portable cross-platform replacement for the former bash `test:cov` script.
//
// Responsibilities:
//   1. Remove any previous `coverage/` output.
//   2. Stash the existing `out/` directory (if any) into `temp/.out_backup`.
//      electron-vite writes to `out/`; vitest with coverage can clobber it,
//      so we preserve it for the developer.
//   3. Run vitest with coverage for each workspace project (main, preload, renderer),
//      scoped with `--project <name>` to match the CI Coverage job.
//   4. Always restore the `out/` directory from the backup, even on failure.
//   5. Exit non-zero if any pass failed, naming every project that missed a floor.
//
// This script replaces a bash one-liner that could not run on Windows
// (issue #153 — Phase 0 of the Windows enablement roadmap).
//
// Issue #133: each per-project config auto-discovers `vitest.workspace.ts`, so a
// bare `--config vitest.<project>.ts` run expands to ALL THREE projects. Without
// `--project`, one `test:cov` invocation executed the whole suite three times.
// `--project` is therefore load-bearing, exactly as it is in checks.yml.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { projects, coverageArgs } from './lib/test-cov-projects.mjs'

const root = resolve(process.cwd())
const coverageDir = resolve(root, 'coverage')
const outDir = resolve(root, 'out')
const tempDir = resolve(root, 'temp')
const backupDir = resolve(tempDir, '.out_backup')

// The three workspace projects (and the `--project` scoping that keeps each
// pass to its own suite) live in ./lib/test-cov-projects.mjs, so the regression
// test can assert them without importing this runner.

/**
 * Run one project's coverage pass.
 *
 * Returns `null` on success, or a failure descriptor. It never throws: a failed
 * pass must not stop the remaining projects, because one project's missed floor
 * must not hide the other two's (issue #133).
 */
function runPass(npx, project) {
  const args = coverageArgs(project)
  const result = spawnSync(npx, args, { stdio: 'inherit', shell: false })
  if (result.status === 0) return null
  const code = typeof result.status === 'number' ? result.status : 1
  return { project: project.name, code, command: `${npx} ${args.join(' ')}` }
}

function stashOut() {
  if (!existsSync(outDir)) return false
  mkdirSync(tempDir, { recursive: true })
  // If a previous run crashed and left a stale backup, drop it.
  if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true })
  renameSync(outDir, backupDir)
  return true
}

function restoreOut(stashed) {
  if (!stashed) return
  if (!existsSync(backupDir)) return
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  renameSync(backupDir, outDir)
}

async function main() {
  // Step 1: clean previous coverage output.
  if (existsSync(coverageDir)) rmSync(coverageDir, { recursive: true, force: true })

  // Step 2: stash `out/` so vitest coverage runs don't clobber the dev build.
  const stashed = stashOut()

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const failures = []

  try {
    // Step 3: run coverage once per workspace project, scoped with `--project`.
    for (const project of projects) {
      const failure = runPass(npx, project)
      if (!failure) continue
      // Name the project as soon as it fails, then keep going.
      console.error(
        `\nFAILED: ${project.name} coverage (exit ${failure.code}): ${failure.command}`
      )
      failures.push(failure)
    }
  } finally {
    // Step 4: always restore the dev build directory.
    restoreOut(stashed)
  }

  // Step 5: fail the run if any project missed a floor, naming each one. The
  // vitest threshold errors above say which file and which axis; this line says
  // which project, so a redirected or truncated log still points at the floor.
  if (failures.length > 0) {
    const names = failures.map((failure) => failure.project).join(', ')
    console.error(`\nCoverage FAILED for project(s): ${names}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exitCode = 1
})

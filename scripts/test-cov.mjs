#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Portable cross-platform replacement for the former bash `test:cov` script.
//
// Responsibilities:
//   1. Remove any previous `coverage/` output.
//   2. Stash the existing `out/` directory (if any) into `temp/.out_backup`.
//      electron-vite writes to `out/`; vitest with coverage can clobber it,
//      so we preserve it for the developer.
//   3. Run vitest with coverage for each workspace project (main, preload, renderer).
//   4. Always restore the `out/` directory from the backup, even on failure.
//
// This script replaces a bash one-liner that could not run on Windows
// (issue #153 — Phase 0 of the Windows enablement roadmap).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const coverageDir = resolve(root, 'coverage')
const outDir = resolve(root, 'out')
const tempDir = resolve(root, 'temp')
const backupDir = resolve(tempDir, '.out_backup')

/** Run a command and exit the parent process on failure. */
function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false })
  if (result.status !== 0) {
    const code = typeof result.status === 'number' ? result.status : 1
    throw new Error(`Command failed (${code}): ${cmd} ${args.join(' ')}`)
  }
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

  try {
    // Step 3: run coverage for each workspace project.
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    run(npx, ['vitest', '--run', '--config', 'vitest.main.ts', '--coverage'])
    run(npx, ['vitest', '--run', '--config', 'vitest.preload.ts', '--coverage'])
    run(npx, ['vitest', '--run', '--config', 'vitest.renderer.ts', '--coverage'])
  } finally {
    // Step 4: always restore the dev build directory.
    restoreOut(stashed)
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exitCode = 1
})

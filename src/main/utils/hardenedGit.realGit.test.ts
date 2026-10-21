// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real-git check of the hardening prefix itself.
 *
 * Git for Windows rejects `include.path=\\.\nul` (the Node `devNull` value on
 * Windows) with exit 128, which made every native status fall back to the slow
 * reader and the HTML preview's gitignore check fail open. The unit suite only
 * compares argv, so this runs the prefix against the installed git on every host.
 * Skipped when no git binary is found.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GIT_INCLUDE_OVERRIDE,
  buildHardeningArgs,
  hardenedSpawnOptions,
  listIsolationConfig,
  resolveGitBinary
} from './hardenedGit'

const execFileAsync = promisify(execFile)

const GIT_PATH = await resolveGitBinary()

describe.skipIf(GIT_PATH === null)('hardenedGit – against the installed git', () => {
  let repo: string

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'erfana-hardened-git-'))
    await execFileAsync(GIT_PATH as string, ['init', '--quiet', repo], hardenedSpawnOptions())
  })

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  it('uses an include path that git accepts on this platform', () => {
    expect(GIT_INCLUDE_OVERRIDE).toBe('include.path=/dev/null')
  })

  it('runs a config read under the hardening prefix without a fatal exit', async () => {
    const { stdout } = await execFileAsync(
      GIT_PATH as string,
      [...buildHardeningArgs(repo), 'config', '--get', 'core.bare'],
      hardenedSpawnOptions()
    )
    expect(stdout.trim()).toBe('false')
  })

  it('lists the isolation config of a plain repository (no fallback)', async () => {
    expect(await listIsolationConfig(GIT_PATH as string, repo)).not.toBeNull()
  })
})

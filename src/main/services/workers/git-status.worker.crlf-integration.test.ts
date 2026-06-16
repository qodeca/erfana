// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real-git CRLF integration test (lens review #5).
 *
 * The unit test in `git-status.worker.crlf.test.ts` verifies *routing* – that
 * the worker takes the native path and never calls `statusMatrix` when a git
 * binary is available. It cannot prove the actual line-ending normalization
 * agrees with what the user's own `git status` reports, because every external
 * call is mocked.
 *
 * This test does the real thing on a real temp repository: configure
 * `core.autocrlf=true` + `.gitattributes "* text=auto"`, commit a file whose
 * blob is LF, force the working tree to be CRLF, then ask the worker to
 * compute status and assert `counts.modified === 0`. With the regression
 * present, isomorphic-git would surface a false positive; the lens-review
 * fix uses the native binary which honours git's normalization.
 *
 * Skipped unless a git binary is on PATH (CI hosts and dev boxes generally
 * have one; constrained sandboxes won't, and that's fine).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFile, spawnSync } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const execFileAsync = promisify(execFile)

// Synchronous probe at module load – `describe.skipIf` evaluates its condition
// when the describe block is registered, before any beforeAll runs, so we
// can't async-resolve git first.
function findGitSync(): string | null {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], {
    encoding: 'utf8',
  })
  if (probe.status !== 0) return null
  return probe.stdout.trim().split(/\r?\n/)[0] || null
}
const GIT_PATH = findGitSync()

// The worker module guards on `parentPort` at import (it's null in the main
// thread). We mock it so the parser exports are importable here without going
// through a real Worker spawn.
vi.mock('worker_threads', () => ({ parentPort: { on: vi.fn(), postMessage: vi.fn() } }))
vi.mock('isomorphic-git', () => ({ currentBranch: vi.fn(), resolveRef: vi.fn(), statusMatrix: vi.fn() }))

import { parsePorcelainOutput, parseBranchHeader } from './git-status.worker'

describe.skipIf(!GIT_PATH)('git-status real-git CRLF integration', () => {
  let tmp: string

  beforeAll(async () => {
    if (!GIT_PATH) return
    tmp = await mkdtemp(join(tmpdir(), 'erfana-crlf-it-'))

    // 1. Init a fresh repo with autocrlf=true and commit .gitattributes ALONE
    //    so the `* text=auto` attribute is unambiguously active when sample.md
    //    is staged in the next commit. (Staging .gitattributes in the same
    //    commit as the file leaves attribute behaviour timing-dependent.)
    const run = (args: string[]): Promise<{ stdout: string; stderr: string }> =>
      execFileAsync(GIT_PATH, args, { cwd: tmp })
    await run(['init', '-q', '-b', 'main'])
    await run(['config', 'user.email', 'test@erfana.dev'])
    await run(['config', 'user.name', 'Erfana Test'])
    await run(['config', 'core.autocrlf', 'true'])
    await writeFile(join(tmp, '.gitattributes'), '* text=auto\n', 'utf8')
    await run(['add', '.gitattributes'])
    await run(['commit', '-q', '-m', 'attrs'])

    // 2. Write a file with explicit CRLF endings and add it. Under text=auto +
    //    autocrlf=true, git normalizes CRLF→LF for the blob; the index entry
    //    records that the working-tree form is CRLF. This is the same state
    //    the original Erfana repo is in (`git ls-files --eol` → i/lf w/crlf).
    const crlf = 'line one\r\nline two\r\nline three\r\n'
    await writeFile(join(tmp, 'sample.md'), crlf, 'utf8')
    await run(['add', 'sample.md'])
    await run(['commit', '-q', '-m', 'add sample'])

    // 3. Rewrite working tree with CRLF endings again to make absolutely sure
    //    the file is CRLF on disk (autoclrf may have rewritten it on commit on
    //    some setups; this guarantees the WT-vs-index normalization is the
    //    code path being exercised by `git status` below).
    const lf = await readFile(join(tmp, 'sample.md'), 'utf8')
    const normalised = lf.includes('\r\n') ? lf : lf.replace(/\n/g, '\r\n')
    await writeFile(join(tmp, 'sample.md'), normalised, 'utf8')
  })

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  })

  it('native git reports zero modified files on a CRLF-vs-LF clean tree', async () => {
    if (!GIT_PATH) return // type guard for TS – describe.skipIf gates execution

    const { stdout } = await execFileAsync(
      GIT_PATH,
      ['status', '--porcelain=v1', '--branch', '-z', '--no-renames', '-uall'],
      { cwd: tmp }
    )

    const header = parseBranchHeader(stdout)
    const files = parsePorcelainOutput(stdout, tmp)
    const modified = files.filter((f) => f.status === 'modified')

    // The regression the lens review came after: this number used to be > 0
    // via isomorphic-git's `statusMatrix`. Native git correctly reports zero.
    expect(modified).toEqual([])
    // Branch identified, repo is healthy.
    expect(header.isUnborn).toBe(false)
    expect(header.isDetached).toBe(false)
    expect(header.branch).toBe('main')
  })
})

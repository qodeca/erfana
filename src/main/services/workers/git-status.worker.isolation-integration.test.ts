// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real-git isolation test for the native status path.
 *
 * A repository can declare commands in its own config (`core.fsmonitor`, a
 * `.gitattributes` filter driver, an included config file) and in `.git/hooks`.
 * Opening such a folder must not run any of them. Each case wires a script that
 * writes a marker file, first proves the plain `git status` WOULD run it (so the
 * test cannot pass vacuously), then runs the worker's native status and asserts
 * the marker never appears while the reported files stay correct.
 *
 * POSIX only: the scripts are `sh`. Skipped when no git binary is on PATH.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFile, spawnSync } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, mkdir, rm, writeFile, chmod, access } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const execFileAsync = promisify(execFile)

function findGitSync(): string | null {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], {
    encoding: 'utf8',
  })
  if (probe.status !== 0) return null
  return probe.stdout.trim().split(/\r?\n/)[0] || null
}
const GIT_PATH = findGitSync()
// Windows-only gap: the marker scripts are `sh` and need POSIX exec semantics.
const CAN_RUN = GIT_PATH !== null && process.platform !== 'win32'

vi.mock('worker_threads', () => ({ parentPort: { on: vi.fn(), postMessage: vi.fn() } }))
vi.mock('isomorphic-git', () => ({ currentBranch: vi.fn(), resolveRef: vi.fn(), statusMatrix: vi.fn() }))

import { executeNativeGit } from './git-status.worker'
import { buildHardeningArgs, hardenedSpawnOptions } from '../../utils/hardenedGit'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe.skipIf(!CAN_RUN)('git-status native path – repository config isolation', () => {
  let sandbox: string
  let repo: string
  let markers: string

  const git = (args: string[]): Promise<{ stdout: string; stderr: string }> =>
    execFileAsync(GIT_PATH as string, args, { cwd: repo })

  async function script(name: string, body: string): Promise<string> {
    const path = join(sandbox, name)
    await writeFile(path, `#!/bin/sh\n${body}\n`, 'utf8')
    await chmod(path, 0o755)
    return path
  }

  /** Re-dirty the tracked file so status must re-read it (clean filter / index refresh). */
  async function dirtyWorktree(): Promise<void> {
    // Same byte length as the committed "original\n": git only runs the clean filter when the
    // size matches but the stat data differs (a size change is reported as modified outright).
    const digits = String(Math.floor(Math.random() * 1e7)).padStart(7, '0')
    await writeFile(join(repo, 'tracked.txt'), `v${digits}\n`, 'utf8')
    await writeFile(join(repo, 'untracked.md'), 'new\n', 'utf8')
  }

  async function firedMarkers(): Promise<string[]> {
    const fired: string[] = []
    for (const name of ['fsmonitor', 'clean', 'smudge', 'process', 'hook', 'include']) {
      if (await exists(join(markers, name))) fired.push(name)
    }
    return fired
  }

  async function clearMarkers(): Promise<void> {
    await rm(markers, { recursive: true, force: true })
    await mkdir(markers, { recursive: true })
  }

  beforeAll(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'erfana-isolation-it-'))
    repo = join(sandbox, 'repo')
    markers = join(sandbox, 'markers')
    await mkdir(repo, { recursive: true })
    await mkdir(markers, { recursive: true })

    await git(['init', '-q', '-b', 'main'])
    await git(['config', 'user.email', 'test@erfana.dev'])
    await git(['config', 'user.name', 'Erfana Test'])
    await writeFile(join(repo, 'tracked.txt'), 'original\n', 'utf8')
    await git(['add', 'tracked.txt'])
    await git(['commit', '-q', '-m', 'initial'])

    // (a) fsmonitor hook named by the repo config.
    const fsmonitor = await script('fsmonitor.sh', `echo x >> "${markers}/fsmonitor"\nexit 1`)
    await git(['config', 'core.fsmonitor', fsmonitor])

    // (b) filter driver (clean, smudge and long-running process) selected via .gitattributes.
    const clean = await script('clean.sh', `echo x >> "${markers}/clean"\ncat`)
    const smudge = await script('smudge.sh', `echo x >> "${markers}/smudge"\ncat`)
    const proc = await script('process.sh', `echo x >> "${markers}/process"\nexit 1`)
    await writeFile(join(repo, '.gitattributes'), '*.txt filter=evil\n', 'utf8')
    await git(['config', 'filter.evil.clean', clean])
    await git(['config', 'filter.evil.smudge', smudge])
    await git(['config', 'filter.evil.process', proc])

    // (c) hook that git runs when a status refresh rewrites the index.
    await mkdir(join(repo, '.git', 'hooks'), { recursive: true })
    const hook = join(repo, '.git', 'hooks', 'post-index-change')
    await writeFile(hook, `#!/bin/sh\necho x >> "${markers}/hook"\n`, 'utf8')
    await chmod(hook, 0o755)

    // (d) config pulled in through an include, defining another fsmonitor command.
    const includeFsmonitor = await script('include-fsmonitor.sh', `echo x >> "${markers}/include"\nexit 1`)
    const included = join(sandbox, 'included.gitconfig')
    await writeFile(included, `[core]\n\tfsmonitor = ${includeFsmonitor}\n`, 'utf8')
    await git(['config', '--add', 'include.path', included])
  })

  afterAll(async () => {
    if (sandbox) await rm(sandbox, { recursive: true, force: true })
  })

  it('control: a plain status in this repo does run the configured commands', async () => {
    await clearMarkers()
    await dirtyWorktree()
    // process.sh writes its marker and exits before git's long-running filter handshake. Some
    // git builds treat that dead filter process as fatal ("the remote end hung up unexpectedly",
    // exit 128) where others carry on, so the exit code is not the signal here – the markers are.
    // Both markers asserted below are written before that point (the fsmonitor runs first, and
    // process.sh writes its marker before it exits), so they fire on either kind of git.
    await git(['status', '--porcelain']).catch(() => undefined)

    const fired = await firedMarkers()
    // The included fsmonitor (listed last) overrides the direct one, so either marker proves
    // the fsmonitor vector is live; the filter vector must be live too, or the test below
    // proves nothing.
    expect(fired.some((m) => m === 'fsmonitor' || m === 'include')).toBe(true)
    // A configured `process` driver takes precedence over `clean`/`smudge`.
    expect(fired.some((m) => m === 'process' || m === 'clean')).toBe(true)
  })

  it('native status runs none of them and still reports the right files', async () => {
    await clearMarkers()
    await dirtyWorktree()

    const result = await executeNativeGit(repo, GIT_PATH as string)

    expect(result.error).toBeUndefined()
    expect(await firedMarkers()).toEqual([])
    expect(result.isGitRepo).toBe(true)
    expect(result.branch).toBe('main')
    const byName = new Map(result.files.map((f) => [f.path.slice(repo.length + 1), f.status]))
    expect(byName.get('tracked.txt')).toBe('modified')
    expect(byName.get('untracked.md')).toBe('untracked')
  })
})

// (e) A promisor remote makes git fetch objects it cannot find through a child process that
// reads the repo's own `remote.<n>.uploadpack`. The HEAD tree is deleted so status needs it.
describe.skipIf(!CAN_RUN)('git-status native path – promisor remote isolation', () => {
  let sandbox: string
  let repo: string
  let marker: string

  const git = (args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ stdout: string; stderr: string }> =>
    execFileAsync(GIT_PATH as string, args, { cwd: repo, env })

  beforeAll(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'erfana-promisor-it-'))
    repo = join(sandbox, 'repo')
    marker = join(sandbox, 'uploadpack-marker')
    await mkdir(repo, { recursive: true })

    await git(['init', '-q', '-b', 'main'])
    await git(['config', 'user.email', 'test@erfana.dev'])
    await git(['config', 'user.name', 'Erfana Test'])
    await writeFile(join(repo, 'tracked.txt'), 'original\n', 'utf8')
    await git(['add', 'tracked.txt'])
    await git(['commit', '-q', '-m', 'initial'])

    const uploadpack = join(sandbox, 'uploadpack.sh')
    await writeFile(uploadpack, `#!/bin/sh\necho x >> "${marker}"\nexit 1\n`, 'utf8')
    await chmod(uploadpack, 0o755)
    await git(['config', 'remote.origin.url', join(sandbox, 'elsewhere')])
    await git(['config', 'remote.origin.uploadpack', uploadpack])
    await git(['config', 'remote.origin.promisor', 'true'])
    await git(['config', 'remote.origin.partialclonefilter', 'blob:none'])
    await git(['config', 'extensions.partialclone', 'origin'])

    // Drop the loose HEAD tree so the next status has to go and get it.
    const { stdout } = await git(['rev-parse', 'HEAD^{tree}'])
    const sha = stdout.trim()
    const objectPath = join(repo, '.git', 'objects', sha.slice(0, 2), sha.slice(2))
    await chmod(objectPath, 0o644)
    await rm(objectPath)
  })

  afterAll(async () => {
    if (sandbox) await rm(sandbox, { recursive: true, force: true })
  })

  it('control: a plain status in this repo does run the remote helper', async () => {
    await rm(marker, { force: true })
    await git(['status', '--porcelain']).catch(() => undefined)

    // If the installed git does not lazy-fetch here, the guards below stay as regression guards.
    console.info(`lazy-fetch recipe reproduced with this git: ${await exists(marker)}`)
  })

  it('native status never runs the remote helper', async () => {
    await rm(marker, { force: true })

    await executeNativeGit(repo, GIT_PATH as string)

    expect(await exists(marker)).toBe(false)
  })

  it('the hardened env alone blocks the fetch even if the config check were bypassed', async () => {
    await rm(marker, { force: true })

    await execFileAsync(
      GIT_PATH as string,
      [...buildHardeningArgs(repo), 'status', '--porcelain=v1'],
      hardenedSpawnOptions()
    ).catch(() => undefined)

    expect(await exists(marker)).toBe(false)
  })
})

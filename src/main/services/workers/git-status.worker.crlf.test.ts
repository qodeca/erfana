// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Regression: git status CRLF false-positives.
 *
 * Native `git status --porcelain` is the source of truth for "modified" status
 * because it honours core.autocrlf / .gitattributes line-ending normalization.
 * isomorphic-git's `statusMatrix()` hashes the raw working-tree bytes and would
 * flag every file whose worktree is CRLF but whose index blob is LF (the Windows
 * `autocrlf=true` case) as "modified", even though `git status` reports the tree
 * clean.
 *
 * These tests pin that, when a git binary is available, the worker uses the
 * native path and NEVER calls `statusMatrix` – so a clean repo reports zero
 * modified files regardless of line endings.
 *
 * Harness mirrors git-resolver.test.ts: hoisted mocks for worker_threads,
 * fs/promises, isomorphic-git, child_process; the worker is driven through its
 * `parentPort` message boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve } from 'path'

const hoisted = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events') as typeof import('events')
  class FakePort extends EventEmitter {
    postMessage = vi.fn()
  }
  return {
    mockParentPort: new FakePort(),
    mockAccess: vi.fn(),
    mockStatusMatrix: vi.fn(),
    mockRun: vi.fn() as ReturnType<typeof vi.fn>,
  }
})
// NOTE: vi.mock factories reference `hoisted.*` (not the destructured consts)
// because the static `import` of the worker below loads the module during
// hoisting, before the `const { ... } = hoisted` line has run. `vi.hoisted`
// guarantees `hoisted` is initialized first.
const { mockParentPort, mockAccess, mockStatusMatrix, mockRun } = hoisted

vi.mock('worker_threads', () => ({ parentPort: hoisted.mockParentPort }))

vi.mock('fs/promises', () => ({
  access: hoisted.mockAccess,
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true, isFile: () => false }),
}))

vi.mock('isomorphic-git', () => ({
  statusMatrix: hoisted.mockStatusMatrix,
  currentBranch: vi.fn().mockResolvedValue('main'),
  resolveRef: vi.fn(),
}))

vi.mock('child_process', () => {
  type Cb = (err: Error | null, out?: { stdout: string; stderr: string }) => void
  const forward = (cmd: string, args: string[], opts: unknown, cb?: Cb): void => {
    const callback = (typeof opts === 'function' ? opts : cb) as Cb
    hoisted.mockRun(cmd, args).then(
      (stdout: string) => callback(null, { stdout, stderr: '' }),
      (err: Error) => callback(err),
    )
  }
  return { execFile: forward }
})

// Static import → the worker registers its `message` listener exactly once.
import { resetGitPathCache } from './git-status.worker'

// Host-absolute, already-normalized path so the worker's path validation passes
// on both Windows (C:\...) and POSIX (/...) test hosts.
const PROJECT = resolve('/tmp/crlf-clean-repo')

/** Drive the worker's execute handler and return the postMessage payload. */
async function runExecute(
  strategy: 'native-git' | 'isomorphic-git' = 'native-git',
  id = 1
): Promise<any> {
  mockParentPort.postMessage.mockClear()
  mockParentPort.emit('message', { type: 'execute', id, projectPath: PROJECT, strategy })
  await vi.waitFor(() => expect(mockParentPort.postMessage).toHaveBeenCalled())
  return mockParentPort.postMessage.mock.calls.at(-1)![0]
}

describe('git-status.worker – CRLF clean-repo regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGitPathCache()
    // Every allowlist candidate "exists" so the binary resolves on any host...
    mockAccess.mockResolvedValue(undefined)
    // ...and native git reports a CLEAN tree on branch `main`. With the
    // combined `--porcelain=v1 --branch -z` command the only thing emitted
    // for a clean working tree is the leading branch header.
    mockRun.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === '--version') return 'git version 2.43.0\n' // resolver liveness probe (win32)
      if (args[0] === 'status') return '## main\0' // branch header only – clean tree
      if (args[0] === 'rev-parse') return 'main\n' // only used on detached HEAD
      return '/usr/bin/git\n' // where/which fallback (unused on happy path)
    })
  })

  it('reports zero modified files via native git and never calls statusMatrix', async () => {
    const msg = await runExecute('native-git')

    expect(msg.type).toBe('result')
    expect(msg.data.isGitRepo).toBe(true)
    expect(msg.data.branch).toBe('main')
    expect(msg.data.counts.modified).toBe(0)
    expect(msg.data.files).toEqual([])
    // The crux of the fix: the portable byte-hashing path is NOT used.
    expect(mockStatusMatrix).not.toHaveBeenCalled()
  })

  it('runs `git status --porcelain` rather than statusMatrix when a binary is present', async () => {
    await runExecute('native-git')

    const ranNativeStatus = mockRun.mock.calls.some((c) => (c[1] as string[])[0] === 'status')
    expect(ranNativeStatus).toBe(true)
    expect(mockStatusMatrix).not.toHaveBeenCalled()
  })
})

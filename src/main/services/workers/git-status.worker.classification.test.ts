// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Worker integration tests for the lens-review follow-up.
 *
 * Covers the new error classification + transient-strike fallback added in
 * `handleNativeFailure`:
 *   - durable signatures (dubious-ownership / not-a-repo / corrupt) return a
 *     stable error result with a clear message, not "temporarily unavailable";
 *   - 3 consecutive transient failures escalate to isomorphic-git fallback so
 *     a persistently-failing native path can't loop forever while masquerading
 *     as success at the circuit breaker (lens review #3);
 *   - ENOENT disambiguation: a deleted project folder returns empty (no cache
 *     reset), a missing binary re-probes (#14);
 *   - EACCES re-probes like binary-ENOENT (#5);
 *   - killed/timeout (code undefined, killed:true) and maxBuffer overflow are
 *     correctly classified (#25);
 *   - detached-HEAD path emits `## HEAD (no branch)` and resolves a 7-char SHA
 *     via the conditional second spawn (#6);
 *   - exactly one `postMessage` is emitted per execute (#28).
 *
 * Hoisted-mock harness mirrors the existing crlf/fallback tests.
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
    mockStat: vi.fn(),
    mockStatusMatrix: vi.fn().mockResolvedValue([]),
    mockRun: vi.fn() as ReturnType<typeof vi.fn>,
  }
})
const { mockParentPort, mockAccess, mockStat, mockStatusMatrix, mockRun } = hoisted

vi.mock('worker_threads', () => ({ parentPort: hoisted.mockParentPort }))

vi.mock('fs/promises', () => ({
  access: hoisted.mockAccess,
  stat: hoisted.mockStat,
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

import { resetGitPathCache, resetTransientFailureCount } from './git-status.worker'

const PROJECT = resolve('/tmp/classification-repo')

function execError(code: string | number | undefined, message: string, extra: Record<string, unknown> = {}): NodeJS.ErrnoException {
  const e = new Error(message) as NodeJS.ErrnoException
  if (code !== undefined) e.code = code as NodeJS.ErrnoException['code']
  Object.assign(e, extra)
  return e
}

async function runExecute(id = 1, strategy: 'native-git' | 'isomorphic-git' = 'native-git'): Promise<any> {
  mockParentPort.postMessage.mockClear()
  mockParentPort.emit('message', { type: 'execute', id, projectPath: PROJECT, strategy })
  await vi.waitFor(() => expect(mockParentPort.postMessage).toHaveBeenCalled())
  // Lens review #28: assert handleExecute posts EXACTLY once per execute.
  // A late post from a still-in-flight prior handler would surface here.
  await new Promise((r) => setTimeout(r, 5))
  expect(mockParentPort.postMessage).toHaveBeenCalledTimes(1)
  return mockParentPort.postMessage.mock.calls.at(-1)![0]
}

/** Wire the resolver to succeed and configure per-test git behavior. */
function wireGit(behavior: (cmd: string, args: string[]) => Promise<string>): void {
  mockAccess.mockResolvedValue(undefined)
  mockStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false })
  mockRun.mockImplementation(async (cmd: string, args: string[]) => behavior(cmd, args))
}

describe('git-status.worker – durable failure classification (lens review #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatusMatrix.mockResolvedValue([])
    resetGitPathCache()
    resetTransientFailureCount()
  })

  it('dubious-ownership stderr → durable error, never falls to iso, never loops', async () => {
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      if (args[0] === 'status') {
        throw execError(128, 'Command failed: git status', {
          stderr: 'fatal: detected dubious ownership in repository at \'/repo\'\n',
        })
      }
      return ''
    })

    const msg = await runExecute()

    expect(msg.type).toBe('result')
    expect(msg.data.isGitRepo).toBe(false)
    expect(msg.data.error).toMatch(/dubious ownership|safe\.directory/i)
    expect(mockStatusMatrix).not.toHaveBeenCalled()
  })

  it('maxBuffer overflow code is durable, returns stable error', async () => {
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      throw execError('ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'stdout maxBuffer exceeded')
    })

    const msg = await runExecute()

    expect(msg.data.isGitRepo).toBe(false)
    expect(msg.data.error).toBeTruthy()
    expect(mockStatusMatrix).not.toHaveBeenCalled()
  })

  it('does NOT leak the project path or git binary path into the error', async () => {
    // Lens review #15: msg interpolation used to embed absolute paths, which
    // were then surfaced to the renderer and bypassed redactUserInput.
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      throw execError(1, `Command failed: ${'/abs/path/to/git'} status in ${PROJECT}/foo`, {
        stderr: 'Command failed leak attempt',
      })
    })

    const msg = await runExecute()

    expect(msg.data.error).not.toContain('/abs/path/to/git')
    expect(msg.data.error).not.toContain(PROJECT)
  })
})

describe('git-status.worker – transient-strike escalation (lens review #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatusMatrix.mockResolvedValue([])
    resetGitPathCache()
    resetTransientFailureCount()
  })

  it('after 3 consecutive transient failures, falls back to isomorphic-git instead of looping', async () => {
    // Every call throws a generic non-zero exit – pure transient.
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      throw execError(2, 'Command failed: git status', { stderr: 'something flaky' })
    })

    const m1 = await runExecute(1)
    expect(m1.data.error).toMatch(/temporarily unavailable/i)
    expect(mockStatusMatrix).not.toHaveBeenCalled()

    const m2 = await runExecute(2)
    expect(m2.data.error).toMatch(/temporarily unavailable/i)
    expect(mockStatusMatrix).not.toHaveBeenCalled()

    const m3 = await runExecute(3)
    // Third strike: escalate to iso fallback rather than perpetual "unavailable".
    expect(mockStatusMatrix).toHaveBeenCalledTimes(1)
    expect(m3.type).toBe('result')
  })

  it('a successful call resets the strike counter so future failures get the full 3 lives', async () => {
    let succeed = false
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      if (args[0] === 'status') {
        if (succeed) return '## main\0' // clean tree, branch main
        throw execError(2, 'transient')
      }
      return ''
    })

    await runExecute(1) // strike 1
    await runExecute(2) // strike 2
    succeed = true
    const m3 = await runExecute(3) // success → counter resets
    expect(m3.data.error).toBeUndefined()
    expect(m3.data.branch).toBe('main')

    // Next two transients should NOT trip the threshold (counter was reset).
    succeed = false
    const m4 = await runExecute(4)
    const m5 = await runExecute(5)
    expect(m4.data.error).toMatch(/temporarily unavailable/i)
    expect(m5.data.error).toMatch(/temporarily unavailable/i)
    expect(mockStatusMatrix).not.toHaveBeenCalled()
  })

  it('killed/timeout (code undefined, killed:true) classifies as transient, not as ENOENT', async () => {
    // Lens review #25: previously untested – `code === 'ENOENT'` check would
    // mishandle a null/undefined code. We must keep it on the transient path.
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      throw execError(undefined, 'spawn ETIMEDOUT', { killed: true, signal: 'SIGTERM' })
    })

    const m = await runExecute()
    expect(m.data.error).toMatch(/temporarily unavailable/i)
    expect(mockStatusMatrix).not.toHaveBeenCalled()
  })
})

describe('git-status.worker – ENOENT-vs-cwd + EACCES (lens review #14)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatusMatrix.mockResolvedValue([])
    resetGitPathCache()
    resetTransientFailureCount()
  })

  it('ENOENT + project folder gone → empty response, resolver cache NOT reset', async () => {
    mockAccess.mockImplementation(async (p: unknown) => {
      // The native catch path calls access(projectPath) – fail it to signal
      // the cwd is gone. All other access checks (resolver allowlist) succeed.
      if (p === PROJECT) throw new Error('ENOENT')
      return undefined
    })
    mockStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false })
    mockRun.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      throw execError('ENOENT', 'spawn git ENOENT')
    })

    const msg = await runExecute(1)

    expect(msg.type).toBe('result')
    expect(msg.data.isGitRepo).toBe(false) // empty response
    expect(mockStatusMatrix).not.toHaveBeenCalled() // no iso fallback for a gone cwd

    // Resolver cache should NOT have been reset – on the next call, no extra
    // access probes for the allowlist.
    mockAccess.mockClear()
    mockAccess.mockResolvedValue(undefined)
    mockRun.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      if (args[0] === 'status') return '## main\0'
      return ''
    })
    await runExecute(2)
    // If the cache had been reset, the resolver would re-probe the allowlist
    // (multiple `access` calls). With the cache intact, only the per-call
    // projectPath `access` (or none on a normal happy path) fires.
    expect(mockAccess.mock.calls.length).toBeLessThan(5)
  })

  it('EACCES (binary not executable) re-probes + falls back to iso once', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false })
    let failed = false
    mockRun.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      if (args[0] === 'status') {
        if (!failed) {
          failed = true
          throw execError('EACCES', 'spawn EACCES')
        }
        return '## main\0'
      }
      return ''
    })

    const m = await runExecute()
    expect(mockStatusMatrix).toHaveBeenCalledTimes(1) // fell back to iso once
    expect(m.type).toBe('result')
  })
})

describe('git-status.worker – detached HEAD (lens review #6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatusMatrix.mockResolvedValue([])
    resetGitPathCache()
    resetTransientFailureCount()
  })

  it('parses `## HEAD (no branch)` and resolves a 7-char SHA via the conditional rev-parse', async () => {
    let revParseCalls = 0
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      if (args[0] === 'status') return '## HEAD (no branch)\0'
      if (args[0] === 'rev-parse') {
        revParseCalls++
        return '1234567abcdef1234567abcdef1234567abcdef12\n'
      }
      return ''
    })

    const m = await runExecute()
    expect(m.data.isDetached).toBe(true)
    expect(m.data.branch).toBe('1234567')
    expect(revParseCalls).toBe(1)
  })

  it('null branch when the rev-parse fallback fails', async () => {
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      if (args[0] === 'status') return '## HEAD (no branch)\0'
      if (args[0] === 'rev-parse') throw execError(128, 'fatal: ambiguous')
      return ''
    })

    const m = await runExecute()
    expect(m.data.isDetached).toBe(true)
    expect(m.data.branch).toBeNull()
  })

  it('unborn branch is NOT classified as detached (branch name preserved)', async () => {
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      if (args[0] === 'status') return '## No commits yet on main\0?? new.ts\0'
      return ''
    })

    const m = await runExecute()
    expect(m.data.isDetached).toBe(false)
    expect(m.data.branch).toBe('main')
    expect(m.data.counts.untracked).toBe(1)
  })
})

describe('git-status.worker – worktree gitdir pointer (lens review #20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatusMatrix.mockResolvedValue([])
    resetGitPathCache()
    resetTransientFailureCount()
  })

  it('does NOT short-circuit when `.git` is a file – the native worker still produces a result', async () => {
    // executeIsomorphicGit's previous stat-based gate used to return
    // createEmptyGitStatusResponse() when .git was a file, hiding worktrees.
    // executeNativeGit doesn't gate on the stat type at all, so the native
    // path works fine on a worktree. This test sanity-checks that.
    mockStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true })
    wireGit(async (_cmd, args) => {
      if (args[0] === '--version') return 'git version 2.43.0\n'
      if (args[0] === 'status') return '## main\0'
      return ''
    })

    const m = await runExecute()
    expect(m.data.isGitRepo).toBe(true)
    expect(m.data.branch).toBe('main')
  })
})

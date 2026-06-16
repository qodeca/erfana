// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Regression: native-git failure classification.
 *
 * Locked policy:
 *  - A genuinely-missing binary (spawn ENOENT) is the ONLY case that falls back
 *    to isomorphic-git, and the resolver cache is reset so the next call
 *    re-probes.
 *  - Any other native failure (FD exhaustion, timeout/kill, non-zero exit)
 *    returns a TRANSIENT error result and retries native next cycle. It must NOT
 *    fall back to isomorphic-git – that would reintroduce CRLF false-positives
 *    on Windows.
 *
 * Harness mirrors git-status.worker.crlf.test.ts.
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
    mockStatusMatrix: vi.fn().mockResolvedValue([]),
    mockRun: vi.fn() as ReturnType<typeof vi.fn>,
  }
})
// vi.mock factories reference `hoisted.*` (not the destructured consts) – the
// static worker import below loads the module during hoisting, before the
// destructuring line runs. See git-status.worker.crlf.test.ts for detail.
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

import { resetGitPathCache } from './git-status.worker'

const PROJECT = resolve('/tmp/fallback-repo')

function execError(code: string | number, message = 'exec failed'): NodeJS.ErrnoException {
  const e = new Error(message) as NodeJS.ErrnoException
  e.code = code as NodeJS.ErrnoException['code']
  return e
}

async function runExecute(id: number): Promise<any> {
  mockParentPort.postMessage.mockClear()
  mockParentPort.emit('message', { type: 'execute', id, projectPath: PROJECT, strategy: 'native-git' })
  await vi.waitFor(() => expect(mockParentPort.postMessage).toHaveBeenCalled())
  return mockParentPort.postMessage.mock.calls.at(-1)![0]
}

/** Resolver always succeeds; `git status` behaviour is per-test via `statusBehavior`. */
function wireGit(statusBehavior: () => Promise<string>): void {
  mockAccess.mockResolvedValue(undefined)
  mockRun.mockImplementation(async (_cmd: string, args: string[]) => {
    if (args[0] === '--version') return 'git version 2.43.0\n'
    if (args[0] === 'status') return statusBehavior()
    if (args[0] === 'rev-parse') return 'main\n'
    return '/usr/bin/git\n'
  })
}

describe('git-status.worker – native failure fallback policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatusMatrix.mockResolvedValue([])
    resetGitPathCache()
  })

  it('ENOENT at spawn falls back to isomorphic-git and re-probes on the next call', async () => {
    wireGit(async () => {
      throw execError('ENOENT', 'spawn git ENOENT')
    })

    const msg = await runExecute(1)

    // Fell back to the portable path.
    expect(mockStatusMatrix).toHaveBeenCalledTimes(1)
    expect(msg.type).toBe('result')
    expect(msg.data.isGitRepo).toBe(true)

    // resetGitPathCache() was invoked → the binary is re-probed next call.
    mockAccess.mockClear()
    await runExecute(2)
    expect(mockAccess).toHaveBeenCalled()
  })

  it('FD exhaustion (EMFILE) returns a transient error and does NOT use statusMatrix', async () => {
    wireGit(async () => {
      throw execError('EMFILE', 'spawn EMFILE')
    })

    const msg = await runExecute(1)

    expect(msg.type).toBe('result')
    expect(msg.data.isGitRepo).toBe(true)
    expect(msg.data.error).toMatch(/temporarily unavailable/i)
    expect(mockStatusMatrix).not.toHaveBeenCalled()
  })

  it('non-zero git exit returns a transient error and does NOT use statusMatrix', async () => {
    wireGit(async () => {
      throw execError(128, 'git exited with code 128')
    })

    const msg = await runExecute(1)

    expect(msg.type).toBe('result')
    expect(msg.data.error).toMatch(/temporarily unavailable/i)
    expect(mockStatusMatrix).not.toHaveBeenCalled()
  })

  it('falls back to isomorphic-git when no git binary is available at all', async () => {
    // No allowlist candidate exists and where/which finds nothing → resolveGitPath null.
    mockAccess.mockRejectedValue(new Error('ENOENT'))
    mockRun.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'git') return '' // where/which: empty
      return ''
    })

    const msg = await runExecute(1)

    expect(mockStatusMatrix).toHaveBeenCalledTimes(1)
    expect(msg.type).toBe('result')
    expect(msg.data.isGitRepo).toBe(true)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the git binary resolver in `git-status.worker.ts`.
 *
 * The worker module evaluates `GIT_PATH_ALLOWLIST` at module load based on
 * `process.platform`. Tests isolate the resolver by:
 *   1. Stubbing `process.platform` BEFORE importing the worker.
 *   2. Calling the exported `resolveGitPath()` directly (bypasses the
 *      `worker_threads` message boundary — clean unit test surface).
 *   3. `vi.resetModules()` between platform-mode changes so the allowlist
 *      array is re-evaluated for the new platform.
 *
 * Covers #160 (Windows git allowlist + F_OK + `git --version` liveness).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Platform stub state
// ---------------------------------------------------------------------------

const originalPlatform = process.platform
const originalUserProfile = process.env.USERPROFILE

function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
}

// ---------------------------------------------------------------------------
// Hoisted shared mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events') as typeof import('events')
  class FakePort extends EventEmitter {
    postMessage = vi.fn()
  }
  return {
    mockParentPort: new FakePort(),
    mockAccess: vi.fn(),
    mockRun: vi.fn() as ReturnType<typeof vi.fn>,
  }
})
const { mockParentPort, mockAccess, mockRun } = hoisted

vi.mock('worker_threads', () => ({ parentPort: mockParentPort }))

vi.mock('fs/promises', () => ({
  access: mockAccess,
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true, isFile: () => false }),
}))

vi.mock('isomorphic-git', () => ({
  statusMatrix: vi.fn().mockResolvedValue([]),
  currentBranch: vi.fn().mockResolvedValue('main'),
  resolveRef: vi.fn(),
}))

vi.mock('child_process', () => {
  type Cb = (err: Error | null, out?: { stdout: string; stderr: string }) => void
  const forward = (cmd: string, args: string[], opts: unknown, cb?: Cb): void => {
    const callback = (typeof opts === 'function' ? opts : cb) as Cb
    mockRun(cmd, args).then(
      (stdout: string) => callback(null, { stdout, stderr: '' }),
      (err: Error) => callback(err),
    )
  }
  return { execFile: forward }
})

// ---------------------------------------------------------------------------
// Resolver import helper — returns a freshly-imported resolver bound to the
// currently-stubbed `process.platform`. `vi.resetModules()` ensures the
// module-level `GIT_PATH_ALLOWLIST` re-evaluates.
// ---------------------------------------------------------------------------

async function freshResolver(): Promise<{
  resolveGitPath: () => Promise<string | null>
  resetGitPathCache: () => void
}> {
  vi.resetModules()
  return await import('./git-status.worker')
}

describe('git-resolver – #160 Windows git allowlist', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — clears BOTH call history AND
    // mockImplementation / mockResolvedValue, so a previous test's stub
    // can't leak into the next test's default behavior.
    vi.resetAllMocks()
    process.env.USERPROFILE = 'C:\\Users\\testuser'
  })

  afterEach(() => {
    restorePlatform()
    process.env.USERPROFILE = originalUserProfile
  })

  // -------------------------------------------------------------------------
  describe('on win32', () => {
    beforeEach(() => stubPlatform('win32'))

    it('resolves the first allowlist hit when its liveness probe succeeds', async () => {
      const PROGRAM_FILES_GIT = 'C:\\Program Files\\Git\\cmd\\git.exe'
      mockAccess.mockImplementation(async (path: string) => {
        if (path === PROGRAM_FILES_GIT) return
        throw new Error('ENOENT')
      })
      mockRun.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === PROGRAM_FILES_GIT && args[0] === '--version') return 'git version 2.43.0\n'
        throw new Error('unexpected')
      })

      const { resolveGitPath } = await freshResolver()
      const resolved = await resolveGitPath()

      expect(resolved).toBe(PROGRAM_FILES_GIT)
      expect(mockRun).toHaveBeenCalledWith(PROGRAM_FILES_GIT, ['--version'])
    })

    it('rejects a candidate that exists (F_OK) but fails `git --version` liveness probe', async () => {
      const BAD_CANDIDATE = 'C:\\Program Files\\Git\\cmd\\git.exe'
      mockAccess.mockImplementation(async (path: string) => {
        if (path === BAD_CANDIDATE) return
        throw new Error('ENOENT')
      })
      mockRun.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === BAD_CANDIDATE && args[0] === '--version') {
          throw new Error('not a valid Win32 application')
        }
        if (cmd === 'where' && args[0] === 'git') return 'C:\\Tools\\git.exe\n'
        throw new Error('unexpected')
      })

      const { resolveGitPath } = await freshResolver()
      const resolved = await resolveGitPath()

      // Liveness probe ran on candidate, then fell through to `where git`.
      expect(mockRun).toHaveBeenCalledWith(BAD_CANDIDATE, ['--version'])
      expect(mockRun).toHaveBeenCalledWith('where', ['git'])
      expect(resolved).toBe('C:\\Tools\\git.exe')
    })

    it('probes Scoop user-profile path after the Program Files entries miss', async () => {
      const SCOOP_GIT = 'C:\\Users\\testuser\\scoop\\apps\\git\\current\\cmd\\git.exe'
      mockAccess.mockImplementation(async (path: string) => {
        if (path === SCOOP_GIT) return
        throw new Error('ENOENT')
      })
      mockRun.mockImplementation(async (cmd: string) => {
        if (cmd === SCOOP_GIT) return 'git version 2.43.0\n'
        throw new Error('unexpected')
      })

      const { resolveGitPath } = await freshResolver()
      const resolved = await resolveGitPath()

      expect(resolved).toBe(SCOOP_GIT)
      expect(mockAccess).toHaveBeenCalledWith(SCOOP_GIT, expect.anything())
    })

    it('falls back to `where git` when every allowlist entry misses', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'))
      mockRun.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'where' && args[0] === 'git') return 'C:\\Tools\\Git\\git.exe\n'
        throw new Error('unexpected')
      })

      const { resolveGitPath } = await freshResolver()
      const resolved = await resolveGitPath()

      expect(mockRun).toHaveBeenCalledWith('where', ['git'])
      expect(resolved).toBe('C:\\Tools\\Git\\git.exe')
    })

    it('probes all Program Files entries in priority order', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT')) // none exist
      mockRun.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'where' && args[0] === 'git') return ''
        throw new Error('unexpected')
      })

      const { resolveGitPath } = await freshResolver()
      await resolveGitPath()

      const accessedPaths = mockAccess.mock.calls.map((c) => c[0] as string)
      // All 6 Windows paths should be probed in priority order.
      expect(accessedPaths[0]).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
      expect(accessedPaths[1]).toBe('C:\\Program Files\\Git\\bin\\git.exe')
      expect(accessedPaths[2]).toBe('C:\\Program Files (x86)\\Git\\cmd\\git.exe')
      expect(accessedPaths[3]).toBe('C:\\Program Files (x86)\\Git\\bin\\git.exe')
      expect(accessedPaths[4]).toBe('C:\\ProgramData\\chocolatey\\bin\\git.exe')
      expect(accessedPaths[5]).toContain('scoop\\apps\\git\\current\\cmd\\git.exe')
    })
  })

  // -------------------------------------------------------------------------
  describe('on linux (POSIX regression)', () => {
    beforeEach(() => stubPlatform('linux'))

    it('probes only the POSIX allowlist paths', async () => {
      mockAccess.mockImplementation(async (path: string) => {
        if (path === '/usr/bin/git') return
        throw new Error('ENOENT')
      })
      mockRun.mockResolvedValue('')

      const { resolveGitPath } = await freshResolver()
      const resolved = await resolveGitPath()

      expect(resolved).toBe('/usr/bin/git')
      const accessedPaths = mockAccess.mock.calls.map((c) => c[0] as string)
      expect(accessedPaths).toContain('/usr/bin/git')
      expect(accessedPaths.some((p) => p.startsWith('C:\\'))).toBe(false)
    })

    it('does NOT run a `git --version` liveness probe on POSIX (X_OK is sufficient)', async () => {
      mockAccess.mockImplementation(async (path: string) => {
        if (path === '/usr/bin/git') return
        throw new Error('ENOENT')
      })
      mockRun.mockResolvedValue('')

      const { resolveGitPath } = await freshResolver()
      await resolveGitPath()

      expect(mockRun).not.toHaveBeenCalledWith('/usr/bin/git', ['--version'])
    })

    it('falls back to `which git` (not `where git`) on POSIX', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'))
      mockRun.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'git') return '/opt/local/bin/git\n'
        throw new Error('unexpected')
      })

      const { resolveGitPath } = await freshResolver()
      const resolved = await resolveGitPath()

      expect(mockRun).toHaveBeenCalledWith('which', ['git'])
      expect(mockRun).not.toHaveBeenCalledWith('where', ['git'])
      expect(resolved).toBe('/opt/local/bin/git')
    })
  })
})

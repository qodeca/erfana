// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for GitStatusService
 * ============================
 * Service orchestrates git status retrieval via IGitStatusWorker.
 * All git computation is delegated to the worker – these tests verify
 * orchestration logic: queuing, circuit breaker, strategy selection,
 * error handling, and delegate contracts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IGitStatusWorker } from '../interfaces/IGitStatusWorker'
import type { GitStatusResponse } from '../../shared/ipc/git-schema'
import { GIT_STATUS } from '../../shared/constants'

// Mock fs/promises – used by the service's `.git` presence check (now via
// `access`, not `stat`: a `.git` *file* gitdir pointer is also valid for git
// worktrees and submodules).
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  stat: vi.fn(),
}))

// Mock logger to avoid noise and allow assertions.
// Factory must not reference outer variables (vi.mock is hoisted) – use inline fns.
vi.mock('./LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { access, stat } from 'fs/promises'
import { logger } from './LoggingService'
import { GitStatusService } from './GitStatusService'

const mockLogger = vi.mocked(logger)

const mockedAccess = vi.mocked(access)
const mockedStat = vi.mocked(stat)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestResponse(overrides?: Partial<GitStatusResponse>): GitStatusResponse {
  return {
    isGitRepo: true,
    branch: 'main',
    isDetached: false,
    files: [],
    counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
    truncated: false,
    ...overrides,
  }
}

function createMockWorker(overrides?: Partial<IGitStatusWorker>): IGitStatusWorker {
  return {
    execute: vi.fn().mockResolvedValue(createTestResponse()),
    dispose: vi.fn().mockResolvedValue(undefined),
    isAlive: vi.fn().mockReturnValue(true),
    ...overrides,
  }
}

/** Make access() succeed for the .git presence check */
function mockGitDirExists(): void {
  mockedAccess.mockResolvedValue(undefined)
  mockedStat.mockResolvedValue({
    isDirectory: () => true,
    isFile: () => false,
    size: 0,
  } as any)
}

/** Make access() reject for the .git presence check */
function mockGitDirMissing(): void {
  mockedAccess.mockRejectedValue(new Error('ENOENT: no such file or directory'))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitStatusService', () => {
  let mockWorker: IGitStatusWorker
  let service: GitStatusService

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorker = createMockWorker()
    service = new GitStatusService(mockWorker)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  describe('non-git repository detection', () => {
    it('should return isGitRepo: false when .git directory does not exist', async () => {
      mockGitDirMissing()

      const result = await service.getStatus('/path/to/non-git-project')

      expect(result.isGitRepo).toBe(false)
      expect(result.branch).toBeNull()
      expect(result.files).toEqual([])
    })

    it('should NOT short-circuit when .git is a file (worktree/submodule gitdir pointer)', async () => {
      // Lens review #20: a `.git` *file* containing `gitdir: <path>` is a
      // valid git worktree / submodule layout. Previously the service
      // short-circuited on !isDirectory and silently reported no-repo for
      // every worktree. The service now uses `access()` and lets the worker
      // resolve the pointer.
      mockedAccess.mockResolvedValue(undefined)

      await service.getStatus('/path/to/worktree-project')

      expect(mockWorker.execute).toHaveBeenCalledOnce()
    })

    it('should not call worker.execute when not a git repo', async () => {
      mockGitDirMissing()

      await service.getStatus('/path/to/non-git-project')

      expect(mockWorker.execute).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('worker delegation', () => {
    it('should delegate to worker.execute for a valid git repo', async () => {
      mockGitDirExists()

      await service.getStatus('/path/to/project')

      expect(mockWorker.execute).toHaveBeenCalledOnce()
      expect(mockWorker.execute).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: '/path/to/project' })
      )
    })

    it('should return the response from the worker unchanged', async () => {
      mockGitDirExists()
      const workerResponse = createTestResponse({
        branch: 'feature/my-feature',
        files: [{ path: '/project/src/foo.ts', status: 'modified', staged: false }],
        counts: { modified: 1, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
      })
      vi.mocked(mockWorker.execute).mockResolvedValue(workerResponse)

      const result = await service.getStatus('/project')

      expect(result).toBe(workerResponse)
    })

    it('should return branch and isDetached from worker response', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockResolvedValue(
        createTestResponse({ branch: 'develop', isDetached: false })
      )

      const result = await service.getStatus('/project')

      expect(result.branch).toBe('develop')
      expect(result.isDetached).toBe(false)
    })

    it('should pass projectPath in execute request', async () => {
      mockGitDirExists()

      await service.getStatus('/some/absolute/path')

      expect(mockWorker.execute).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: '/some/absolute/path' })
      )
    })
  })

  // -------------------------------------------------------------------------
  describe('strategy selection', () => {
    // Native git is now always the PREFERRED strategy (it honours the user's
    // core.autocrlf / .gitattributes normalization, so status matches the
    // user's own git). The native-vs-isomorphic decision is made in the worker
    // based on git-binary availability, not on repo size. The 5 MB index-size
    // threshold was removed.
    it('should always pass strategy "native-git" regardless of repo size', async () => {
      mockGitDirExists()

      await service.getStatus('/project')

      expect(mockWorker.execute).toHaveBeenCalledWith(
        expect.objectContaining({ strategy: 'native-git' })
      )
    })

    it('should pass strategy "native-git" even for a tiny repo', async () => {
      // .git presence check succeeds via access(); no .git/index stat happens.
      mockedAccess.mockResolvedValueOnce(undefined)

      await service.getStatus('/project')

      expect(mockWorker.execute).toHaveBeenCalledWith(
        expect.objectContaining({ strategy: 'native-git' })
      )
    })
  })

  // -------------------------------------------------------------------------
  describe('error handling', () => {
    it('should return error response when worker.execute rejects', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockRejectedValue(new Error('Worker crashed'))

      const result = await service.getStatus('/project')

      expect(result.error).toBe('Worker crashed')
      expect(result.isGitRepo).toBe(false)
      expect(result.files).toEqual([])
    })

    it('should include error message in response when worker throws', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockRejectedValue(new Error('Failed to read git repository'))

      const result = await service.getStatus('/project')

      expect(result.error).toBe('Failed to read git repository')
    })

    it('should stringify non-Error throws', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockRejectedValue('string error')

      const result = await service.getStatus('/project')

      expect(result.error).toBe('string error')
    })

    it('should not throw – always resolves with a GitStatusResponse', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockRejectedValue(new Error('Boom'))

      await expect(service.getStatus('/project')).resolves.toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  describe('circuit breaker', () => {
    it('should return error response when circuit breaker is open', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockRejectedValue(new Error('crash'))

      // Trigger enough crashes to open the circuit
      for (let i = 0; i < GIT_STATUS.CIRCUIT_BREAKER_THRESHOLD; i++) {
        await service.getStatus('/project')
      }

      // Reset stat mock – .git dir still exists
      mockGitDirExists()

      const result = await service.getStatus('/project')

      expect(result.error).toContain('Git status disabled')
      // Worker should not be called again while circuit is open
      expect(mockWorker.execute).toHaveBeenCalledTimes(GIT_STATUS.CIRCUIT_BREAKER_THRESHOLD)
    })

    it('should allow probe after reset period elapses', async () => {
      vi.useFakeTimers()

      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockRejectedValue(new Error('crash'))

      // Open the circuit
      for (let i = 0; i < GIT_STATUS.CIRCUIT_BREAKER_THRESHOLD; i++) {
        await service.getStatus('/project')
      }

      // Advance time past reset period
      vi.advanceTimersByTime(GIT_STATUS.CIRCUIT_BREAKER_RESET + 1)

      // Now configure worker to succeed
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockResolvedValue(createTestResponse({ branch: 'main' }))

      const result = await service.getStatus('/project')

      // Circuit in half-open state: probe goes through
      expect(mockWorker.execute).toHaveBeenCalledTimes(GIT_STATUS.CIRCUIT_BREAKER_THRESHOLD + 1)
      expect(result.error).toBeUndefined()

      vi.useRealTimers()
    })

    it('should reset circuit breaker on successful execution', async () => {
      vi.useFakeTimers()

      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockRejectedValue(new Error('crash'))

      // Open the circuit
      for (let i = 0; i < GIT_STATUS.CIRCUIT_BREAKER_THRESHOLD; i++) {
        await service.getStatus('/project')
      }

      // Advance time and let a probe succeed
      vi.advanceTimersByTime(GIT_STATUS.CIRCUIT_BREAKER_RESET + 1)
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockResolvedValue(createTestResponse())
      await service.getStatus('/project')

      // After success, subsequent calls should go through normally
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockResolvedValue(createTestResponse({ branch: 'develop' }))
      const result = await service.getStatus('/project')

      expect(result.error).toBeUndefined()
      expect(result.branch).toBe('develop')

      vi.useRealTimers()
    })

    it('should open global circuit breaker after many crashes across different projects', async () => {
      vi.mocked(mockWorker.execute).mockRejectedValue(new Error('crash'))

      // Crash across different projects – each below per-project threshold
      // but together exceeding global threshold (10)
      for (let i = 0; i < GIT_STATUS.CIRCUIT_BREAKER_GLOBAL_THRESHOLD; i++) {
        mockGitDirExists()
        await service.getStatus(`/project-${i}`)
      }

      // Next call to any project should be blocked by global breaker
      mockGitDirExists()
      const result = await service.getStatus('/project-new')

      expect(result.error).toContain('Git status disabled')
      // Worker should not be called for the blocked request
      expect(mockWorker.execute).toHaveBeenCalledTimes(GIT_STATUS.CIRCUIT_BREAKER_GLOBAL_THRESHOLD)
    })
  })

  // -------------------------------------------------------------------------
  describe('logging', () => {
    it('should call logger.info with structured format on success', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockResolvedValue(
        createTestResponse({ files: [{ path: '/p/a.ts', status: 'modified', staged: false }] })
      )

      await service.getStatus('/project')

      expect(mockLogger.info).toHaveBeenCalledWith(
        'GitStatus: completed',
        expect.objectContaining({
          strategy: expect.any(String),
          durationMs: expect.any(Number),
          fileCount: 1,
          truncated: false,
        })
      )
    })

    it('should call logger.warn with structured format on worker error', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockRejectedValue(new Error('oops'))

      await service.getStatus('/project')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'GitStatus: worker error',
        expect.objectContaining({
          strategy: expect.any(String),
          durationMs: expect.any(Number),
          error: 'oops',
        })
      )
    })

    it('should call logger.trace for non-git directories', async () => {
      mockGitDirMissing()

      await service.getStatus('/not-a-git-project')

      expect(mockLogger.trace).toHaveBeenCalledWith(
        'GitStatus: not a git repo',
        expect.objectContaining({ projectPath: '/not-a-git-project' })
      )
    })
  })

  // -------------------------------------------------------------------------
  describe('dispose', () => {
    it('should call worker.dispose() on dispose', async () => {
      await service.dispose()

      expect(mockWorker.dispose).toHaveBeenCalledOnce()
    })

    it('should clear the operation queue on dispose', async () => {
      await service.dispose()

      const serviceWithPrivates = service as unknown as {
        operationQueues: Map<string, Promise<unknown>>
      }
      expect(serviceWithPrivates.operationQueues.size).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  describe('operation queue (concurrency control)', () => {
    it('should serialize concurrent getStatus calls for the same project', async () => {
      const callOrder: number[] = []
      let resolveFirst!: () => void
      let resolveSecond!: () => void
      let resolveThird!: () => void

      const firstPromise = new Promise<void>((resolve) => { resolveFirst = resolve })
      const secondPromise = new Promise<void>((resolve) => { resolveSecond = resolve })
      const thirdPromise = new Promise<void>((resolve) => { resolveThird = resolve })

      mockGitDirExists()

      vi.mocked(mockWorker.execute)
        .mockImplementationOnce(async () => {
          callOrder.push(1)
          await firstPromise
          return createTestResponse({ files: [{ path: '/p/file1.ts', status: 'modified', staged: false }] })
        })
        .mockImplementationOnce(async () => {
          callOrder.push(2)
          await secondPromise
          return createTestResponse({ files: [{ path: '/p/file2.ts', status: 'modified', staged: false }] })
        })
        .mockImplementationOnce(async () => {
          callOrder.push(3)
          await thirdPromise
          return createTestResponse({ files: [{ path: '/p/file3.ts', status: 'modified', staged: false }] })
        })

      const result1Promise = service.getStatus('/project')
      const result2Promise = service.getStatus('/project')
      const result3Promise = service.getStatus('/project')

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(callOrder).toEqual([1])

      resolveFirst()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(callOrder).toEqual([1, 2])

      resolveSecond()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(callOrder).toEqual([1, 2, 3])

      resolveThird()
      const [result1, result2, result3] = await Promise.all([result1Promise, result2Promise, result3Promise])

      expect(result1.files[0].path).toContain('file1.ts')
      expect(result2.files[0].path).toContain('file2.ts')
      expect(result3.files[0].path).toContain('file3.ts')
    })

    it('should allow parallel getStatus calls for different projects', async () => {
      const callOrder: string[] = []
      let resolveProjectA!: () => void
      let resolveProjectB!: () => void

      const projectAPromise = new Promise<void>((resolve) => { resolveProjectA = resolve })
      const projectBPromise = new Promise<void>((resolve) => { resolveProjectB = resolve })

      mockGitDirExists()

      vi.mocked(mockWorker.execute).mockImplementation(async ({ projectPath }) => {
        const project = projectPath.includes('projectA') ? 'A' : 'B'
        callOrder.push(`start-${project}`)
        if (project === 'A') {
          await projectAPromise
        } else {
          await projectBPromise
        }
        callOrder.push(`end-${project}`)
        return createTestResponse({
          files: [{ path: `/p/file-${project}.ts`, status: 'modified', staged: false }],
        })
      })

      const resultA = service.getStatus('/projectA')
      const resultB = service.getStatus('/projectB')

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Both should have started
      expect(callOrder).toContain('start-A')
      expect(callOrder).toContain('start-B')

      resolveProjectA()
      resolveProjectB()

      const [a, b] = await Promise.all([resultA, resultB])
      expect(a.files[0].path).toContain('file-A.ts')
      expect(b.files[0].path).toContain('file-B.ts')
    })

    it('should continue queue after an operation failure', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute)
        .mockRejectedValueOnce(new Error('First operation failed'))
        .mockResolvedValueOnce(
          createTestResponse({ files: [{ path: '/p/file.ts', status: 'modified', staged: false }] })
        )

      const result1 = await service.getStatus('/project')
      expect(result1.error).toBe('First operation failed')

      mockGitDirExists()
      const result2 = await service.getStatus('/project')
      expect(result2.error).toBeUndefined()
      expect(result2.files).toHaveLength(1)
    })

    it('should clean up queue entry after operation completes', async () => {
      mockGitDirExists()

      await service.getStatus('/project')

      const serviceWithPrivates = service as unknown as {
        operationQueues: Map<string, Promise<unknown>>
      }
      expect(serviceWithPrivates.operationQueues.has('/project')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  describe('complete scenarios', () => {
    it('should return clean repo response', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockResolvedValue(
        createTestResponse({
          branch: 'main',
          files: [],
          counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
        })
      )

      const result = await service.getStatus('/path/to/project')

      expect(result).toMatchObject({
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files: [],
        truncated: false,
      })
      expect(result.counts).toEqual({
        modified: 0,
        untracked: 0,
        deleted: 0,
        staged: 0,
        conflicted: 0,
      })
    })

    it('should return complete response for typical repo with mixed file states', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockResolvedValue(
        createTestResponse({
          branch: 'feature/git-status',
          files: [
            { path: '/project/src/index.ts', status: 'modified', staged: false },
            { path: '/project/README.md', status: 'untracked', staged: false },
            { path: '/project/docs/guide.md', status: 'staged', staged: true },
          ],
          counts: { modified: 1, untracked: 1, deleted: 0, staged: 1, conflicted: 0 },
        })
      )

      const result = await service.getStatus('/project')

      expect(result).toMatchObject({
        isGitRepo: true,
        branch: 'feature/git-status',
        isDetached: false,
        truncated: false,
      })
      expect(result.files).toHaveLength(3)
      expect(result.counts).toEqual({
        modified: 1,
        untracked: 1,
        deleted: 0,
        staged: 1,
        conflicted: 0,
      })
    })

    it('should forward truncated: true from worker response', async () => {
      mockGitDirExists()
      vi.mocked(mockWorker.execute).mockResolvedValue(
        createTestResponse({ truncated: true, files: Array.from({ length: 10000 }, (_, i) => ({
          path: `/project/file${i}.ts`,
          status: 'modified' as const,
          staged: false,
        })) })
      )

      const result = await service.getStatus('/project')

      expect(result.truncated).toBe(true)
      expect(result.files).toHaveLength(10000)
    })
  })
})

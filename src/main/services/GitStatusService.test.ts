/**
 * Tests for GitStatusService
 * ============================
 * Git status detection using isomorphic-git
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GitStatusService } from './GitStatusService'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}))

// Mock isomorphic-git
vi.mock('isomorphic-git', () => ({
  currentBranch: vi.fn(),
  resolveRef: vi.fn(),
  statusMatrix: vi.fn(),
}))

import { stat } from 'fs/promises'
import * as git from 'isomorphic-git'

const mockedStat = vi.mocked(stat)
const mockedCurrentBranch = vi.mocked(git.currentBranch)
const mockedResolveRef = vi.mocked(git.resolveRef)
const mockedStatusMatrix = vi.mocked(git.statusMatrix)

describe('GitStatusService', () => {
  let service: GitStatusService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new GitStatusService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('non-git repository detection', () => {
    it('should return isGitRepo: false when .git directory does not exist', async () => {
      mockedStat.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      const result = await service.getStatus('/path/to/non-git-project')

      expect(result.isGitRepo).toBe(false)
      expect(result.branch).toBeNull()
      expect(result.files).toEqual([])
    })

    it('should return isGitRepo: false when .git is not a directory', async () => {
      mockedStat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
      } as any)

      const result = await service.getStatus('/path/to/project')

      expect(result.isGitRepo).toBe(false)
    })

    it('should not call git functions when not a git repo', async () => {
      mockedStat.mockRejectedValue(new Error('ENOENT'))

      await service.getStatus('/path/to/non-git-project')

      expect(mockedCurrentBranch).not.toHaveBeenCalled()
      expect(mockedStatusMatrix).not.toHaveBeenCalled()
    })
  })

  describe('branch name detection', () => {
    beforeEach(() => {
      // Mock .git directory exists
      mockedStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any)
      // Mock empty status matrix
      mockedStatusMatrix.mockResolvedValue([])
    })

    it('should return branch name correctly', async () => {
      mockedCurrentBranch.mockResolvedValue('main')

      const result = await service.getStatus('/path/to/project')

      expect(result.isGitRepo).toBe(true)
      expect(result.branch).toBe('main')
      expect(result.isDetached).toBe(false)
    })

    it('should detect feature branch', async () => {
      mockedCurrentBranch.mockResolvedValue('feature/git-status')

      const result = await service.getStatus('/path/to/project')

      expect(result.branch).toBe('feature/git-status')
      expect(result.isDetached).toBe(false)
    })

    it('should detect develop branch', async () => {
      mockedCurrentBranch.mockResolvedValue('develop')

      const result = await service.getStatus('/path/to/project')

      expect(result.branch).toBe('develop')
      expect(result.isDetached).toBe(false)
    })
  })

  describe('detached HEAD state', () => {
    beforeEach(() => {
      mockedStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any)
      mockedStatusMatrix.mockResolvedValue([])
    })

    it('should detect detached HEAD state', async () => {
      // currentBranch returns undefined for detached HEAD
      mockedCurrentBranch.mockResolvedValue(undefined)
      mockedResolveRef.mockResolvedValue('a1b2c3d4e5f6789012345678901234567890abcd')

      const result = await service.getStatus('/path/to/project')

      expect(result.isDetached).toBe(true)
      expect(result.branch).toBe('a1b2c3d') // Short hash (7 chars)
    })

    it('should return null branch when resolveRef fails in detached state', async () => {
      mockedCurrentBranch.mockResolvedValue(undefined)
      mockedResolveRef.mockRejectedValue(new Error('Failed to resolve ref'))

      const result = await service.getStatus('/path/to/project')

      expect(result.isDetached).toBe(true)
      expect(result.branch).toBeNull()
    })
  })

  describe('status matrix mapping', () => {
    beforeEach(() => {
      mockedStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any)
      mockedCurrentBranch.mockResolvedValue('main')
    })

    it('should map untracked files correctly', async () => {
      // HEADStatus: 0 (absent), workdirStatus: 2 (different), stageStatus: 0 (absent)
      mockedStatusMatrix.mockResolvedValue([
        ['src/new-file.ts', 0, 2, 0],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.files).toHaveLength(1)
      // Path should be absolute (joined with project path)
      expect(result.files[0].path).toBe('/path/to/project/src/new-file.ts')
      expect(result.files[0].status).toBe('untracked')
      expect(result.files[0].staged).toBe(false)
      expect(result.counts.untracked).toBe(1)
    })

    it('should map modified (unstaged) files correctly', async () => {
      // HEADStatus: 1 (present), workdirStatus: 2 (different), stageStatus: 1 (same as HEAD)
      mockedStatusMatrix.mockResolvedValue([
        ['src/modified.ts', 1, 2, 1],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.files[0].status).toBe('modified')
      expect(result.files[0].staged).toBe(false)
      expect(result.counts.modified).toBe(1)
    })

    it('should map staged (new file) correctly', async () => {
      // HEADStatus: 0, workdirStatus: 2, stageStatus: 2 (different from HEAD)
      mockedStatusMatrix.mockResolvedValue([
        ['src/new-staged.ts', 0, 2, 2],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.files[0].status).toBe('staged')
      expect(result.files[0].staged).toBe(true)
      expect(result.counts.staged).toBe(1)
    })

    it('should map staged (modified file) correctly', async () => {
      // HEADStatus: 1, workdirStatus: 2, stageStatus: 2
      mockedStatusMatrix.mockResolvedValue([
        ['src/staged-modified.ts', 1, 2, 2],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.files[0].status).toBe('staged')
      expect(result.files[0].staged).toBe(true)
      expect(result.counts.staged).toBe(1)
    })

    it('should map deleted (unstaged) files correctly', async () => {
      // HEADStatus: 1, workdirStatus: 0 (absent), stageStatus: 1
      mockedStatusMatrix.mockResolvedValue([
        ['src/deleted.ts', 1, 0, 1],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.files[0].status).toBe('deleted')
      expect(result.files[0].staged).toBe(false)
      expect(result.counts.deleted).toBe(1)
    })

    it('should map deleted (staged) files correctly', async () => {
      // HEADStatus: 1, workdirStatus: 0, stageStatus: 0
      mockedStatusMatrix.mockResolvedValue([
        ['src/deleted-staged.ts', 1, 0, 0],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.files[0].status).toBe('deleted')
      expect(result.files[0].staged).toBe(true)
      expect(result.counts.deleted).toBe(1)
    })

    it('should map staged files with stageStatus: 3 correctly (staged with additional workdir changes)', async () => {
      // HEADStatus: 1, workdirStatus: 2, stageStatus: 3 (staged with additional workdir changes)
      // stageStatus: 3 means different from both HEAD and workdir - file is staged but has more unstaged changes
      mockedStatusMatrix.mockResolvedValue([
        ['src/staged-with-changes.ts', 1, 2, 3],
      ])

      const result = await service.getStatus('/path/to/project')

      // This is treated as staged (not conflicted) - the implementation prioritizes staging detection
      expect(result.files[0].status).toBe('staged')
      expect(result.files[0].staged).toBe(true)
      expect(result.counts.staged).toBe(1)
    })

    it('should skip unmodified files', async () => {
      // HEADStatus: 1, workdirStatus: 1 (identical), stageStatus: 1
      mockedStatusMatrix.mockResolvedValue([
        ['src/unmodified.ts', 1, 1, 1],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.files).toHaveLength(0)
    })

    it('should skip unknown status combinations', async () => {
      // Invalid combination
      mockedStatusMatrix.mockResolvedValue([
        ['src/unknown.ts', 2, 2, 2],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.files).toHaveLength(0)
    })

    it('should handle staged files with stageStatus: 3', async () => {
      // HEADStatus: 0, workdirStatus: 2, stageStatus: 3
      mockedStatusMatrix.mockResolvedValue([
        ['src/new-staged-3.ts', 0, 2, 3],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.files[0].status).toBe('staged')
      expect(result.files[0].staged).toBe(true)
    })
  })

  describe('counts calculation', () => {
    beforeEach(() => {
      mockedStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any)
      mockedCurrentBranch.mockResolvedValue('main')
    })

    it('should calculate counts correctly for multiple file types', async () => {
      mockedStatusMatrix.mockResolvedValue([
        ['modified1.ts', 1, 2, 1],
        ['modified2.ts', 1, 2, 1],
        ['modified3.ts', 1, 2, 1],
        ['untracked1.ts', 0, 2, 0],
        ['untracked2.ts', 0, 2, 0],
        ['deleted.ts', 1, 0, 1],
        ['staged.ts', 0, 2, 2],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.counts).toEqual({
        modified: 3,
        untracked: 2,
        deleted: 1,
        staged: 1,
        conflicted: 0,
      })
    })

    it('should have zero counts when all files are unmodified', async () => {
      mockedStatusMatrix.mockResolvedValue([
        ['file1.ts', 1, 1, 1],
        ['file2.ts', 1, 1, 1],
      ])

      const result = await service.getStatus('/path/to/project')

      expect(result.counts).toEqual({
        modified: 0,
        untracked: 0,
        deleted: 0,
        staged: 0,
        conflicted: 0,
      })
    })
  })

  describe('file capping (GIT_STATUS_CAP)', () => {
    beforeEach(() => {
      mockedStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any)
      mockedCurrentBranch.mockResolvedValue('main')
    })

    it('should cap file entries at 10000', async () => {
      // Create 10001 modified files
      const largeMatrix = Array.from({ length: 10001 }, (_, i) => [
        `file${i}.ts`,
        1,
        2,
        1,
      ])
      mockedStatusMatrix.mockResolvedValue(largeMatrix as any)

      const result = await service.getStatus('/path/to/project')

      expect(result.files).toHaveLength(10000)
      expect(result.truncated).toBe(true)
    })

    it('should not truncate when below cap', async () => {
      const matrix = Array.from({ length: 100 }, (_, i) => [
        `file${i}.ts`,
        1,
        2,
        1,
      ])
      mockedStatusMatrix.mockResolvedValue(matrix as any)

      const result = await service.getStatus('/path/to/project')

      expect(result.files).toHaveLength(100)
      expect(result.truncated).toBe(false)
    })

    it('should set truncated to false when exactly at cap', async () => {
      const matrix = Array.from({ length: 10000 }, (_, i) => [
        `file${i}.ts`,
        1,
        2,
        1,
      ])
      mockedStatusMatrix.mockResolvedValue(matrix as any)

      const result = await service.getStatus('/path/to/project')

      expect(result.files).toHaveLength(10000)
      expect(result.truncated).toBe(false)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockedStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any)
    })

    it('should handle errors gracefully when statusMatrix fails', async () => {
      mockedCurrentBranch.mockResolvedValue('main')
      mockedStatusMatrix.mockRejectedValue(new Error('Git error'))

      const result = await service.getStatus('/path/to/project')

      // When statusMatrix fails, service returns error in response
      expect(result.error).toBe('Git error')
      expect(result.isGitRepo).toBe(false)
      expect(result.files).toEqual([])
    })

    it('should include error message in response', async () => {
      const errorMessage = 'Failed to read git repository'
      mockedCurrentBranch.mockResolvedValue('main')
      mockedStatusMatrix.mockRejectedValue(new Error(errorMessage))

      const result = await service.getStatus('/path/to/project')

      expect(result.error).toBe(errorMessage)
    })

    it('should continue without branch when currentBranch fails', async () => {
      mockedCurrentBranch.mockRejectedValue(new Error('Branch error'))
      mockedStatusMatrix.mockResolvedValue([
        ['file.ts', 1, 2, 1],
      ])

      const result = await service.getStatus('/path/to/project')

      // Should still process files even if branch detection failed
      expect(result.files).toHaveLength(1)
    })

    it('should handle non-Error throws with Unknown error message', async () => {
      mockedCurrentBranch.mockResolvedValue('main')
      mockedStatusMatrix.mockRejectedValue('String error')

      const result = await service.getStatus('/path/to/project')

      // Non-Error throws get 'Unknown error' message
      expect(result.error).toBe('Unknown error')
      expect(result.isGitRepo).toBe(false)
    })
  })

  describe('operation queue (concurrency control)', () => {
    beforeEach(() => {
      mockedStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any)
      mockedCurrentBranch.mockResolvedValue('main')
    })

    it('should serialize concurrent getStatus calls for the same project', async () => {
      const callOrder: number[] = []
      let resolveFirst: () => void
      let resolveSecond: () => void
      let resolveThird: () => void

      // First call starts immediately but waits
      const firstPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      // Second call should wait for first
      const secondPromise = new Promise<void>((resolve) => {
        resolveSecond = resolve
      })
      // Third call should wait for second
      const thirdPromise = new Promise<void>((resolve) => {
        resolveThird = resolve
      })

      mockedStatusMatrix
        .mockImplementationOnce(async () => {
          callOrder.push(1)
          await firstPromise
          return [['file1.ts', 1, 2, 1]]
        })
        .mockImplementationOnce(async () => {
          callOrder.push(2)
          await secondPromise
          return [['file2.ts', 1, 2, 1]]
        })
        .mockImplementationOnce(async () => {
          callOrder.push(3)
          await thirdPromise
          return [['file3.ts', 1, 2, 1]]
        })

      // Start all calls concurrently
      const result1Promise = service.getStatus('/project')
      const result2Promise = service.getStatus('/project')
      const result3Promise = service.getStatus('/project')

      // Give time for all to queue
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Only first call should have started
      expect(callOrder).toEqual([1])

      // Resolve first, second should start
      resolveFirst!()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(callOrder).toEqual([1, 2])

      // Resolve second, third should start
      resolveSecond!()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(callOrder).toEqual([1, 2, 3])

      // Resolve third
      resolveThird!()

      // All should complete
      const [result1, result2, result3] = await Promise.all([result1Promise, result2Promise, result3Promise])

      expect(result1.files[0].path).toContain('file1.ts')
      expect(result2.files[0].path).toContain('file2.ts')
      expect(result3.files[0].path).toContain('file3.ts')
    })

    it('should allow parallel getStatus calls for different projects', async () => {
      const callOrder: string[] = []
      let resolveProjectA: () => void
      let resolveProjectB: () => void

      const projectAPromise = new Promise<void>((resolve) => {
        resolveProjectA = resolve
      })
      const projectBPromise = new Promise<void>((resolve) => {
        resolveProjectB = resolve
      })

      mockedStatusMatrix.mockImplementation(async (options: { dir: string }) => {
        const project = options.dir.includes('projectA') ? 'A' : 'B'
        callOrder.push(`start-${project}`)

        if (project === 'A') {
          await projectAPromise
        } else {
          await projectBPromise
        }

        callOrder.push(`end-${project}`)
        return [[`file-${project}.ts`, 1, 2, 1]]
      })

      // Start calls to different projects
      const resultA = service.getStatus('/projectA')
      const resultB = service.getStatus('/projectB')

      // Give time for both to start
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Both should have started (parallel execution)
      expect(callOrder).toContain('start-A')
      expect(callOrder).toContain('start-B')

      // Resolve both
      resolveProjectA!()
      resolveProjectB!()

      const [a, b] = await Promise.all([resultA, resultB])
      expect(a.files[0].path).toContain('file-A.ts')
      expect(b.files[0].path).toContain('file-B.ts')
    })

    it('should continue queue after operation failure', async () => {
      mockedStatusMatrix
        .mockRejectedValueOnce(new Error('First operation failed'))
        .mockResolvedValueOnce([['file.ts', 1, 2, 1]])

      // First call fails
      const result1 = await service.getStatus('/project')
      expect(result1.error).toBe('First operation failed')

      // Second call should still work
      const result2 = await service.getStatus('/project')
      expect(result2.error).toBeUndefined()
      expect(result2.files).toHaveLength(1)
    })

    it('should not block queue when previous call fails during concurrent requests', async () => {
      let resolveSecond: () => void
      const secondPromise = new Promise<void>((resolve) => {
        resolveSecond = resolve
      })

      mockedStatusMatrix
        .mockRejectedValueOnce(new Error('First operation failed'))
        .mockImplementationOnce(async () => {
          await secondPromise
          return [['file.ts', 1, 2, 1]]
        })

      // Start both calls
      const result1Promise = service.getStatus('/project')
      const result2Promise = service.getStatus('/project')

      // Wait for first to fail and second to start
      await result1Promise
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Resolve second
      resolveSecond!()

      const [result1, result2] = await Promise.all([result1Promise, result2Promise])

      expect(result1.error).toBe('First operation failed')
      expect(result2.error).toBeUndefined()
      expect(result2.files).toHaveLength(1)
    })

    it('should clean up queue after operation completes', async () => {
      mockedStatusMatrix.mockResolvedValue([])

      // First call
      await service.getStatus('/project')

      // Access private operationQueues via type assertion for testing
      const serviceWithPrivates = service as unknown as { operationQueues: Map<string, Promise<unknown>> }

      // Queue should be cleaned up
      expect(serviceWithPrivates.operationQueues.has('/project')).toBe(false)
    })
  })

  describe('complete scenarios', () => {
    beforeEach(() => {
      mockedStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any)
    })

    it('should return complete response for typical repo', async () => {
      mockedCurrentBranch.mockResolvedValue('feature/git-status')
      mockedStatusMatrix.mockResolvedValue([
        ['src/index.ts', 1, 2, 1], // modified
        ['README.md', 0, 2, 0], // untracked
        ['docs/guide.md', 1, 2, 2], // staged
      ])

      const result = await service.getStatus('/path/to/project')

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

    it('should return clean repo response', async () => {
      mockedCurrentBranch.mockResolvedValue('main')
      mockedStatusMatrix.mockResolvedValue([])

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
  })
})

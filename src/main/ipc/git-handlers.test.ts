// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Git IPC Handlers
 * ============================
 * Tests for git-related IPC handler registration and validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerGitHandlers } from './git-handlers'
import { gitStatusService } from '../services/GitStatusService'
import type { GitStatusResponse } from '../../shared/ipc/git-schema'

// Mock LoggingService - use vi.hoisted to create mock before vi.mock hoisting
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))
vi.mock('../services/LoggingService', () => ({
  logger: mockLogger
}))

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

// Mock GitStatusService
vi.mock('../services/GitStatusService', () => ({
  gitStatusService: {
    getStatus: vi.fn(),
  },
}))

// Mock pathSecurity
vi.mock('../utils/pathSecurity', () => ({
  validateProjectPath: vi.fn().mockResolvedValue(undefined),
}))

const mockedIpcMainHandle = vi.mocked(ipcMain.handle)
const mockedGetStatus = vi.mocked(gitStatusService.getStatus)

describe('git-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('registerGitHandlers', () => {
    it('should register git:getStatus handler', () => {
      registerGitHandlers()

      expect(mockedIpcMainHandle).toHaveBeenCalledWith(
        'git:getStatus',
        expect.any(Function)
      )
    })

    it('should register exactly one handler', () => {
      registerGitHandlers()

      expect(mockedIpcMainHandle).toHaveBeenCalledTimes(1)
    })
  })

  describe('git:getStatus handler', () => {
     
    let handler: (event: any, projectPath: string) => Promise<any>

    beforeEach(() => {
      registerGitHandlers()
      // Extract the handler function from the mock call
      const calls = mockedIpcMainHandle.mock.calls
      const gitStatusCall = calls.find((call) => call[0] === 'git:getStatus')
      handler = gitStatusCall![1]
    })

    it('should call gitStatusService.getStatus with project path', async () => {
      const mockResponse: GitStatusResponse = {
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files: [],
        counts: {
          modified: 0,
          untracked: 0,
          deleted: 0,
          staged: 0,
          conflicted: 0,
        },
        truncated: false,
      }
      mockedGetStatus.mockResolvedValue(mockResponse)

      const result = await handler({}, '/path/to/project')

      expect(mockedGetStatus).toHaveBeenCalledWith('/path/to/project')
      expect(result).toEqual(mockResponse)
    })

    it('should return correct response shape', async () => {
      const mockResponse: GitStatusResponse = {
        isGitRepo: true,
        branch: 'develop',
        isDetached: false,
        files: [
          { path: 'src/index.ts', status: 'modified', staged: false },
        ],
        counts: {
          modified: 1,
          untracked: 0,
          deleted: 0,
          staged: 0,
          conflicted: 0,
        },
        truncated: false,
      }
      mockedGetStatus.mockResolvedValue(mockResponse)

      const result = await handler({}, '/path/to/project')

      expect(result).toMatchObject({
        isGitRepo: true,
        branch: 'develop',
        isDetached: false,
        files: expect.any(Array),
        counts: expect.any(Object),
        truncated: false,
      })
    })

    describe('input validation', () => {
      it('should throw error when projectPath is not a string', async () => {
        await expect(handler({}, 123)).rejects.toThrow('Invalid project path: must be a non-empty string')
        expect(mockedGetStatus).not.toHaveBeenCalled()
      })

      it('should throw error when projectPath is null', async () => {
        await expect(handler({}, null)).rejects.toThrow('Invalid project path: must be a non-empty string')
        expect(mockedGetStatus).not.toHaveBeenCalled()
      })

      it('should throw error when projectPath is undefined', async () => {
        await expect(handler({}, undefined)).rejects.toThrow('Invalid project path: must be a non-empty string')
        expect(mockedGetStatus).not.toHaveBeenCalled()
      })

      it('should throw error when projectPath is empty string', async () => {
        await expect(handler({}, '')).rejects.toThrow('Invalid project path: must be a non-empty string')
        expect(mockedGetStatus).not.toHaveBeenCalled()
      })

      it('should throw error when projectPath is whitespace only', async () => {
        await expect(handler({}, '   ')).rejects.toThrow('Invalid project path: path is empty after trimming')
        expect(mockedGetStatus).not.toHaveBeenCalled()
      })

      it('should trim whitespace from projectPath', async () => {
        const mockResponse: GitStatusResponse = {
          isGitRepo: true,
          branch: 'main',
          isDetached: false,
          files: [],
          counts: {
            modified: 0,
            untracked: 0,
            deleted: 0,
            staged: 0,
            conflicted: 0,
          },
          truncated: false,
        }
        mockedGetStatus.mockResolvedValue(mockResponse)

        await handler({}, '  /path/to/project  ')

        expect(mockedGetStatus).toHaveBeenCalledWith('/path/to/project')
      })

      it('should accept valid path with leading whitespace', async () => {
        const mockResponse: GitStatusResponse = {
          isGitRepo: true,
          branch: 'main',
          isDetached: false,
          files: [],
          counts: {
            modified: 0,
            untracked: 0,
            deleted: 0,
            staged: 0,
            conflicted: 0,
          },
          truncated: false,
        }
        mockedGetStatus.mockResolvedValue(mockResponse)

        await expect(handler({}, '  /path/to/project')).resolves.toEqual(mockResponse)
      })

      it('should accept valid path with trailing whitespace', async () => {
        const mockResponse: GitStatusResponse = {
          isGitRepo: true,
          branch: 'main',
          isDetached: false,
          files: [],
          counts: {
            modified: 0,
            untracked: 0,
            deleted: 0,
            staged: 0,
            conflicted: 0,
          },
          truncated: false,
        }
        mockedGetStatus.mockResolvedValue(mockResponse)

        await expect(handler({}, '/path/to/project  ')).resolves.toEqual(mockResponse)
      })
    })

    describe('error handling', () => {
      it('should propagate errors from gitStatusService', async () => {
        const error = new Error('Git service error')
        mockedGetStatus.mockRejectedValue(error)

        await expect(handler({}, '/path/to/project')).rejects.toThrow('Git service error')
      })

      it('should propagate custom error messages', async () => {
        mockedGetStatus.mockRejectedValue(new Error('Not a git repository'))

        await expect(handler({}, '/path/to/project')).rejects.toThrow('Not a git repository')
      })

      it('should log errors to logger', async () => {
        mockLogger.error.mockClear()
        const error = new Error('Test error')
        mockedGetStatus.mockRejectedValue(error)

        try {
          await handler({}, '/path/to/project')
        } catch {
          // Expected to throw
        }

        expect(mockLogger.error).toHaveBeenCalledWith(
          '🔀 Error in git:getStatus handler',
          error
        )
      })
    })

    describe('various project paths', () => {
      beforeEach(() => {
        mockedGetStatus.mockResolvedValue({
          isGitRepo: true,
          branch: 'main',
          isDetached: false,
          files: [],
          counts: {
            modified: 0,
            untracked: 0,
            deleted: 0,
            staged: 0,
            conflicted: 0,
          },
          truncated: false,
        })
      })

      it('should handle absolute Unix path', async () => {
        await handler({}, '/Users/test/projects/myproject')
        expect(mockedGetStatus).toHaveBeenCalledWith('/Users/test/projects/myproject')
      })

      it('should handle absolute Windows path', async () => {
        await handler({}, 'C:\\Users\\test\\projects\\myproject')
        expect(mockedGetStatus).toHaveBeenCalledWith('C:\\Users\\test\\projects\\myproject')
      })

      it('should handle path with spaces', async () => {
        await handler({}, '/Users/test/My Projects/my project')
        expect(mockedGetStatus).toHaveBeenCalledWith('/Users/test/My Projects/my project')
      })

      it('should handle path with special characters', async () => {
        await handler({}, '/Users/test/projects/my-project_v2')
        expect(mockedGetStatus).toHaveBeenCalledWith('/Users/test/projects/my-project_v2')
      })
    })

    describe('response variations', () => {
      it('should handle non-git repo response', async () => {
        const mockResponse: GitStatusResponse = {
          isGitRepo: false,
          branch: null,
          isDetached: false,
          files: [],
          counts: {
            modified: 0,
            untracked: 0,
            deleted: 0,
            staged: 0,
            conflicted: 0,
          },
          truncated: false,
        }
        mockedGetStatus.mockResolvedValue(mockResponse)

        const result = await handler({}, '/path/to/non-git')

        expect(result.isGitRepo).toBe(false)
      })

      it('should handle detached HEAD response', async () => {
        const mockResponse: GitStatusResponse = {
          isGitRepo: true,
          branch: 'a1b2c3d',
          isDetached: true,
          files: [],
          counts: {
            modified: 0,
            untracked: 0,
            deleted: 0,
            staged: 0,
            conflicted: 0,
          },
          truncated: false,
        }
        mockedGetStatus.mockResolvedValue(mockResponse)

        const result = await handler({}, '/path/to/project')

        expect(result.isDetached).toBe(true)
        expect(result.branch).toBe('a1b2c3d')
      })

      it('should handle truncated response', async () => {
        const mockResponse: GitStatusResponse = {
          isGitRepo: true,
          branch: 'main',
          isDetached: false,
          files: [],
          counts: {
            modified: 10000,
            untracked: 0,
            deleted: 0,
            staged: 0,
            conflicted: 0,
          },
          truncated: true,
        }
        mockedGetStatus.mockResolvedValue(mockResponse)

        const result = await handler({}, '/path/to/large-repo')

        expect(result.truncated).toBe(true)
      })

      it('should handle error response', async () => {
        const mockResponse: GitStatusResponse = {
          isGitRepo: false,
          branch: null,
          isDetached: false,
          files: [],
          counts: {
            modified: 0,
            untracked: 0,
            deleted: 0,
            staged: 0,
            conflicted: 0,
          },
          truncated: false,
          error: 'Failed to read git repository',
        }
        mockedGetStatus.mockResolvedValue(mockResponse)

        const result = await handler({}, '/path/to/project')

        expect(result.error).toBe('Failed to read git repository')
      })
    })
  })
})

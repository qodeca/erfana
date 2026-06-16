// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Git Store - Zustand State Management
 * ================================================
 * Tests for git status state management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useGitStore } from './useGitStore'
import type { GitStatusResponse, GitFileEntry } from '../../../shared/ipc/git-schema'

describe('useGitStore', () => {
  beforeEach(() => {
    // Clear store before each test
    useGitStore.getState().clear()
  })

  describe('initial state', () => {
    it('should have isGitRepo as false', () => {
      const state = useGitStore.getState()
      expect(state.isGitRepo).toBe(false)
    })

    it('should have null branch', () => {
      const state = useGitStore.getState()
      expect(state.branch).toBeNull()
    })

    it('should have isDetached as false', () => {
      const state = useGitStore.getState()
      expect(state.isDetached).toBe(false)
    })

    it('should have empty file statuses map', () => {
      const state = useGitStore.getState()
      expect(state.fileStatuses.size).toBe(0)
    })

    it('should have empty folder statuses map', () => {
      const state = useGitStore.getState()
      expect(state.folderStatuses.size).toBe(0)
    })

    it('should have zero counts', () => {
      const state = useGitStore.getState()
      expect(state.counts).toEqual({
        modified: 0,
        untracked: 0,
        deleted: 0,
        staged: 0,
        conflicted: 0,
      })
    })

    it('should have truncated as false', () => {
      const state = useGitStore.getState()
      expect(state.truncated).toBe(false)
    })

    it('should have null error', () => {
      const state = useGitStore.getState()
      expect(state.error).toBeNull()
    })

    it('should have isRefreshing as false', () => {
      const state = useGitStore.getState()
      expect(state.isRefreshing).toBe(false)
    })

    it('should have lastRefreshTime as 0', () => {
      const state = useGitStore.getState()
      expect(state.lastRefreshTime).toBe(0)
    })
  })

  describe('setStatus', () => {
    it('should update isGitRepo', () => {
      const response: GitStatusResponse = {
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

      useGitStore.getState().setStatus(response)
      expect(useGitStore.getState().isGitRepo).toBe(true)
    })

    it('should update branch name', () => {
      const response: GitStatusResponse = {
        isGitRepo: true,
        branch: 'develop',
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

      useGitStore.getState().setStatus(response)
      expect(useGitStore.getState().branch).toBe('develop')
    })

    it('should update isDetached', () => {
      const response: GitStatusResponse = {
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

      useGitStore.getState().setStatus(response)
      expect(useGitStore.getState().isDetached).toBe(true)
    })

    it('should build file statuses map from response files', () => {
      const files: GitFileEntry[] = [
        { path: 'src/index.ts', status: 'modified', staged: false },
        { path: 'README.md', status: 'untracked', staged: false },
      ]

      const response: GitStatusResponse = {
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files,
        counts: {
          modified: 1,
          untracked: 1,
          deleted: 0,
          staged: 0,
          conflicted: 0,
        },
        truncated: false,
      }

      useGitStore.getState().setStatus(response)
      const state = useGitStore.getState()

      expect(state.fileStatuses.get('src/index.ts')).toBe('modified')
      expect(state.fileStatuses.get('README.md')).toBe('untracked')
      expect(state.fileStatuses.size).toBe(2)
    })

    it('should calculate folder statuses via propagation logic', () => {
      const files: GitFileEntry[] = [
        { path: 'src/components/Button.tsx', status: 'modified', staged: false },
        { path: 'src/utils/helpers.ts', status: 'deleted', staged: false },
      ]

      const response: GitStatusResponse = {
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files,
        counts: {
          modified: 1,
          untracked: 0,
          deleted: 1,
          staged: 0,
          conflicted: 0,
        },
        truncated: false,
      }

      useGitStore.getState().setStatus(response)
      const state = useGitStore.getState()

      expect(state.folderStatuses.get('src/components')).toBe('modified')
      expect(state.folderStatuses.get('src/utils')).toBe('deleted')
      // src should have highest priority: deleted (4) > modified (3)
      expect(state.folderStatuses.get('src')).toBe('deleted')
    })

    it('should update counts', () => {
      const response: GitStatusResponse = {
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files: [],
        counts: {
          modified: 5,
          untracked: 3,
          deleted: 1,
          staged: 2,
          conflicted: 0,
        },
        truncated: false,
      }

      useGitStore.getState().setStatus(response)
      expect(useGitStore.getState().counts).toEqual({
        modified: 5,
        untracked: 3,
        deleted: 1,
        staged: 2,
        conflicted: 0,
      })
    })

    it('should update truncated flag', () => {
      const response: GitStatusResponse = {
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
        truncated: true,
      }

      useGitStore.getState().setStatus(response)
      expect(useGitStore.getState().truncated).toBe(true)
    })

    it('should set error to null when no error in response', () => {
      const response: GitStatusResponse = {
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

      useGitStore.getState().setStatus(response)
      expect(useGitStore.getState().error).toBeNull()
    })

    it('should set error from response', () => {
      const response: GitStatusResponse = {
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
        error: 'Not a git repository',
      }

      useGitStore.getState().setStatus(response)
      expect(useGitStore.getState().error).toBe('Not a git repository')
    })

    it('should update lastRefreshTime to current timestamp', () => {
      const beforeTime = Date.now()

      const response: GitStatusResponse = {
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

      useGitStore.getState().setStatus(response)

      const afterTime = Date.now()
      const lastRefreshTime = useGitStore.getState().lastRefreshTime

      expect(lastRefreshTime).toBeGreaterThanOrEqual(beforeTime)
      expect(lastRefreshTime).toBeLessThanOrEqual(afterTime)
    })

    it('should replace previous file statuses on new setStatus call', () => {
      const response1: GitStatusResponse = {
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files: [
          { path: 'file1.ts', status: 'modified', staged: false },
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

      useGitStore.getState().setStatus(response1)
      expect(useGitStore.getState().fileStatuses.get('file1.ts')).toBe('modified')

      const response2: GitStatusResponse = {
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files: [
          { path: 'file2.ts', status: 'untracked', staged: false },
        ],
        counts: {
          modified: 0,
          untracked: 1,
          deleted: 0,
          staged: 0,
          conflicted: 0,
        },
        truncated: false,
      }

      useGitStore.getState().setStatus(response2)
      expect(useGitStore.getState().fileStatuses.get('file1.ts')).toBeUndefined()
      expect(useGitStore.getState().fileStatuses.get('file2.ts')).toBe('untracked')
    })
  })

  describe('setRefreshing', () => {
    it('should set isRefreshing to true', () => {
      useGitStore.getState().setRefreshing(true)
      expect(useGitStore.getState().isRefreshing).toBe(true)
    })

    it('should set isRefreshing to false', () => {
      useGitStore.getState().setRefreshing(true)
      useGitStore.getState().setRefreshing(false)
      expect(useGitStore.getState().isRefreshing).toBe(false)
    })
  })

  describe('getFileStatus', () => {
    beforeEach(() => {
      const response: GitStatusResponse = {
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files: [
          { path: 'src/index.ts', status: 'modified', staged: false },
          { path: 'README.md', status: 'untracked', staged: false },
        ],
        counts: {
          modified: 1,
          untracked: 1,
          deleted: 0,
          staged: 0,
          conflicted: 0,
        },
        truncated: false,
      }
      useGitStore.getState().setStatus(response)
    })

    it('should return status for existing file', () => {
      const status = useGitStore.getState().getFileStatus('src/index.ts')
      expect(status).toBe('modified')
    })

    it('should return undefined for non-existent file', () => {
      const status = useGitStore.getState().getFileStatus('nonexistent.ts')
      expect(status).toBeUndefined()
    })

    it('should return correct status for each file', () => {
      expect(useGitStore.getState().getFileStatus('src/index.ts')).toBe('modified')
      expect(useGitStore.getState().getFileStatus('README.md')).toBe('untracked')
    })
  })

  describe('getFolderStatus', () => {
    beforeEach(() => {
      const response: GitStatusResponse = {
        isGitRepo: true,
        branch: 'main',
        isDetached: false,
        files: [
          { path: 'src/components/Button.tsx', status: 'modified', staged: false },
          { path: 'docs/README.md', status: 'deleted', staged: false },
        ],
        counts: {
          modified: 1,
          untracked: 0,
          deleted: 1,
          staged: 0,
          conflicted: 0,
        },
        truncated: false,
      }
      useGitStore.getState().setStatus(response)
    })

    it('should return status for existing folder', () => {
      const status = useGitStore.getState().getFolderStatus('src')
      expect(status).toBe('modified')
    })

    it('should return undefined for non-existent folder', () => {
      const status = useGitStore.getState().getFolderStatus('nonexistent')
      expect(status).toBeUndefined()
    })

    it('should return correct status for each folder', () => {
      expect(useGitStore.getState().getFolderStatus('src/components')).toBe('modified')
      expect(useGitStore.getState().getFolderStatus('src')).toBe('modified')
      expect(useGitStore.getState().getFolderStatus('docs')).toBe('deleted')
    })
  })

  describe('clear', () => {
    beforeEach(() => {
      // Set up some state
      const response: GitStatusResponse = {
        isGitRepo: true,
        branch: 'develop',
        isDetached: true,
        files: [
          { path: 'file.ts', status: 'modified', staged: false },
        ],
        counts: {
          modified: 1,
          untracked: 0,
          deleted: 0,
          staged: 0,
          conflicted: 0,
        },
        truncated: true,
        error: 'Some error',
      }
      useGitStore.getState().setStatus(response)
      useGitStore.getState().setRefreshing(true)
    })

    it('should reset isGitRepo to false', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().isGitRepo).toBe(false)
    })

    it('should reset branch to null', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().branch).toBeNull()
    })

    it('should reset isDetached to false', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().isDetached).toBe(false)
    })

    it('should clear file statuses map', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().fileStatuses.size).toBe(0)
    })

    it('should clear folder statuses map', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().folderStatuses.size).toBe(0)
    })

    it('should reset counts to zero', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().counts).toEqual({
        modified: 0,
        untracked: 0,
        deleted: 0,
        staged: 0,
        conflicted: 0,
      })
    })

    it('should reset truncated to false', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().truncated).toBe(false)
    })

    it('should reset error to null', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().error).toBeNull()
    })

    it('should reset isRefreshing to false', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().isRefreshing).toBe(false)
    })

    it('should reset lastRefreshTime to 0', () => {
      useGitStore.getState().clear()
      expect(useGitStore.getState().lastRefreshTime).toBe(0)
    })

    it('should return to initial state completely', () => {
      useGitStore.getState().clear()
      const state = useGitStore.getState()

      expect(state.isGitRepo).toBe(false)
      expect(state.branch).toBeNull()
      expect(state.isDetached).toBe(false)
      expect(state.fileStatuses.size).toBe(0)
      expect(state.folderStatuses.size).toBe(0)
      expect(state.counts).toEqual({
        modified: 0,
        untracked: 0,
        deleted: 0,
        staged: 0,
        conflicted: 0,
      })
      expect(state.truncated).toBe(false)
      expect(state.error).toBeNull()
      expect(state.isRefreshing).toBe(false)
      expect(state.lastRefreshTime).toBe(0)
    })
  })
})

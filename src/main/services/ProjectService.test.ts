// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectService.test.ts
 *
 * Integration tests for ProjectService with ProjectLockService
 *
 * Coverage:
 * - Lock acquisition before project settings load
 * - Lock release after successful project switch
 * - Lock retention on failed project switch (rollback)
 * - Focus request when project is already locked
 * - Graceful degradation on lock acquisition errors
 * - Lock release rollback on switch failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import { ProjectService } from './ProjectService'
import type { IFileService } from '../interfaces/IFileService'
import type { IFileWatcherService } from '../interfaces/IFileWatcherService'
import type { IDirectoryWatcherService } from '../interfaces/IDirectoryWatcherService'
import type { ISettingsService } from '../interfaces/ISettingsService'
import type { IProjectSettingsService } from '../interfaces/IProjectSettingsService'
import type { IProjectLockService } from '../interfaces/IProjectLockService'
import { AppError, ErrorCode } from '../../shared/errors'

// Mock BrowserWindow
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

// Mock path security
vi.mock('../utils/pathSecurity', () => ({
  validatePath: vi.fn(() => Promise.resolve())
}))

// ProjectLockService will be injected, not mocked globally

// Mock LoggingService
vi.mock('./LoggingService', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Mock fs/promises
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  realpath: vi.fn()
}))

import { stat, realpath } from 'fs/promises'

const mockedStat = vi.mocked(stat)
const mockedRealpath = vi.mocked(realpath)

describe('ProjectService integration with ProjectLockService', () => {
  let projectService: ProjectService
  let mockFileService: IFileService
  let mockFileWatcherService: IFileWatcherService
  let mockDirectoryWatcherService: IDirectoryWatcherService
  let mockSettingsService: ISettingsService
  let mockProjectSettingsService: IProjectSettingsService
  let mockProjectLockService: IProjectLockService

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup mocked services
    mockFileService = {
      setProjectPath: vi.fn(),
      getProjectPath: vi.fn(() => null),
      setHiddenPatterns: vi.fn()
    } as any

    mockFileWatcherService = {
      setProjectPath: vi.fn(),
      stopAll: vi.fn(() => Promise.resolve())
    } as any

    mockDirectoryWatcherService = {
      setProjectPath: vi.fn(),
      stopAll: vi.fn(() => Promise.resolve()),
      setIgnorePatterns: vi.fn()
    } as any

    mockSettingsService = {
      setLastProjectPath: vi.fn(() => Promise.resolve()),
      addRecentProject: vi.fn(() => Promise.resolve())
    } as any

    mockProjectSettingsService = {
      loadSettings: vi.fn(() =>
        Promise.resolve({
          treeHiddenPatterns: [],
          watcherIgnorePatterns: []
        })
      ),
      clearSettings: vi.fn()
    } as any

    // Setup mock for projectLockService (injected, not global)
    mockProjectLockService = {
      acquireLock: vi.fn().mockResolvedValue({
        status: 'acquired',
        lockPath: '/Users/test/.erfana/locks/hash.lock'
      }),
      releaseLock: vi.fn().mockResolvedValue(undefined),
      requestFocus: vi.fn().mockResolvedValue(true),
      checkLock: vi.fn(),
      cleanupStaleLocks: vi.fn(),
      getLocksDirectory: vi.fn(),
      computeLockHash: vi.fn(),
      dispose: vi.fn()
    }

    // Setup default mocks for fs
    mockedStat.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false
    } as any)

    mockedRealpath.mockImplementation((path) => Promise.resolve(path.toString()))

    projectService = new ProjectService(
      mockFileService,
      mockFileWatcherService,
      mockDirectoryWatcherService,
      mockSettingsService,
      mockProjectSettingsService,
      mockProjectLockService
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Lock acquisition during project switch', () => {
    it('should acquire lock before loading project settings', async () => {
      const projectPath = '/Users/test/projects/my-project'

      // Track call order
      const callOrder: string[] = []

      mockProjectLockService.acquireLock.mockImplementation(async () => {
        callOrder.push('acquireLock')
        return { status: 'acquired', lockPath: '/locks/hash.lock' }
      })

      mockProjectSettingsService.loadSettings.mockImplementation(async () => {
        callOrder.push('loadSettings')
        return { treeHiddenPatterns: [], watcherIgnorePatterns: [] }
      })

      await projectService.switchProject(projectPath)

      // Verify lock was acquired before settings were loaded
      expect(callOrder).toEqual(['acquireLock', 'loadSettings'])
      expect(mockProjectLockService.acquireLock).toHaveBeenCalledWith(projectPath)
    })

    it('should release old lock after successful switch', async () => {
      const oldProjectPath = '/Users/test/projects/old-project'
      const newProjectPath = '/Users/test/projects/new-project'

      // Setup: already have a project open
      mockFileService.getProjectPath.mockReturnValue(oldProjectPath)

      // Mock different paths for canonicalization
      mockedRealpath.mockImplementation((path) => {
        return Promise.resolve(path.toString())
      })

      await projectService.switchProject(newProjectPath)

      // Verify new lock acquired
      expect(mockProjectLockService.acquireLock).toHaveBeenCalledWith(newProjectPath)

      // Verify old lock released (fire-and-forget, so called but not awaited)
      expect(mockProjectLockService.releaseLock).toHaveBeenCalledWith(oldProjectPath)
    })

    it('should NOT release old lock if switch fails before completion', async () => {
      const oldProjectPath = '/Users/test/projects/old-project'
      const newProjectPath = '/Users/test/projects/new-project'

      // Setup: already have a project open
      mockFileService.getProjectPath.mockReturnValue(oldProjectPath)

      // Mock successful lock acquisition
      mockProjectLockService.acquireLock.mockResolvedValue({
        status: 'acquired',
        lockPath: '/locks/new.lock'
      })

      // Make settings load fail
      mockProjectSettingsService.loadSettings.mockRejectedValue(
        new AppError('Invalid settings', ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED)
      )

      await projectService.switchProject(newProjectPath)

      // Old lock should NOT be released (still valid)
      expect(mockProjectLockService.releaseLock).not.toHaveBeenCalledWith(oldProjectPath)

      // New lock SHOULD be released (rollback)
      expect(mockProjectLockService.releaseLock).toHaveBeenCalledWith(newProjectPath)
    })

    it('should release new lock on rollback when switch fails', async () => {
      const projectPath = '/Users/test/projects/new-project'

      // Mock successful lock acquisition
      mockProjectLockService.acquireLock.mockResolvedValue({
        status: 'acquired',
        lockPath: '/locks/hash.lock'
      })

      // Make directory stat fail (simulate directory not found)
      mockedStat.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      const result = await projectService.switchProject(projectPath)

      // Switch should fail
      expect(result.success).toBe(false)

      // Lock should be released during rollback
      expect(mockProjectLockService.releaseLock).toHaveBeenCalledWith(projectPath)
    })
  })

  describe('Already locked project handling', () => {
    it('should request focus and return early when project already locked', async () => {
      const projectPath = '/Users/test/projects/locked-project'

      // Mock lock already held by another instance
      mockProjectLockService.acquireLock.mockResolvedValue({
        status: 'already_locked',
        holderPid: 12345,
        holderHostname: 'other-machine.local'
      })

      mockProjectLockService.requestFocus.mockResolvedValue(true)

      const result = await projectService.switchProject(projectPath)

      // Should fail with focused_existing error
      expect(result.success).toBe(false)
      expect(result.error).toBe('focused_existing')

      // Should request focus
      expect(mockProjectLockService.requestFocus).toHaveBeenCalledWith(projectPath)

      // Should NOT load settings
      expect(mockProjectSettingsService.loadSettings).not.toHaveBeenCalled()

      // Should NOT update services
      expect(mockFileService.setProjectPath).not.toHaveBeenCalled()
    })

    it('should return early even if focus request fails', async () => {
      const projectPath = '/Users/test/projects/locked-project'

      mockProjectLockService.acquireLock.mockResolvedValue({
        status: 'already_locked',
        holderPid: 12345,
        holderHostname: 'other-machine.local'
      })

      // Focus request fails
      mockProjectLockService.requestFocus.mockResolvedValue(false)

      const result = await projectService.switchProject(projectPath)

      // Should still fail with focused_existing error
      expect(result.success).toBe(false)
      expect(result.error).toBe('focused_existing')

      // Should NOT proceed with project switch
      expect(mockProjectSettingsService.loadSettings).not.toHaveBeenCalled()
    })
  })

  describe('Graceful degradation on lock errors', () => {
    it('should continue with project switch when lock acquisition errors', async () => {
      const projectPath = '/Users/test/projects/test-project'

      // Mock lock acquisition error
      mockProjectLockService.acquireLock.mockResolvedValue({
        status: 'error',
        message: 'Filesystem error: EACCES'
      })

      const result = await projectService.switchProject(projectPath)

      // Should still succeed (graceful degradation)
      expect(result.success).toBe(true)
      expect(result.action).toBe('switched')

      // Should proceed with settings load
      expect(mockProjectSettingsService.loadSettings).toHaveBeenCalledWith(projectPath)

      // Should update services
      expect(mockFileService.setProjectPath).toHaveBeenCalledWith(projectPath)
    })

    it('should handle lock release errors gracefully during switch', async () => {
      const oldProjectPath = '/Users/test/projects/old-project'
      const newProjectPath = '/Users/test/projects/new-project'

      mockFileService.getProjectPath.mockReturnValue(oldProjectPath)

      // Make lock release fail
      mockProjectLockService.releaseLock.mockRejectedValue(
        new Error('Permission denied')
      )

      // Should not throw - errors are logged but switch continues
      const result = await projectService.switchProject(newProjectPath)

      expect(result.success).toBe(true)

      // Should have attempted to release old lock
      expect(mockProjectLockService.releaseLock).toHaveBeenCalledWith(oldProjectPath)
    })

    it('should handle lock release errors gracefully during rollback', async () => {
      const projectPath = '/Users/test/projects/new-project'

      mockProjectLockService.acquireLock.mockResolvedValue({
        status: 'acquired',
        lockPath: '/locks/hash.lock'
      })

      // Make settings load fail
      mockProjectSettingsService.loadSettings.mockRejectedValue(
        new AppError('Invalid settings', ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED)
      )

      // Make lock release fail during rollback
      mockProjectLockService.releaseLock.mockRejectedValue(
        new Error('Permission denied')
      )

      // Should not throw - errors are logged
      const result = await projectService.switchProject(projectPath)

      expect(result.success).toBe(false)

      // Should have attempted to release lock during rollback
      expect(mockProjectLockService.releaseLock).toHaveBeenCalledWith(projectPath)
    })
  })

  describe('Lock lifecycle with same project detection', () => {
    it('should not acquire lock when switching to same project', async () => {
      const projectPath = '/Users/test/projects/same-project'

      mockFileService.getProjectPath.mockReturnValue(projectPath)

      // Mock realpath to return same path
      mockedRealpath.mockResolvedValue(projectPath)

      const result = await projectService.switchProject(projectPath)

      // Should be no-op
      expect(result.success).toBe(true)
      expect(result.action).toBe('noop')

      // Should not acquire lock (same project)
      expect(mockProjectLockService.acquireLock).not.toHaveBeenCalled()

      // Should not release lock
      expect(mockProjectLockService.releaseLock).not.toHaveBeenCalled()
    })

    it('should handle symlink resolution in same project detection', async () => {
      const symlinkPath = path.join(os.tmpdir(), 'erfana-test', 'symlink')
      const realPathValue = path.join(os.tmpdir(), 'erfana-test', 'actual-project')

      // Return canonicalized form that matches what canonicalizePath produces
      const canonicalized = process.platform === 'win32'
        ? realPathValue.toLowerCase()
        : realPathValue
      mockFileService.getProjectPath.mockReturnValue(canonicalized)

      // Mock realpath to resolve symlink – receives normalized path
      mockedRealpath.mockImplementation((p) => {
        const normalized = path.normalize(p.toString())
        if (normalized === path.normalize(symlinkPath)) {
          return Promise.resolve(realPathValue)
        }
        return Promise.resolve(p.toString())
      })

      const result = await projectService.switchProject(symlinkPath)

      // Should detect as same project
      expect(result.success).toBe(true)
      expect(result.action).toBe('noop')

      // Should not acquire lock
      expect(mockProjectLockService.acquireLock).not.toHaveBeenCalled()
    })
  })

  describe('Lock coordination with service updates', () => {
    it('should acquire lock before stopping watchers', async () => {
      const projectPath = '/Users/test/projects/test-project'

      const callOrder: string[] = []

      mockProjectLockService.acquireLock.mockImplementation(async () => {
        callOrder.push('acquireLock')
        return { status: 'acquired', lockPath: '/locks/hash.lock' }
      })

      mockFileWatcherService.stopAll.mockImplementation(async () => {
        callOrder.push('stopWatchers')
      })

      await projectService.switchProject(projectPath)

      // Lock should be acquired before watchers are stopped
      expect(callOrder[0]).toBe('acquireLock')
      expect(callOrder).toContain('stopWatchers')
    })

    it('should acquire lock before updating services', async () => {
      const projectPath = '/Users/test/projects/test-project'

      const callOrder: string[] = []

      mockProjectLockService.acquireLock.mockImplementation(async () => {
        callOrder.push('acquireLock')
        return { status: 'acquired', lockPath: '/locks/hash.lock' }
      })

      mockFileService.setProjectPath.mockImplementation(() => {
        callOrder.push('setProjectPath')
      })

      await projectService.switchProject(projectPath)

      // Lock should be acquired before services are updated
      expect(callOrder[0]).toBe('acquireLock')
      expect(callOrder).toContain('setProjectPath')
    })

    it('should release old lock after all service updates complete', async () => {
      const oldProjectPath = '/Users/test/projects/old-project'
      const newProjectPath = '/Users/test/projects/new-project'

      mockFileService.getProjectPath.mockReturnValue(oldProjectPath)

      const callOrder: string[] = []

      mockFileService.setProjectPath.mockImplementation(() => {
        callOrder.push('setProjectPath')
      })

      mockSettingsService.setLastProjectPath.mockImplementation(async () => {
        callOrder.push('persistSettings')
      })

      mockProjectLockService.releaseLock.mockImplementation(async () => {
        callOrder.push('releaseLock')
      })

      await projectService.switchProject(newProjectPath)

      // Release should happen after all updates
      const releaseIndex = callOrder.indexOf('releaseLock')
      const setPathIndex = callOrder.indexOf('setProjectPath')
      const persistIndex = callOrder.indexOf('persistSettings')

      expect(releaseIndex).toBeGreaterThan(setPathIndex)
      expect(releaseIndex).toBeGreaterThan(persistIndex)
    })
  })

  describe('Error handling with lock cleanup', () => {
    it('should rollback services if lock acquired but directory check fails', async () => {
      const projectPath = '/Users/test/projects/nonexistent'

      mockProjectLockService.acquireLock.mockResolvedValue({
        status: 'acquired',
        lockPath: '/locks/hash.lock'
      })

      // Directory doesn't exist
      mockedStat.mockRejectedValue(new Error('ENOENT'))

      const result = await projectService.switchProject(projectPath)

      expect(result.success).toBe(false)

      // Should rollback by releasing the acquired lock
      expect(mockProjectLockService.releaseLock).toHaveBeenCalledWith(projectPath)

      // Should clear project settings
      expect(mockProjectSettingsService.clearSettings).toHaveBeenCalled()
    })

    it('should rollback services if lock acquired but settings validation fails', async () => {
      const projectPath = '/Users/test/projects/invalid-settings'

      mockProjectLockService.acquireLock.mockResolvedValue({
        status: 'acquired',
        lockPath: '/locks/hash.lock'
      })

      // Settings validation fails
      mockProjectSettingsService.loadSettings.mockRejectedValue(
        new AppError('Invalid schema', ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED)
      )

      const result = await projectService.switchProject(projectPath)

      expect(result.success).toBe(false)

      // Should release the acquired lock
      expect(mockProjectLockService.releaseLock).toHaveBeenCalledWith(projectPath)

      // Should clear project settings
      expect(mockProjectSettingsService.clearSettings).toHaveBeenCalled()
    })

    it('should continue rollback even if lock release fails', async () => {
      const projectPath = '/Users/test/projects/test-project'

      mockProjectLockService.acquireLock.mockResolvedValue({
        status: 'acquired',
        lockPath: '/locks/hash.lock'
      })

      // Make settings load fail
      mockedStat.mockRejectedValue(new Error('ENOENT'))

      // Make lock release fail
      mockProjectLockService.releaseLock.mockRejectedValue(
        new Error('Filesystem error')
      )

      // Should not throw - rollback continues despite lock release error
      const result = await projectService.switchProject(projectPath)

      expect(result.success).toBe(false)

      // Should have attempted all rollback steps
      expect(mockProjectSettingsService.clearSettings).toHaveBeenCalled()
    })
  })
})

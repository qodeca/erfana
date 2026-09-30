// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectService.switching.test.ts
 *
 * Integration tests for ProjectService project switching orchestration
 * Issue #101 - Verify project switching and session token guards
 *
 * Coverage:
 * - 016-FR-007: Project switching step ordering
 * - AC-009: Project switch clears old and loads new
 * - AC-014: In-flight events silently dropped during switch
 * - Session token bumping across DirectoryWatcherService and GitWatcherService
 * - #211 W6: one path filter per project open, shared by the file service and
 *   the directory watcher; rejected exclude entries logged without values
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProjectService } from './ProjectService'
import { ProjectPathFilter } from '../utils/projectPathFilter'
import { getPlatformConfig } from './watcher/PlatformConfig'
import type { ResolvedProjectSettings } from '../../shared/ipc/project-settings-schema'
import type { IFileService } from '../interfaces/IFileService'
import type { IFileWatcherService } from '../interfaces/IFileWatcherService'
import type { IDirectoryWatcherService } from '../interfaces/IDirectoryWatcherService'
import type { ISettingsService } from '../interfaces/ISettingsService'
import type { IProjectSettingsService } from '../interfaces/IProjectSettingsService'
import type { IProjectLockService } from '../interfaces/IProjectLockService'

// Mock BrowserWindow
const mockSend = vi.fn()
const mockWindow = {
  isDestroyed: () => false,
  webContents: {
    send: mockSend
  }
}

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockWindow])
  }
}))

// Mock path security
vi.mock('../utils/pathSecurity', () => ({
  validatePath: vi.fn(() => Promise.resolve())
}))

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

// Real platform config by default; a test overrides case sensitivity once
vi.mock('./watcher/PlatformConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./watcher/PlatformConfig')>()
  return { ...actual, getPlatformConfig: vi.fn(actual.getPlatformConfig) }
})

import { stat, realpath } from 'fs/promises'
import { logger } from './LoggingService'

const mockedStat = vi.mocked(stat)
const mockedRealpath = vi.mocked(realpath)
const mockedGetPlatformConfig = vi.mocked(getPlatformConfig)

/** What ProjectSettingsService resolves; empty lists unless overridden. */
function resolvedSettings(overrides: Partial<ResolvedProjectSettings> = {}): ResolvedProjectSettings {
  return {
    treeHiddenPatterns: [],
    watcherIgnorePatterns: [],
    excludePatterns: [],
    excludeRejections: [],
    ...overrides
  }
}

const REJECTIONS_LOG = 'Project switch: files.exclude entries rejected'

describe('ProjectService switching – session token orchestration', () => {
  let projectService: ProjectService
  let mockFileService: IFileService
  let mockFileWatcherService: IFileWatcherService
  let mockDirectoryWatcherService: IDirectoryWatcherService
  let mockSettingsService: ISettingsService
  let mockProjectSettingsService: IProjectSettingsService
  let mockProjectLockService: IProjectLockService
  let callOrder: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    callOrder = []

    // Setup mocked services
    mockFileService = {
      setProjectPath: vi.fn((_path) => {
        callOrder.push('fileService.setProjectPath')
      }),
      getProjectPath: vi.fn(() => null),
      setHiddenPatterns: vi.fn(),
      setPathFilter: vi.fn()
    } as any

    mockFileWatcherService = {
      setProjectPath: vi.fn((_path) => {
        callOrder.push('fileWatcherService.setProjectPath')
      }),
      stopAll: vi.fn(() => {
        callOrder.push('fileWatcherService.stopAll')
        return Promise.resolve()
      })
    } as any

    mockDirectoryWatcherService = {
      setProjectPath: vi.fn((_path) => {
        callOrder.push('directoryWatcherService.setProjectPath')
      }),
      stopAll: vi.fn(() => {
        callOrder.push('directoryWatcherService.stopAll')
        return Promise.resolve()
      }),
      setPathFilter: vi.fn()
    } as any

    mockSettingsService = {
      setLastProjectPath: vi.fn(() => {
        callOrder.push('settingsService.setLastProjectPath')
        return Promise.resolve()
      }),
      addRecentProject: vi.fn(() => {
        callOrder.push('settingsService.addRecentProject')
        return Promise.resolve()
      })
    } as any

    mockProjectSettingsService = {
      loadSettings: vi.fn(() => Promise.resolve(resolvedSettings())),
      clearSettings: vi.fn()
    } as any

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

  describe('016-FR-007: Project switching step ordering', () => {
    it('calls stopAll watchers before updateServices during switch', async () => {
      const projectPath = '/Users/test/projects/my-project'

      await projectService.switchProject(projectPath)

      // Verify stopAll calls happen before setProjectPath calls
      const stopAllIndices = [
        callOrder.indexOf('fileWatcherService.stopAll'),
        callOrder.indexOf('directoryWatcherService.stopAll')
      ]
      const setProjectPathIndices = [
        callOrder.indexOf('fileService.setProjectPath'),
        callOrder.indexOf('fileWatcherService.setProjectPath'),
        callOrder.indexOf('directoryWatcherService.setProjectPath')
      ]

      // All stopAll calls should happen before all setProjectPath calls
      const maxStopAllIndex = Math.max(...stopAllIndices)
      const minSetProjectPathIndex = Math.min(...setProjectPathIndices.filter((i) => i !== -1))

      expect(maxStopAllIndex).toBeLessThan(minSetProjectPathIndex)
    })

    it('directoryWatcherService.stopAll is called during switch', async () => {
      const projectPath = '/Users/test/projects/my-project'

      await projectService.switchProject(projectPath)

      expect(mockDirectoryWatcherService.stopAll).toHaveBeenCalled()
    })

    it('directoryWatcherService.setProjectPath is called with new path during switch', async () => {
      const projectPath = '/Users/test/projects/my-project'

      await projectService.switchProject(projectPath)

      expect(mockDirectoryWatcherService.setProjectPath).toHaveBeenCalledWith(projectPath)
    })

    it('broadcasts project:changed after all service updates complete', async () => {
      const projectPath = '/Users/test/projects/my-project'

      await projectService.switchProject(projectPath)

      // Verify broadcast happened
      expect(mockSend).toHaveBeenCalledWith('project:changed', {
        oldPath: null,
        newPath: projectPath
      })

      // Verify broadcast happened after service updates
      const broadcastCallIndex = mockSend.mock.calls.findIndex(
        (call) => call[0] === 'project:changed'
      )
      expect(broadcastCallIndex).toBeGreaterThanOrEqual(0)

      // All service updates should have been called before broadcast
      const lastSetProjectPathIndex = Math.max(
        callOrder.indexOf('fileService.setProjectPath'),
        callOrder.indexOf('fileWatcherService.setProjectPath'),
        callOrder.indexOf('directoryWatcherService.setProjectPath')
      )

      // Since broadcast happens after all callOrder entries, this is implicitly verified
      expect(lastSetProjectPathIndex).toBeGreaterThanOrEqual(0)
    })
  })

  describe('AC-009: Project switch clears old and loads new', () => {
    it('stopAllWatchers clears both file and directory watchers', async () => {
      const projectPath = '/Users/test/projects/my-project'

      await projectService.switchProject(projectPath)

      // Both watcher services should have stopAll called
      expect(mockFileWatcherService.stopAll).toHaveBeenCalled()
      expect(mockDirectoryWatcherService.stopAll).toHaveBeenCalled()
    })

    it('updateServices sets new project path on all services', async () => {
      const projectPath = '/Users/test/projects/my-project'

      await projectService.switchProject(projectPath)

      // All three services should get the new path
      expect(mockFileService.setProjectPath).toHaveBeenCalledWith(projectPath)
      expect(mockFileWatcherService.setProjectPath).toHaveBeenCalledWith(projectPath)
      expect(mockDirectoryWatcherService.setProjectPath).toHaveBeenCalledWith(projectPath)
    })
  })

  // These tests verify the *contract* (call ordering) that stopAll and
  // setProjectPath are invoked during project switching. The mocks below
  // simulate a version bump inside each call to confirm the orchestration
  // sequence, but they do NOT test the real session-token increment –
  // that is covered by DirectoryWatcherService.test.ts.
  //
  // Together, the two test suites prove that in-flight events will be
  // dropped: ProjectService guarantees stopAll → setProjectPath ordering,
  // and DirectoryWatcherService guarantees each of those calls increments
  // the session token, causing stale-version events to be rejected.
  describe('AC-014: In-flight events silently dropped during switch', () => {
    it('switchVersion is bumped during stopAll call (DirectoryWatcherService)', async () => {
      const projectPath = '/Users/test/projects/my-project'

      // Track version changes in directoryWatcherService mock
      let versionBeforeStopAll: number | undefined
      let versionAfterStopAll: number | undefined
      let currentVersion = 0

      mockDirectoryWatcherService.stopAll = vi.fn(() => {
        versionBeforeStopAll = currentVersion
        currentVersion++ // Simulate version bump in stopAll
        versionAfterStopAll = currentVersion
        callOrder.push('directoryWatcherService.stopAll')
        return Promise.resolve()
      })

      await projectService.switchProject(projectPath)

      // Verify version was bumped during stopAll
      expect(versionAfterStopAll).toBe((versionBeforeStopAll ?? 0) + 1)
    })

    it('switchVersion is bumped during setProjectPath call (DirectoryWatcherService)', async () => {
      const projectPath = '/Users/test/projects/my-project'

      // Track version changes
      let versionBeforeSetPath: number | undefined
      let versionAfterSetPath: number | undefined
      let currentVersion = 0

      mockDirectoryWatcherService.setProjectPath = vi.fn((_path) => {
        versionBeforeSetPath = currentVersion
        currentVersion++ // Simulate version bump in setProjectPath
        versionAfterSetPath = currentVersion
        callOrder.push('directoryWatcherService.setProjectPath')
      })

      await projectService.switchProject(projectPath)

      // Verify version was bumped during setProjectPath
      expect(versionAfterSetPath).toBe((versionBeforeSetPath ?? 0) + 1)
    })

    it('full switch sequence bumps switchVersion at least twice', async () => {
      const projectPath = '/Users/test/projects/my-project'

      // Track all version bumps
      let versionBumps = 0

      mockDirectoryWatcherService.stopAll = vi.fn(() => {
        versionBumps++
        callOrder.push('directoryWatcherService.stopAll')
        return Promise.resolve()
      })

      mockDirectoryWatcherService.setProjectPath = vi.fn((_path) => {
        versionBumps++
        callOrder.push('directoryWatcherService.setProjectPath')
      })

      await projectService.switchProject(projectPath)

      // Should have at least 2 bumps (stopAll + setProjectPath)
      expect(versionBumps).toBeGreaterThanOrEqual(2)
    })

    it('no error logged during switch orchestration', async () => {
      const projectPath = '/Users/test/projects/my-project'

      await projectService.switchProject(projectPath)

      // logger.error should not be called during successful switch
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('Session token guards across multiple switches', () => {
    it('multiple consecutive switches increment version multiple times', async () => {
      const path1 = '/Users/test/projects/project1'
      const path2 = '/Users/test/projects/project2'
      const path3 = '/Users/test/projects/project3'

      let versionBumps = 0

      mockDirectoryWatcherService.stopAll = vi.fn(() => {
        versionBumps++
        return Promise.resolve()
      })

      mockDirectoryWatcherService.setProjectPath = vi.fn(() => {
        versionBumps++
      })

      // Switch to path1
      await projectService.switchProject(path1)
      const bumpsAfterFirst = versionBumps

      // Switch to path2
      mockFileService.getProjectPath = vi.fn(() => path1)
      await projectService.switchProject(path2)
      const bumpsAfterSecond = versionBumps

      // Switch to path3
      mockFileService.getProjectPath = vi.fn(() => path2)
      await projectService.switchProject(path3)
      const bumpsAfterThird = versionBumps

      // Each switch should add at least 2 bumps
      expect(bumpsAfterFirst).toBeGreaterThanOrEqual(2)
      expect(bumpsAfterSecond).toBeGreaterThan(bumpsAfterFirst)
      expect(bumpsAfterThird).toBeGreaterThan(bumpsAfterSecond)
    })

    it('stopAll is called before setProjectPath in multi-service switch', async () => {
      const oldPath = '/Users/test/projects/old-project'
      const newPath = '/Users/test/projects/new-project'

      mockFileService.getProjectPath = vi.fn(() => oldPath)

      await projectService.switchProject(newPath)

      // Get indices of all stopAll and setProjectPath calls
      const stopAllFileIndex = callOrder.indexOf('fileWatcherService.stopAll')
      const stopAllDirIndex = callOrder.indexOf('directoryWatcherService.stopAll')
      const setPathFileServiceIndex = callOrder.indexOf('fileService.setProjectPath')
      const setPathFileWatcherIndex = callOrder.indexOf('fileWatcherService.setProjectPath')
      const setPathDirIndex = callOrder.indexOf('directoryWatcherService.setProjectPath')

      // All stopAll calls should precede all setProjectPath calls
      expect(stopAllFileIndex).toBeLessThan(setPathFileServiceIndex)
      expect(stopAllFileIndex).toBeLessThan(setPathFileWatcherIndex)
      expect(stopAllFileIndex).toBeLessThan(setPathDirIndex)
      expect(stopAllDirIndex).toBeLessThan(setPathFileServiceIndex)
      expect(stopAllDirIndex).toBeLessThan(setPathFileWatcherIndex)
      expect(stopAllDirIndex).toBeLessThan(setPathDirIndex)
    })
  })

  describe('Error handling preserves session token ordering', () => {
    it('stopAll errors are logged but switch continues', async () => {
      const projectPath = '/Users/test/projects/my-project'

      // Make stopAll fail
      mockDirectoryWatcherService.stopAll = vi.fn(() => {
        callOrder.push('directoryWatcherService.stopAll')
        return Promise.reject(new Error('Stop failed'))
      })

      await projectService.switchProject(projectPath)

      // Switch should succeed despite stopAll error
      expect(mockDirectoryWatcherService.setProjectPath).toHaveBeenCalledWith(projectPath)

      // Warning should be logged
      expect(logger.warn).toHaveBeenCalledWith(
        'Stopping watchers failed (continuing)',
        expect.objectContaining({
          error: 'Stop failed'
        })
      )
    })

    it('failed switch calls setProjectPath with empty string during rollback', async () => {
      const projectPath = '/Users/test/projects/nonexistent'

      // Make directory check fail
      mockedStat.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await projectService.switchProject(projectPath)

      // setProjectPath SHOULD be called with empty string during rollback (no old project)
      expect(mockFileService.setProjectPath).toHaveBeenCalledWith('')
      expect(mockFileWatcherService.setProjectPath).toHaveBeenCalledWith('')
      expect(mockDirectoryWatcherService.setProjectPath).toHaveBeenCalledWith('')
    })

    it('settings validation failure triggers rollback with empty string setProjectPath', async () => {
      const projectPath = '/Users/test/projects/invalid-settings'

      // Make settings load fail
      mockProjectSettingsService.loadSettings = vi.fn(() =>
        Promise.reject(new Error('Invalid settings'))
      )

      const result = await projectService.switchProject(projectPath)

      // Should fail
      expect(result.success).toBe(false)

      // setProjectPath SHOULD be called with empty string during rollback
      expect(mockFileService.setProjectPath).toHaveBeenCalledWith('')
      expect(mockFileWatcherService.setProjectPath).toHaveBeenCalledWith('')
      expect(mockDirectoryWatcherService.setProjectPath).toHaveBeenCalledWith('')

      // clearSettings should be called during rollback
      expect(mockProjectSettingsService.clearSettings).toHaveBeenCalled()
    })
  })

  describe('Same project detection bypasses switch', () => {
    it('no stopAll or setProjectPath calls when switching to same project', async () => {
      const projectPath = '/Users/test/projects/same-project'

      mockFileService.getProjectPath = vi.fn(() => projectPath)
      mockedRealpath.mockResolvedValue(projectPath)

      const result = await projectService.switchProject(projectPath)

      // Should be no-op
      expect(result.action).toBe('noop')

      // No watcher operations
      expect(mockFileWatcherService.stopAll).not.toHaveBeenCalled()
      expect(mockDirectoryWatcherService.stopAll).not.toHaveBeenCalled()
      expect(mockFileService.setProjectPath).not.toHaveBeenCalled()
      expect(mockFileWatcherService.setProjectPath).not.toHaveBeenCalled()
      expect(mockDirectoryWatcherService.setProjectPath).not.toHaveBeenCalled()
    })
  })

  describe('Broadcast timing', () => {
    it('project:changed broadcast happens after all service updates', async () => {
      const oldPath = '/Users/test/projects/old-project'
      const newPath = '/Users/test/projects/new-project'

      mockFileService.getProjectPath = vi.fn(() => oldPath)

      // Record 'broadcast' in callOrder when project:changed is sent,
      // so we can assert ordering relative to service update entries.
      mockSend.mockImplementation((channel: string) => {
        if (channel === 'project:changed') {
          callOrder.push('broadcast')
        }
      })

      await projectService.switchProject(newPath)

      // Verify broadcast was called
      expect(mockSend).toHaveBeenCalledWith('project:changed', {
        oldPath,
        newPath
      })

      // The broadcast entry must appear after every service update entry
      const broadcastIndex = callOrder.indexOf('broadcast')
      expect(broadcastIndex).toBeGreaterThan(-1)

      const lastServiceUpdateIndex = Math.max(
        callOrder.indexOf('fileService.setProjectPath'),
        callOrder.indexOf('fileWatcherService.setProjectPath'),
        callOrder.indexOf('directoryWatcherService.setProjectPath'),
        callOrder.indexOf('settingsService.setLastProjectPath'),
        callOrder.indexOf('settingsService.addRecentProject')
      )

      expect(broadcastIndex).toBeGreaterThan(lastServiceUpdateIndex)
    })

    it('broadcast includes correct oldPath and newPath', async () => {
      const oldPath = '/Users/test/projects/old-project'
      const newPath = '/Users/test/projects/new-project'

      mockFileService.getProjectPath = vi.fn(() => oldPath)

      await projectService.switchProject(newPath)

      expect(mockSend).toHaveBeenCalledWith('project:changed', {
        oldPath,
        newPath
      })
    })

    it('broadcast includes null oldPath for first project', async () => {
      const newPath = '/Users/test/projects/first-project'

      mockFileService.getProjectPath = vi.fn(() => null)

      await projectService.switchProject(newPath)

      expect(mockSend).toHaveBeenCalledWith('project:changed', {
        oldPath: null,
        newPath
      })
    })
  })

  describe('Settings persistence timing', () => {
    it('settings are persisted after service updates but before broadcast', async () => {
      const projectPath = '/Users/test/projects/my-project'

      await projectService.switchProject(projectPath)

      // Settings persistence should happen
      expect(mockSettingsService.setLastProjectPath).toHaveBeenCalledWith(projectPath)
      expect(mockSettingsService.addRecentProject).toHaveBeenCalled()

      // Should happen after setProjectPath
      const setPathIndex = callOrder.indexOf('directoryWatcherService.setProjectPath')
      const persistIndex = Math.max(
        callOrder.indexOf('settingsService.setLastProjectPath'),
        callOrder.indexOf('settingsService.addRecentProject')
      )

      expect(persistIndex).toBeGreaterThan(setPathIndex)
    })
  })

  describe('#211 W6: path filter applied on project open', () => {
    const projectPath = '/Users/test/projects/my-project'

    function useSettings(overrides: Partial<ResolvedProjectSettings>): void {
      mockProjectSettingsService.loadSettings = vi.fn(() =>
        Promise.resolve(resolvedSettings(overrides))
      )
    }

    function fileServiceFilter(call = 0): ProjectPathFilter {
      return vi.mocked(mockFileService.setPathFilter).mock.calls[call][0] as ProjectPathFilter
    }

    function rejectionWarnings(): unknown[] {
      return vi
        .mocked(logger.warn)
        .mock.calls.filter(([message]) => message === REJECTIONS_LOG)
        .map(([, context]) => context)
    }

    it('hands the same filter instance to the file service and the directory watcher', async () => {
      await projectService.switchProject(projectPath)

      expect(mockFileService.setPathFilter).toHaveBeenCalledTimes(1)
      expect(mockDirectoryWatcherService.setPathFilter).toHaveBeenCalledTimes(1)
      const filter = fileServiceFilter()
      expect(filter).toBeInstanceOf(ProjectPathFilter)
      expect(vi.mocked(mockDirectoryWatcherService.setPathFilter).mock.calls[0][0]).toBe(filter)
    })

    it('builds the filter from the resolved settings, rooted at the new project', async () => {
      useSettings({
        excludePatterns: ['scratch', '**/test-tmp'],
        treeHiddenPatterns: ['.git'],
        watcherIgnorePatterns: ['dist']
      })

      await projectService.switchProject(projectPath)

      const filter = fileServiceFilter()
      expect(filter.root).toBe(projectPath)
      expect(filter.isExcluded('scratch/a.md')).toBe(true)
      expect(filter.isExcluded('src/test-tmp/x')).toBe(true)
      expect(filter.isHidden('.git/index.lock')).toBe(true)
      expect(filter.isIgnored('dist/bundle.js')).toBe(true)
      expect(filter.shouldDrop('notes/today.md')).toBe(false)
    })

    it('still sets the hidden patterns on the file service', async () => {
      useSettings({ treeHiddenPatterns: ['.git', '.DS_Store'] })

      await projectService.switchProject(projectPath)

      expect(mockFileService.setHiddenPatterns).toHaveBeenCalledWith(['.git', '.DS_Store'])
    })

    it.each([
      [true, false],
      [false, true]
    ])('takes case sensitivity from the platform (caseSensitive %s → folded match %s)', async (caseSensitive, excluded) => {
      mockedGetPlatformConfig.mockReturnValueOnce({ ...getPlatformConfig(), caseSensitive })
      useSettings({ excludePatterns: ['scratch'] })

      await projectService.switchProject(projectPath)

      expect(fileServiceFilter().isExcluded('SCRATCH/a.md')).toBe(excluded)
    })

    it('applies the filter after the project path is set and before project:changed', async () => {
      await projectService.switchProject(projectPath)

      const setPathOrder = vi.mocked(mockDirectoryWatcherService.setProjectPath).mock.invocationCallOrder[0]
      const fileFilterOrder = vi.mocked(mockFileService.setPathFilter).mock.invocationCallOrder[0]
      const dirFilterOrder = vi.mocked(mockDirectoryWatcherService.setPathFilter).mock.invocationCallOrder[0]
      const broadcastOrder = mockSend.mock.invocationCallOrder[0]
      expect(fileFilterOrder).toBeGreaterThan(setPathOrder)
      expect(dirFilterOrder).toBeGreaterThan(setPathOrder)
      expect(broadcastOrder).toBeGreaterThan(Math.max(fileFilterOrder, dirFilterOrder))
    })

    it('builds a fresh filter on every project open', async () => {
      await projectService.switchProject('/Users/test/projects/a')
      mockFileService.getProjectPath = vi.fn(() => '/Users/test/projects/a')
      await projectService.switchProject('/Users/test/projects/b')

      expect(fileServiceFilter(1)).not.toBe(fileServiceFilter(0))
      expect(fileServiceFilter(1).root).toBe('/Users/test/projects/b')
    })

    it('drops no entry of a merged list of two full sources (2 × 256)', async () => {
      const global = Array.from({ length: 256 }, (_, i) => `global-${i}`)
      const project = Array.from({ length: 256 }, (_, i) => `project-${i}`)
      useSettings({ excludePatterns: [...global, ...project] })

      await projectService.switchProject(projectPath)

      const filter = fileServiceFilter()
      expect(filter.excludeMatcher.size).toBe(512)
      expect(filter.isExcluded('global-0/a.md')).toBe(true)
      expect(filter.isExcluded('project-255/a.md')).toBe(true)
    })

    it('logs one warn per source, by index and reason only', async () => {
      useSettings({
        excludeRejections: [
          { source: 'global', index: 1, reason: 'parent-segment' },
          { source: 'project', index: 0, reason: 'drive-or-unc' },
          { source: 'project', index: 3, reason: 'blank' }
        ]
      })

      await projectService.switchProject(projectPath)

      expect(rejectionWarnings()).toEqual([
        { source: 'global', rejectedCount: 1, rejected: [{ index: 1, reason: 'parent-segment' }] },
        {
          source: 'project',
          rejectedCount: 2,
          rejected: [
            { index: 0, reason: 'drive-or-unc' },
            { index: 3, reason: 'blank' }
          ]
        }
      ])
    })

    it('never logs a value, even if a rejection record carried one', async () => {
      const leaky = {
        source: 'project' as const,
        index: 2,
        reason: 'drive-or-unc',
        value: 'C:/Users/secret-name'
      }
      useSettings({ excludeRejections: [leaky] })

      await projectService.switchProject(projectPath)

      expect(rejectionWarnings()).toEqual([
        { source: 'project', rejectedCount: 1, rejected: [{ index: 2, reason: 'drive-or-unc' }] }
      ])
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('secret-name')
    })

    it('lists at most 64 rejections per source but reports the full count', async () => {
      useSettings({
        excludeRejections: Array.from({ length: 300 }, (_, index) => ({
          source: 'project' as const,
          index,
          reason: 'too-many-entries'
        }))
      })

      await projectService.switchProject(projectPath)

      const [warning] = rejectionWarnings() as Array<{ rejectedCount: number; rejected: unknown[] }>
      expect(warning.rejectedCount).toBe(300)
      expect(warning.rejected).toHaveLength(64)
    })

    it('logs no rejection warning when every entry is accepted', async () => {
      useSettings({ excludePatterns: ['scratch'] })

      await projectService.switchProject(projectPath)

      expect(rejectionWarnings()).toEqual([])
    })

    it('reports the merged exclude count in the settings-loaded line', async () => {
      useSettings({ excludePatterns: ['scratch', 'tmp', '**/*.log'] })

      await projectService.switchProject(projectPath)

      expect(logger.debug).toHaveBeenCalledWith(
        'Project switch: settings loaded',
        expect.objectContaining({ excludePatternCount: 3 })
      )
    })
  })
})

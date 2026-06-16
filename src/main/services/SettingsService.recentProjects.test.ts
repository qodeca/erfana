// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * SettingsService.recentProjects.test.ts
 *
 * todo002: Comprehensive test coverage for recent projects functionality
 *
 * Test groups:
 * - getRecentProjects (5+ tests)
 * - addRecentProject (15+ tests)
 * - removeRecentProject (10+ tests)
 * - clearRecentProjects (5+ tests)
 * - Concurrency/race conditions (5+ tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MAX_RECENT_PROJECTS } from '../../shared/constants'

// Use vi.hoisted to create mocks that are available during vi.mock hoisting
const { mockStore, mockRemoveDuplicates, mockGenerate, mockRepoGetAll, mockRepoSave, mockRepoClear } = vi.hoisted(() => ({
  mockStore: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn()
  },
  mockRemoveDuplicates: vi.fn(),
  mockGenerate: vi.fn(),
  mockRepoGetAll: vi.fn(),
  mockRepoSave: vi.fn(),
  mockRepoClear: vi.fn()
}))

// Mock electron-store
vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    get = mockStore.get
    set = mockStore.set
    delete = mockStore.delete
  }
}))

// Mock fs/promises
vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  constants: { R_OK: 4 }
}))

// Mock deduplicator
vi.mock('./RecentProjectsDeduplicator', () => ({
  RecentProjectsDeduplicator: class MockDeduplicator {
    removeDuplicates = mockRemoveDuplicates
  }
}))

// Mock timestamp generator
vi.mock('./MonotonicTimestampGenerator', () => ({
  MonotonicTimestampGenerator: class MockTimestampGenerator {
    generate = mockGenerate
    restore = vi.fn()
  }
}))

// Mock repository
vi.mock('./RecentProjectsRepository', () => ({
  RecentProjectsRepository: class MockRepository {
    getAll = mockRepoGetAll
    save = mockRepoSave
    clear = mockRepoClear
    getLastTimestamp = vi.fn().mockReturnValue(Date.now())
    saveLastTimestamp = vi.fn()
  }
}))

// Import after mocking
import { SettingsService, SettingsServiceError } from './SettingsService'
import type { RecentProject } from './SettingsService'

describe('SettingsService - Recent Projects', () => {
  let service: SettingsService
  let storedProjects: RecentProject[]

  beforeEach(async () => {
    vi.clearAllMocks()

    // Initialize stored projects
    storedProjects = []

    // Setup mock repository
    mockRepoGetAll.mockImplementation(() => storedProjects)
    mockRepoSave.mockImplementation((projects: RecentProject[]) => {
      storedProjects = projects
    })
    mockRepoClear.mockImplementation(() => {
      storedProjects = []
    })

    // Setup deduplicator to filter by path
    mockRemoveDuplicates.mockImplementation(async (projects: RecentProject[], pathToRemove: string) => {
      return projects.filter(p => p.path !== pathToRemove)
    })

    // Setup timestamp generator
    mockGenerate.mockReturnValue(Date.now())

    // Create service and wait for initialization
    service = new SettingsService()
    await new Promise(resolve => setTimeout(resolve, 10)) // Allow store init
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getRecentProjects', () => {
    it('should return empty array initially', async () => {
      storedProjects = []
      const result = await service.getRecentProjects()
      expect(result).toEqual([])
    })

    it('should return stored projects', async () => {
      const projects: RecentProject[] = [
        { path: '/path/a', name: 'a', lastOpened: 1000 },
        { path: '/path/b', name: 'b', lastOpened: 2000 }
      ]
      storedProjects = projects

      const result = await service.getRecentProjects()
      expect(result).toEqual(projects)
    })

    it('should return projects in stored order', async () => {
      const projects: RecentProject[] = [
        { path: '/path/newest', name: 'newest', lastOpened: 3000 },
        { path: '/path/middle', name: 'middle', lastOpened: 2000 },
        { path: '/path/oldest', name: 'oldest', lastOpened: 1000 }
      ]
      storedProjects = projects

      const result = await service.getRecentProjects()
      expect(result[0].path).toBe('/path/newest')
      expect(result[2].path).toBe('/path/oldest')
    })

    it('should throw SettingsServiceError on store failure', async () => {
      mockRepoGetAll.mockImplementation(() => {
        throw new Error('Store read error')
      })

      await expect(service.getRecentProjects()).rejects.toBeInstanceOf(SettingsServiceError)
    })

    it('should include operation name in error', async () => {
      mockRepoGetAll.mockImplementation(() => {
        throw new Error('Store error')
      })

      await expect(service.getRecentProjects()).rejects.toMatchObject({
        operation: 'getRecentProjects'
      })
    })
  })

  describe('addRecentProject', () => {
    it('should add a new project', async () => {
      storedProjects = []
      mockGenerate.mockReturnValue(1000)

      await service.addRecentProject('/path/new', 'new')

      expect(storedProjects).toHaveLength(1)
      expect(storedProjects[0]).toMatchObject({
        path: '/path/new',
        name: 'new',
        lastOpened: 1000
      })
    })

    it('should add project at the beginning (most recent first)', async () => {
      storedProjects = [{ path: '/path/old', name: 'old', lastOpened: 500 }]
      mockGenerate.mockReturnValue(1000)

      await service.addRecentProject('/path/new', 'new')

      expect(storedProjects[0].path).toBe('/path/new')
      expect(storedProjects[1].path).toBe('/path/old')
    })

    it('should limit to MAX_RECENT_PROJECTS', async () => {
      // Start with MAX projects
      storedProjects = Array.from({ length: MAX_RECENT_PROJECTS }, (_, i) => ({
        path: `/path/project${i}`,
        name: `project${i}`,
        lastOpened: i * 100
      }))
      mockGenerate.mockReturnValue(10000)

      await service.addRecentProject('/path/new', 'new')

      expect(storedProjects).toHaveLength(MAX_RECENT_PROJECTS)
      expect(storedProjects[0].path).toBe('/path/new')
    })

    it('should remove duplicate path before adding', async () => {
      storedProjects = [
        { path: '/path/a', name: 'a', lastOpened: 1000 },
        { path: '/path/b', name: 'b', lastOpened: 2000 }
      ]
      mockGenerate.mockReturnValue(3000)

      // Re-add existing project
      await service.addRecentProject('/path/a', 'a-updated')

      // Deduplicator should have been called with projects array and path
      expect(mockRemoveDuplicates).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: '/path/a' }),
          expect.objectContaining({ path: '/path/b' })
        ]),
        '/path/a'
      )
    })

    it('should update timestamp when re-adding existing project', async () => {
      const oldTimestamp = 1000
      storedProjects = [{ path: '/path/a', name: 'a', lastOpened: oldTimestamp }]
      const newTimestamp = 5000
      mockGenerate.mockReturnValue(newTimestamp)

      await service.addRecentProject('/path/a', 'a')

      expect(storedProjects[0].lastOpened).toBe(newTimestamp)
    })

    it('should use monotonic timestamp generator', async () => {
      await service.addRecentProject('/path/test', 'test')
      expect(mockGenerate).toHaveBeenCalled()
    })

    it('should use generated timestamp', async () => {
      const timestamp = 12345
      mockGenerate.mockReturnValue(timestamp)

      await service.addRecentProject('/path/test', 'test')

      expect(storedProjects[0].lastOpened).toBe(timestamp)
    })

    it('should throw SettingsServiceError on store failure', async () => {
      mockRepoSave.mockImplementation(() => {
        throw new Error('Store write error')
      })

      await expect(service.addRecentProject('/path/test', 'test'))
        .rejects.toBeInstanceOf(SettingsServiceError)
    })

    it('should include operation name in error', async () => {
      mockRepoSave.mockImplementation(() => {
        throw new Error('Store error')
      })

      await expect(service.addRecentProject('/path/test', 'test'))
        .rejects.toMatchObject({ operation: 'addRecentProject' })
    })

    it('should handle empty name', async () => {
      await service.addRecentProject('/path/test', '')
      expect(storedProjects[0].name).toBe('')
    })

    it('should handle special characters in path', async () => {
      const specialPath = '/path/with spaces/and-dashes_underscores'
      await service.addRecentProject(specialPath, 'special')
      expect(storedProjects[0].path).toBe(specialPath)
    })

    it('should handle unicode in name', async () => {
      const unicodeName = '项目名称 🚀'
      await service.addRecentProject('/path/test', unicodeName)
      expect(storedProjects[0].name).toBe(unicodeName)
    })
  })

  describe('removeRecentProject', () => {
    it('should remove existing project', async () => {
      storedProjects = [
        { path: '/path/a', name: 'a', lastOpened: 1000 },
        { path: '/path/b', name: 'b', lastOpened: 2000 }
      ]

      await service.removeRecentProject('/path/a')

      expect(storedProjects).toHaveLength(1)
      expect(storedProjects[0].path).toBe('/path/b')
    })

    it('should handle removing non-existent project gracefully', async () => {
      storedProjects = [{ path: '/path/a', name: 'a', lastOpened: 1000 }]

      // Should not throw
      await expect(service.removeRecentProject('/path/nonexistent')).resolves.toBeUndefined()
    })

    it('should use deduplicator for canonical comparison', async () => {
      storedProjects = [{ path: '/path/a', name: 'a', lastOpened: 1000 }]

      await service.removeRecentProject('/path/a')

      expect(mockRemoveDuplicates).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ path: '/path/a' })]),
        '/path/a'
      )
    })

    it('should remove from empty list without error', async () => {
      storedProjects = []

      await expect(service.removeRecentProject('/path/test')).resolves.toBeUndefined()
    })

    it('should throw SettingsServiceError on store failure', async () => {
      mockRepoSave.mockImplementation(() => {
        throw new Error('Store write error')
      })

      await expect(service.removeRecentProject('/path/test'))
        .rejects.toBeInstanceOf(SettingsServiceError)
    })

    it('should include operation name in error', async () => {
      mockRepoSave.mockImplementation(() => {
        throw new Error('Store error')
      })

      await expect(service.removeRecentProject('/path/test'))
        .rejects.toMatchObject({ operation: 'removeRecentProject' })
    })

    it('should preserve other projects when removing one', async () => {
      storedProjects = [
        { path: '/path/a', name: 'a', lastOpened: 1000 },
        { path: '/path/b', name: 'b', lastOpened: 2000 },
        { path: '/path/c', name: 'c', lastOpened: 3000 }
      ]

      await service.removeRecentProject('/path/b')

      expect(storedProjects).toHaveLength(2)
      expect(storedProjects.find(p => p.path === '/path/a')).toBeDefined()
      expect(storedProjects.find(p => p.path === '/path/c')).toBeDefined()
    })
  })

  describe('clearRecentProjects', () => {
    it('should clear all projects', async () => {
      storedProjects = [
        { path: '/path/a', name: 'a', lastOpened: 1000 },
        { path: '/path/b', name: 'b', lastOpened: 2000 }
      ]

      await service.clearRecentProjects()

      expect(storedProjects).toHaveLength(0)
    })

    it('should handle clearing empty list', async () => {
      storedProjects = []

      await expect(service.clearRecentProjects()).resolves.toBeUndefined()
    })

    it('should throw SettingsServiceError on store failure', async () => {
      mockRepoClear.mockImplementation(() => {
        throw new Error('Store clear error')
      })

      await expect(service.clearRecentProjects())
        .rejects.toBeInstanceOf(SettingsServiceError)
    })

    it('should include operation name in error', async () => {
      mockRepoClear.mockImplementation(() => {
        throw new Error('Store error')
      })

      await expect(service.clearRecentProjects())
        .rejects.toMatchObject({ operation: 'clearRecentProjects' })
    })

    it('should return empty array after clear', async () => {
      storedProjects = [{ path: '/path/a', name: 'a', lastOpened: 1000 }]

      await service.clearRecentProjects()
      const result = await service.getRecentProjects()

      expect(result).toEqual([])
    })
  })

  describe('Concurrency and race conditions', () => {
    it('should use mutex for addRecentProject', async () => {
      // Start multiple add operations concurrently
      const promises = [
        service.addRecentProject('/path/1', '1'),
        service.addRecentProject('/path/2', '2'),
        service.addRecentProject('/path/3', '3')
      ]

      await Promise.all(promises)

      // All should succeed without corruption
      expect(storedProjects).toHaveLength(3)
    })

    it('should use mutex for removeRecentProject', async () => {
      storedProjects = [
        { path: '/path/1', name: '1', lastOpened: 1000 },
        { path: '/path/2', name: '2', lastOpened: 2000 },
        { path: '/path/3', name: '3', lastOpened: 3000 }
      ]

      // Start multiple remove operations concurrently
      const promises = [
        service.removeRecentProject('/path/1'),
        service.removeRecentProject('/path/2')
      ]

      await Promise.all(promises)

      // Only one should remain
      expect(storedProjects).toHaveLength(1)
    })

    it('should handle concurrent add and remove', async () => {
      storedProjects = [{ path: '/path/existing', name: 'existing', lastOpened: 1000 }]

      const promises = [
        service.addRecentProject('/path/new', 'new'),
        service.removeRecentProject('/path/existing')
      ]

      await Promise.all(promises)

      // Should not throw, and operations should complete
      // Exact state depends on mutex ordering
    })

    it('should maintain MAX_RECENT_PROJECTS under concurrent adds', async () => {
      // Add many projects concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        service.addRecentProject(`/path/${i}`, `project${i}`)
      )

      await Promise.all(promises)

      expect(storedProjects.length).toBeLessThanOrEqual(MAX_RECENT_PROJECTS)
    })

    it('should release mutex on error', async () => {
      // Make first add fail
      mockRepoSave.mockImplementationOnce(() => {
        throw new Error('First add fails')
      })

      await expect(service.addRecentProject('/path/fail', 'fail')).rejects.toThrow()

      // Reset mock
      mockRepoSave.mockImplementation((projects: RecentProject[]) => {
        storedProjects = projects
      })

      // Second add should work (mutex released)
      await expect(service.addRecentProject('/path/success', 'success')).resolves.toBeUndefined()
    })
  })

  describe('Edge cases', () => {
    it('should handle very long paths', async () => {
      const longPath = '/path/' + 'a'.repeat(1000)
      await service.addRecentProject(longPath, 'long')
      expect(storedProjects[0].path).toBe(longPath)
    })

    it('should handle paths with unicode characters', async () => {
      const unicodePath = '/path/日本語/项目'
      await service.addRecentProject(unicodePath, 'unicode')
      expect(storedProjects[0].path).toBe(unicodePath)
    })

    it('should handle paths with backslashes (Windows)', async () => {
      const windowsPath = 'C:\\Users\\john\\project'
      await service.addRecentProject(windowsPath, 'windows')
      expect(storedProjects[0].path).toBe(windowsPath)
    })

    it('should handle timestamp of 0', async () => {
      mockGenerate.mockReturnValue(0)
      await service.addRecentProject('/path/test', 'test')
      expect(storedProjects[0].lastOpened).toBe(0)
    })

    it('should handle very large timestamps', async () => {
      const largeTimestamp = Number.MAX_SAFE_INTEGER
      mockGenerate.mockReturnValue(largeTimestamp)
      await service.addRecentProject('/path/test', 'test')
      expect(storedProjects[0].lastOpened).toBe(largeTimestamp)
    })
  })
})

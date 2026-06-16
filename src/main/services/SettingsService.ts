// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * SettingsService - Persistent storage for application settings
 *
 * Uses electron-store for persistent key-value storage.
 * Note: electron-store is ES Module, so we use dynamic import()
 */

import { Mutex } from 'async-mutex'
import { access, constants } from 'fs/promises'
import { MonotonicTimestampGenerator } from './MonotonicTimestampGenerator'
import { RecentProjectsDeduplicator } from './RecentProjectsDeduplicator'
import { RecentProjectsRepository } from './RecentProjectsRepository'
import { MAX_RECENT_PROJECTS } from '../../shared/constants'
import { logger } from './LoggingService'

export interface RecentProject {
  path: string
  name: string
  lastOpened: number // timestamp
}

interface Settings {
  lastProjectPath?: string
  projectFilterMode?: string
  directoryWatchDepth?: number | null
  recentProjects?: RecentProject[]
  lastTimestamp?: number // RELIABILITY FIX (todo013): Persist for monotonic timestamps across restarts
}

// Copilot removed: no approved tools management

type StoreLike<T> = {
  get: <K extends keyof T>(key: K) => T[K] | undefined
  set: <K extends keyof T>(key: K, value: T[K]) => void
  delete: (key: keyof T) => void
}

/**
 * Creates a typed electron-store instance
 *
 * Note: electron-store is an ES Module with complex internal types that don't
 * export a compatible constructor signature. This factory encapsulates the
 * necessary type assertion in one place.
 *
 * The `projectName` option is required by the underlying `conf` package when
 * `cwd` isn't available (e.g., before app.whenReady()).
 */
async function createElectronStore<T>(name: string): Promise<StoreLike<T>> {
  const module = await import('electron-store')
  const ElectronStore = module.default as unknown as new (opts: {
    name: string
    projectName?: string
  }) => StoreLike<T>
  return new ElectronStore({ name, projectName: 'erfana' })
}

export class SettingsServiceError extends Error {
  constructor(
    message: string,
    public operation: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'SettingsServiceError'
  }
}

export class SettingsService {
  /**
   * FIXED (Issue #4): Changed from `any` to conceptually `Store<Settings>`
   * Note: Using `any` due to TypeScript limitations with dynamic ES Module imports.
   * The actual runtime type is ElectronStore<Settings> with methods: get, set, delete
   */
  private store: StoreLike<Settings> | null
  private storePromise: Promise<StoreLike<Settings>>

  // Mutex for preventing race conditions in recent projects operations
  private recentProjectsMutex = new Mutex()

  // REFACTORING (todo014-016): Extract responsibilities to dedicated classes
  private timestampGenerator = new MonotonicTimestampGenerator()
  private deduplicator = new RecentProjectsDeduplicator()
  private repository: RecentProjectsRepository | null = null

  constructor() {
    this.store = null
    this.storePromise = createElectronStore<Settings>('erfana-settings').then((instance) => {
      this.store = instance

      // Initialize repository with store
      this.repository = new RecentProjectsRepository(instance)

      // Restore persisted timestamp
      const persistedTimestamp = this.repository.getLastTimestamp()
      if (persistedTimestamp && typeof persistedTimestamp === 'number') {
        this.timestampGenerator.restore(persistedTimestamp)
      }

      return instance
    })
  }

  private async ensureStore(): Promise<StoreLike<Settings>> {
    if (!this.store) {
      await this.storePromise
    }
    // non-null after awaiting promise
    return this.store as StoreLike<Settings>
  }

  private async ensureRepository(): Promise<RecentProjectsRepository> {
    await this.ensureStore()
    if (!this.repository) {
      throw new Error('Repository not initialized')
    }
    return this.repository
  }

  async getLastProjectPath(): Promise<string | null> {
    try {
      const store = await this.ensureStore()
      return store.get('lastProjectPath') || null
    } catch (error) {
      logger.error('Failed to get last project path', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to retrieve last project path from settings',
        'getLastProjectPath',
        error instanceof Error ? error : undefined
      )
    }
  }

  async setLastProjectPath(path: string): Promise<void> {
    try {
      const store = await this.ensureStore()
      store.set('lastProjectPath', path)
    } catch (error) {
      logger.error('Failed to set last project path', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to save last project path to settings',
        'setLastProjectPath',
        error instanceof Error ? error : undefined
      )
    }
  }

  async clearLastProjectPath(): Promise<void> {
    try {
      const store = await this.ensureStore()
      store.delete('lastProjectPath')
    } catch (error) {
      logger.error('Failed to clear last project path', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to clear last project path from settings',
        'clearLastProjectPath',
        error instanceof Error ? error : undefined
      )
    }
  }

  // Approved Tools Management removed

  // Project Filter Mode Management

  async getProjectFilterMode(): Promise<string> {
    try {
      const store = await this.ensureStore()
      // Default to 'all' mode
      return store.get('projectFilterMode') || 'all'
    } catch (error) {
      logger.error('Failed to get project filter mode', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to retrieve project filter mode from settings',
        'getProjectFilterMode',
        error instanceof Error ? error : undefined
      )
    }
  }

  async setProjectFilterMode(mode: string): Promise<void> {
    try {
      const store = await this.ensureStore()
      store.set('projectFilterMode', mode)
    } catch (error) {
      logger.error('Failed to set project filter mode', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to save project filter mode to settings',
        'setProjectFilterMode',
        error instanceof Error ? error : undefined
      )
    }
  }

  // Directory watcher depth (performance tuning)
  async getDirectoryWatchDepth(): Promise<number | undefined> {
    try {
      const store = await this.ensureStore()
      const v = store.get('directoryWatchDepth')
      if (v === null || v === undefined) return undefined
      if (typeof v === 'number' && v >= 0) return v
      return undefined
    } catch (error) {
      logger.error('Failed to get directory watch depth', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to retrieve directory watch depth from settings',
        'getDirectoryWatchDepth',
        error instanceof Error ? error : undefined
      )
    }
  }

  async setDirectoryWatchDepth(depth: number | null): Promise<void> {
    try {
      const store = await this.ensureStore()
      // null clears to undefined behavior (chokidar unlimited)
      store.set('directoryWatchDepth', depth === null ? null : Math.max(0, Math.floor(depth)))
    } catch (error) {
      logger.error('Failed to set directory watch depth', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to save directory watch depth to settings',
        'setDirectoryWatchDepth',
        error instanceof Error ? error : undefined
      )
    }
  }

  // Recent Projects Management (max 5)

  async getRecentProjects(): Promise<RecentProject[]> {
    try {
      const repository = await this.ensureRepository()
      return repository.getAll()
    } catch (error) {
      logger.error('Failed to get recent projects', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to retrieve recent projects from settings',
        'getRecentProjects',
        error instanceof Error ? error : undefined
      )
    }
  }

  async addRecentProject(path: string, name: string): Promise<void> {
    // Use mutex to prevent race conditions from parallel project opens
    const release = await this.recentProjectsMutex.acquire()
    try {
      const repository = await this.ensureRepository()
      const projects = repository.getAll()

      // REFACTORING (todo014): Use deduplicator for canonical path comparison
      const filteredProjects = await this.deduplicator.removeDuplicates(projects, path)

      // REFACTORING (todo015): Use timestamp generator for monotonic timestamps
      const timestamp = this.timestampGenerator.generate()

      // REFACTORING (todo016): Use repository for persistence
      repository.saveLastTimestamp(timestamp)

      // Add new entry at the front
      const newProject: RecentProject = {
        path, // Store original path (not canonical) for display
        name,
        lastOpened: timestamp
      }

      // Keep only the most recent projects
      const updatedProjects = [newProject, ...filteredProjects].slice(0, MAX_RECENT_PROJECTS)

      repository.save(updatedProjects)
    } catch (error) {
      logger.error('Failed to add recent project', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to save recent project to settings',
        'addRecentProject',
        error instanceof Error ? error : undefined
      )
    } finally {
      release()
    }
  }

  async removeRecentProject(path: string): Promise<void> {
    // Use mutex to prevent race conditions
    const release = await this.recentProjectsMutex.acquire()
    try {
      const repository = await this.ensureRepository()
      const projects = repository.getAll()

      // REFACTORING (todo014): Use deduplicator for canonical path comparison
      const filteredProjects = await this.deduplicator.removeDuplicates(projects, path)

      // REFACTORING (todo016): Use repository for persistence
      repository.save(filteredProjects)
    } catch (error) {
      logger.error('Failed to remove recent project', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to remove recent project from settings',
        'removeRecentProject',
        error instanceof Error ? error : undefined
      )
    } finally {
      release()
    }
  }

  /**
   * Remove stale projects from recent list (projects that no longer exist)
   *
   * RELIABILITY FIX (todo012): Clean up deleted projects on app startup
   * to free up slots for valid projects
   */
  async cleanupStaleProjects(): Promise<void> {
    const release = await this.recentProjectsMutex.acquire()
    try {
      const repository = await this.ensureRepository()
      const projects = repository.getAll()

      // Check each project's accessibility in parallel
      const accessibilityChecks = await Promise.allSettled(
        projects.map((project) => access(project.path, constants.R_OK | constants.X_OK))
      )

      // Keep only projects that are still accessible
      const validProjects = projects.filter((_, i) => accessibilityChecks[i].status === 'fulfilled')

      // Only write if something changed
      if (validProjects.length !== projects.length) {
        repository.save(validProjects)
        const removedCount = projects.length - validProjects.length
        logger.info('Cleaned up stale projects from recent list', { removedCount })
      }
    } catch (error) {
      logger.error('Failed to cleanup stale projects', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to cleanup stale projects from settings',
        'cleanupStaleProjects',
        error instanceof Error ? error : undefined
      )
    } finally {
      release()
    }
  }

  async clearRecentProjects(): Promise<void> {
    // Use mutex to prevent race conditions
    const release = await this.recentProjectsMutex.acquire()
    try {
      const repository = await this.ensureRepository()
      repository.clear()
    } catch (error) {
      logger.error('Failed to clear recent projects', error instanceof Error ? error : undefined)
      throw new SettingsServiceError(
        'Failed to clear recent projects from settings',
        'clearRecentProjects',
        error instanceof Error ? error : undefined
      )
    } finally {
      release()
    }
  }
}

// Singleton instance
export const settingsService = new SettingsService()

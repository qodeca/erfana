/**
 * SettingsService - Persistent storage for application settings
 *
 * Uses electron-store for persistent key-value storage.
 * Note: electron-store is ES Module, so we use dynamic import()
 */

import { Mutex } from 'async-mutex'
import { realpath, access, constants } from 'fs/promises'

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

  // Track last timestamp to ensure monotonicity (prevent clock skew issues)
  private lastTimestamp = 0

  constructor() {
    // electron-store is an ES Module, so we need to import it dynamically
    this.store = null
    this.storePromise = import('electron-store').then((module) => {
      const ElectronStore = module.default as unknown as new <S>(
        options?: unknown
      ) => StoreLike<S>
      const instance = new ElectronStore<Settings>({ name: 'erfana-settings' })
      this.store = instance

      // RELIABILITY FIX (todo013): Load persisted timestamp on startup
      const persistedTimestamp = instance.get('lastTimestamp')
      if (persistedTimestamp && typeof persistedTimestamp === 'number') {
        this.lastTimestamp = persistedTimestamp
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

  /**
   * Get canonical path for comparison (resolves case and symlinks)
   * Returns original path if resolution fails (e.g., path doesn't exist)
   *
   * PERFORMANCE FIX (todo007): Changed from synchronous to async to prevent blocking main process
   */
  private async getCanonicalPathAsync(path: string): Promise<string> {
    try {
      return await realpath(path)
    } catch {
      // Path doesn't exist or not accessible, return as-is
      return path
    }
  }

  async getLastProjectPath(): Promise<string | null> {
    try {
      const store = await this.ensureStore()
      return store.get('lastProjectPath') || null
    } catch (error) {
      console.error('Failed to get last project path:', error)
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
      console.error('Failed to set last project path:', error)
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
      console.error('Failed to clear last project path:', error)
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
      console.error('Failed to get project filter mode:', error)
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
      console.error('Failed to set project filter mode:', error)
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
      console.error('Failed to get directory watch depth:', error)
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
      console.error('Failed to set directory watch depth:', error)
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
      const store = await this.ensureStore()
      const projects = store.get('recentProjects') || []
      return projects
    } catch (error) {
      console.error('Failed to get recent projects:', error)
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
      const store = await this.ensureStore()
      const projects = store.get('recentProjects') || []

      // PERFORMANCE FIX (todo008): Parallelize canonical path resolution
      // Instead of N sequential filesystem calls inside filter, resolve all paths in parallel
      const canonicalPath = await this.getCanonicalPathAsync(path)
      const canonicalPaths = await Promise.all(
        projects.map((p) => this.getCanonicalPathAsync(p.path))
      )

      // Remove existing entry using canonical comparison
      // This prevents duplicates on case-insensitive filesystems (macOS)
      const filteredProjects = projects.filter((_p, i) => canonicalPaths[i] !== canonicalPath)

      // Ensure timestamp is always increasing (handle clock skew from NTP, DST, manual adjustments)
      const currentTime = Date.now()
      const timestamp = Math.max(currentTime, this.lastTimestamp + 1)
      this.lastTimestamp = timestamp

      // RELIABILITY FIX (todo013): Persist timestamp to maintain monotonicity across restarts
      store.set('lastTimestamp', timestamp)

      // Add new entry at the front
      const newProject: RecentProject = {
        path, // Store original path (not canonical) for display
        name,
        lastOpened: timestamp
      }

      // Keep only the 5 most recent
      const updatedProjects = [newProject, ...filteredProjects].slice(0, 5)

      store.set('recentProjects', updatedProjects)
    } catch (error) {
      console.error('Failed to add recent project:', error)
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
      const store = await this.ensureStore()
      const projects = store.get('recentProjects') || []

      // PERFORMANCE FIX (todo008): Parallelize canonical path resolution
      const canonicalPath = await this.getCanonicalPathAsync(path)
      const canonicalPaths = await Promise.all(
        projects.map((p) => this.getCanonicalPathAsync(p.path))
      )

      // Remove using canonical comparison
      const filteredProjects = projects.filter((_p, i) => canonicalPaths[i] !== canonicalPath)

      store.set('recentProjects', filteredProjects)
    } catch (error) {
      console.error('Failed to remove recent project:', error)
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
      const store = await this.ensureStore()
      const projects = store.get('recentProjects') || []

      // Check each project's accessibility in parallel
      const accessibilityChecks = await Promise.allSettled(
        projects.map((project) => access(project.path, constants.R_OK | constants.X_OK))
      )

      // Keep only projects that are still accessible
      const validProjects = projects.filter((_, i) => accessibilityChecks[i].status === 'fulfilled')

      // Only write if something changed
      if (validProjects.length !== projects.length) {
        store.set('recentProjects', validProjects)
        const removedCount = projects.length - validProjects.length
        console.log(`Cleaned up ${removedCount} stale project(s) from recent list`)
      }
    } catch (error) {
      console.error('Failed to cleanup stale projects:', error)
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
      const store = await this.ensureStore()
      store.delete('recentProjects')
    } catch (error) {
      console.error('Failed to clear recent projects:', error)
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

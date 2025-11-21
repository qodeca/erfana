/**
 * SettingsService - Persistent storage for application settings
 *
 * Uses electron-store for persistent key-value storage.
 * Note: electron-store is ES Module, so we use dynamic import()
 */

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
}

// Copilot removed: no approved tools management

type StoreLike<T> = {
  get: <K extends keyof T>(key: K) => T[K] | undefined
  set: <K extends keyof T>(key: K, value: T[K]) => void
  delete: (key: keyof T) => void
}

export class SettingsService {
  /**
   * FIXED (Issue #4): Changed from `any` to conceptually `Store<Settings>`
   * Note: Using `any` due to TypeScript limitations with dynamic ES Module imports.
   * The actual runtime type is ElectronStore<Settings> with methods: get, set, delete
   */
  private store: StoreLike<Settings> | null
  private storePromise: Promise<StoreLike<Settings>>

  constructor() {
    // electron-store is an ES Module, so we need to import it dynamically
    this.store = null
    this.storePromise = import('electron-store').then((module) => {
      const ElectronStore = module.default as unknown as new <S>(
        options?: unknown
      ) => StoreLike<S>
      const instance = new ElectronStore<Settings>({ name: 'erfana-settings' })
      this.store = instance
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

  async getLastProjectPath(): Promise<string | null> {
    const store = await this.ensureStore()
    return store.get('lastProjectPath') || null
  }

  async setLastProjectPath(path: string): Promise<void> {
    const store = await this.ensureStore()
    store.set('lastProjectPath', path)
  }

  async clearLastProjectPath(): Promise<void> {
    const store = await this.ensureStore()
    store.delete('lastProjectPath')
  }

  // Approved Tools Management removed

  // Project Filter Mode Management

  async getProjectFilterMode(): Promise<string> {
    const store = await this.ensureStore()
    // Default to 'all' mode
    return store.get('projectFilterMode') || 'all'
  }

  async setProjectFilterMode(mode: string): Promise<void> {
    const store = await this.ensureStore()
    store.set('projectFilterMode', mode)
  }

  // Directory watcher depth (performance tuning)
  async getDirectoryWatchDepth(): Promise<number | undefined> {
    const store = await this.ensureStore()
    const v = store.get('directoryWatchDepth')
    if (v === null || v === undefined) return undefined
    if (typeof v === 'number' && v >= 0) return v
    return undefined
  }

  async setDirectoryWatchDepth(depth: number | null): Promise<void> {
    const store = await this.ensureStore()
    // null clears to undefined behavior (chokidar unlimited)
    store.set('directoryWatchDepth', depth === null ? null : Math.max(0, Math.floor(depth)))
  }

  // Recent Projects Management (max 5)

  async getRecentProjects(): Promise<RecentProject[]> {
    const store = await this.ensureStore()
    const projects = store.get('recentProjects') || []
    return projects
  }

  async addRecentProject(path: string, name: string): Promise<void> {
    const store = await this.ensureStore()
    const projects = store.get('recentProjects') || []

    // Remove existing entry for this path (if any)
    const filteredProjects = projects.filter((p) => p.path !== path)

    // Add new entry at the front
    const newProject: RecentProject = {
      path,
      name,
      lastOpened: Date.now()
    }

    // Keep only the 5 most recent
    const updatedProjects = [newProject, ...filteredProjects].slice(0, 5)

    store.set('recentProjects', updatedProjects)
  }

  async removeRecentProject(path: string): Promise<void> {
    const store = await this.ensureStore()
    const projects = store.get('recentProjects') || []
    const filteredProjects = projects.filter((p) => p.path !== path)
    store.set('recentProjects', filteredProjects)
  }

  async clearRecentProjects(): Promise<void> {
    const store = await this.ensureStore()
    store.delete('recentProjects')
  }
}

// Singleton instance
export const settingsService = new SettingsService()

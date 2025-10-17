/**
 * SettingsService - Persistent storage for application settings
 *
 * Uses electron-store for persistent key-value storage.
 * Note: electron-store is ES Module, so we use dynamic import()
 */

interface Settings {
  lastProjectPath?: string
  projectFilterMode?: string
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
}

// Singleton instance
export const settingsService = new SettingsService()

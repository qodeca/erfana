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

export class SettingsService {
  /**
   * FIXED (Issue #4): Changed from `any` to conceptually `Store<Settings>`
   * Note: Using `any` due to TypeScript limitations with dynamic ES Module imports.
   * The actual runtime type is ElectronStore<Settings> with methods: get, set, delete
   */
  private store: any
  private storePromise: Promise<any>

  constructor() {
    // electron-store is an ES Module, so we need to import it dynamically
    this.storePromise = import('electron-store').then((module) => {
      const ElectronStore = module.default
      this.store = new ElectronStore<Settings>({
        name: 'erfana-settings'
      })
      return this.store
    })
  }

  private async ensureStore(): Promise<any> {
    if (!this.store) {
      await this.storePromise
    }
    return this.store
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

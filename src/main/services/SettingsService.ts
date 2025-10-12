interface Settings {
  lastProjectPath?: string
}

export class SettingsService {
  private store: any // Using any due to type issues with electron-store
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
}

// Singleton instance
export const settingsService = new SettingsService()

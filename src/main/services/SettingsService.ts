import ElectronStore from 'electron-store'

interface Settings {
  lastProjectPath?: string
}

export class SettingsService {
  private store: any // Using any due to type issues with electron-store

  constructor() {
    this.store = new ElectronStore<Settings>({
      name: 'erfana-settings'
    })
  }

  getLastProjectPath(): string | null {
    return this.store.get('lastProjectPath') || null
  }

  setLastProjectPath(path: string): void {
    this.store.set('lastProjectPath', path)
  }

  clearLastProjectPath(): void {
    this.store.delete('lastProjectPath')
  }
}

// Singleton instance
export const settingsService = new SettingsService()

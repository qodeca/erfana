interface Settings {
  lastProjectPath?: string
  approvedTools?: string[]
  projectFilterMode?: string
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

  // Approved Tools Management
  async getApprovedTools(): Promise<string[]> {
    const store = await this.ensureStore()
    // Default to pre-approved tools
    return store.get('approvedTools') || ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch']
  }

  async setApprovedTools(tools: string[]): Promise<void> {
    const store = await this.ensureStore()
    store.set('approvedTools', tools)
  }

  async addApprovedTool(toolName: string): Promise<void> {
    const store = await this.ensureStore()
    const tools = await this.getApprovedTools()
    if (!tools.includes(toolName)) {
      tools.push(toolName)
      store.set('approvedTools', tools)
    }
  }

  async removeApprovedTool(toolName: string): Promise<void> {
    const store = await this.ensureStore()
    const tools = await this.getApprovedTools()
    const filtered = tools.filter((t) => t !== toolName)
    store.set('approvedTools', filtered)
  }

  async resetApprovedTools(): Promise<void> {
    const store = await this.ensureStore()
    store.set('approvedTools', ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch'])
  }

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

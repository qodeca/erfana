/**
 * SettingsService - Persistent storage for application settings
 *
 * Uses electron-store for persistent key-value storage.
 * Note: electron-store is ES Module, so we use dynamic import()
 */

interface Settings {
  lastProjectPath?: string
  approvedTools?: string[]
  projectFilterMode?: string
}

/**
 * All available Claude Code tools (17 total)
 * Shared with renderer constants - must be kept in sync
 */
const ALL_CLAUDE_TOOLS = [
  // File Operations (7)
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'LS',

  // System Operations (1)
  'Bash',

  // AI & Web (3)
  'WebSearch',
  'WebFetch',
  'Task',

  // Workflow & Tasks (4)
  'TodoRead',
  'TodoWrite',
  'SlashCommand',
  'ExitPlanMode',

  // Jupyter Notebooks (2)
  'NotebookRead',
  'NotebookEdit'
] as const

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

  // Approved Tools Management

  /**
   * Get approved tools from settings
   * @returns Array of approved tool names (default: all 17 tools)
   */
  async getApprovedTools(): Promise<string[]> {
    const store = await this.ensureStore()
    // Default: all 17 Claude Code tools enabled
    return store.get('approvedTools') || [...ALL_CLAUDE_TOOLS]
  }

  /**
   * Set approved tools in settings
   * @param tools - Array of tool names to approve
   */
  async setApprovedTools(tools: string[]): Promise<void> {
    const store = await this.ensureStore()
    store.set('approvedTools', tools)
  }

  /**
   * Add a single tool to approved tools
   * @param toolName - Tool name to add
   */
  async addApprovedTool(toolName: string): Promise<void> {
    const store = await this.ensureStore()
    const tools = await this.getApprovedTools()
    if (!tools.includes(toolName)) {
      tools.push(toolName)
      store.set('approvedTools', tools)
    }
  }

  /**
   * Remove a single tool from approved tools
   * @param toolName - Tool name to remove
   */
  async removeApprovedTool(toolName: string): Promise<void> {
    const store = await this.ensureStore()
    const tools = await this.getApprovedTools()
    const filtered = tools.filter((t) => t !== toolName)
    store.set('approvedTools', filtered)
  }

  /**
   * Reset approved tools to default (all 17 tools)
   */
  async resetApprovedTools(): Promise<void> {
    const store = await this.ensureStore()
    // Reset to all 17 tools using shared constant
    store.set('approvedTools', [...ALL_CLAUDE_TOOLS])
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

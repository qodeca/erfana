/**
 * Interface for application settings service
 * Persists global app settings via electron-store
 */
export interface ISettingsService {
  /**
   * Set the last opened project path
   */
  setLastProjectPath(path: string): Promise<void>

  /**
   * Add a project to recent projects list
   */
  addRecentProject(path: string, name: string): Promise<void>
}

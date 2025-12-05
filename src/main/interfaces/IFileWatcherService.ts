/**
 * Interface for file watcher service
 * Watches individual files for content changes
 */
export interface IFileWatcherService {
  /**
   * Stop all active file watchers
   */
  stopAll(): Promise<void>

  /**
   * Set the project root path for security validation
   */
  setProjectPath(path: string): void
}

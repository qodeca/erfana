import { ipcMain } from 'electron'
import { gitStatusService, createGitStatusService, GitStatusService } from '../services/GitStatusService'
import { validateProjectPath } from '../utils/pathSecurity'

/**
 * Register git-related IPC handlers
 *
 * @param gitService - Optional GitStatusService instance for dependency injection (testing).
 *                     Defaults to the singleton gitStatusService.
 */
export function registerGitHandlers(gitService: GitStatusService = gitStatusService): void {
  // Get git status for a project directory
  ipcMain.handle('git:getStatus', async (_event, projectPath: string) => {
    try {
      // Validate input type
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('Invalid project path: must be a non-empty string')
      }

      // Trim whitespace
      const trimmedPath = projectPath.trim()
      if (!trimmedPath) {
        throw new Error('Invalid project path: path is empty after trimming')
      }

      // Security validation: prevent path traversal and system directory access
      await validateProjectPath(trimmedPath)

      return await gitService.getStatus(trimmedPath)
    } catch (error) {
      console.error('🔀 Error in git:getStatus handler:', error)
      throw error
    }
  })
}

// Re-export factory for tests
export { createGitStatusService }

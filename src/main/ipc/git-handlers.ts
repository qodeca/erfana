// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain } from 'electron'
import { gitStatusService, createGitStatusService, GitStatusService } from '../services/GitStatusService'
import { validateProjectPath } from '../utils/pathSecurity'
import { logger } from '../services/LoggingService'

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

      const start = performance.now()
      const result = await gitService.getStatus(trimmedPath)
      const durationMs = Math.round(performance.now() - start)
      logger.info('git:getStatus IPC completed', { durationMs, fileCount: result.files.length, truncated: result.truncated })
      return result
    } catch (error) {
      logger.error('🔀 Error in git:getStatus handler', error instanceof Error ? error : undefined)
      throw error
    }
  })
}

// Re-export factory for tests
export { createGitStatusService }

import * as git from 'isomorphic-git'
import fs from 'fs'
import { join } from 'path'
import { stat } from 'fs/promises'
import type { GitStatusResponse, GitDisplayStatus, GitFileEntry, GitStatusCounts } from '../../shared/ipc/git-schema'
import { logger } from './LoggingService'

/**
 * Cap file entries to prevent performance issues with large repositories.
 * 10,000 files × ~80 bytes per entry ≈ 800KB memory footprint.
 * Users with larger repos will see truncation warning in UI.
 */
export const GIT_STATUS_CAP = 10000

/**
 * GitStatusService - Git status detection using isomorphic-git
 *
 * Provides fast git status detection for Project Tree:
 * - Branch name and detached HEAD state
 * - File statuses (modified, untracked, deleted, staged, conflicted)
 * - Status counts for aggregation
 * - Efficient bulk operation using git.statusMatrix()
 *
 * Concurrency Control:
 * Uses per-project operation queues to prevent concurrent isomorphic-git calls.
 * This prevents index.lock file conflicts that block external git operations.
 * See: https://github.com/qodeca/erfana/issues/67
 *
 * Known Limitation:
 * Global gitignore files (~/.gitignore_global, ~/.config/git/ignore) are NOT
 * respected. This is a limitation of isomorphic-git which only reads local
 * .gitignore files. Files ignored globally may appear as "untracked".
 * See: https://github.com/isomorphic-git/isomorphic-git/issues/444
 */
export class GitStatusService {
  /**
   * Per-project operation queues - prevents concurrent git operations on same project.
   * Different projects can query in parallel without blocking each other.
   */
  private operationQueues: Map<string, Promise<GitStatusResponse>> = new Map()

  /**
   * Get git status for a project directory
   *
   * Operations are queued per-project to prevent concurrent isomorphic-git calls
   * that would create conflicting index.lock files.
   *
   * @param projectPath - Absolute path to project directory
   * @returns Git status response with branch, files, and counts
   */
  async getStatus(projectPath: string): Promise<GitStatusResponse> {
    // Get current queue for this project (or resolved empty promise if none)
    const currentQueue = this.operationQueues.get(projectPath) ?? Promise.resolve(this.createEmptyResponse())

    // Chain this operation onto the queue
    // Previous failures don't block subsequent operations
    const operation = currentQueue
      .catch(() => this.createEmptyResponse())
      .then(() => this.executeGetStatus(projectPath))

    // Update queue reference
    this.operationQueues.set(projectPath, operation)

    // Clean up queue reference after completion to prevent memory leak
    operation.finally(() => {
      if (this.operationQueues.get(projectPath) === operation) {
        this.operationQueues.delete(projectPath)
      }
    })

    return operation
  }

  /**
   * Execute the actual git status retrieval
   *
   * @param projectPath - Absolute path to project directory
   * @returns Git status response with branch, files, and counts
   */
  private async executeGetStatus(projectPath: string): Promise<GitStatusResponse> {
    try {
      const overallStart = performance.now()

      // Check if .git directory exists
      const gitDir = join(projectPath, '.git')
      try {
        const stats = await stat(gitDir)
        if (!stats.isDirectory()) {
          return this.createEmptyResponse()
        }
      } catch {
        // .git doesn't exist, not a git repo
        logger.trace('GitStatus: not a git repo', { projectPath })
        return this.createEmptyResponse()
      }

      // Get branch name
      let branch: string | null = null
      let isDetached = false

      try {
        const currentBranchName = await git.currentBranch({
          fs,
          dir: projectPath,
          fullname: false
        })

        // Check if HEAD is detached
        if (!currentBranchName) {
          // currentBranch returns undefined for detached HEAD
          isDetached = true
          // Try to get the commit hash
          try {
            const head = await git.resolveRef({
              fs,
              dir: projectPath,
              ref: 'HEAD'
            })
            branch = head.substring(0, 7) // Short hash
          } catch {
            branch = null
          }
        } else {
          branch = currentBranchName
        }
      } catch (error) {
        logger.error('Error getting branch name', error instanceof Error ? error : undefined)
        // Continue without branch info
      }

      // Get file statuses using statusMatrix (efficient bulk operation)
      logger.debug('GitStatus: calling statusMatrix', { projectPath })
      const statusMatrixStart = performance.now()
      const matrix = await git.statusMatrix({
        fs,
        dir: projectPath
      })
      const statusMatrixDurationMs = Math.round(performance.now() - statusMatrixStart)
      if (statusMatrixDurationMs > 2000) {
        logger.warn('GitStatus: statusMatrix completed (slow)', { durationMs: statusMatrixDurationMs, matrixRows: matrix.length })
      } else {
        logger.debug('GitStatus: statusMatrix completed', { durationMs: statusMatrixDurationMs, matrixRows: matrix.length })
      }

      const files: GitFileEntry[] = []
      const counts: GitStatusCounts = {
        modified: 0,
        untracked: 0,
        deleted: 0,
        staged: 0,
        conflicted: 0
      }

      let truncated = false

      for (const [filepath, HEADStatus, workdirStatus, stageStatus] of matrix) {
        // Cap file entries to prevent performance issues
        if (files.length >= GIT_STATUS_CAP) {
          truncated = true
          logger.warn('GitStatus: truncated', { cap: GIT_STATUS_CAP, matrixLength: matrix.length })
          break
        }

        // Map statusMatrix output to GitDisplayStatus
        // statusMatrix returns [filepath, HEADStatus, workdirStatus, stageStatus]
        // where:
        // - HEADStatus: 0 = absent, 1 = present
        // - workdirStatus: 0 = absent, 1 = identical to HEAD, 2 = different from HEAD
        // - stageStatus: 0 = absent, 1 = identical to HEAD, 2 = different from HEAD, 3 = different from both

        let status: GitDisplayStatus
        let isStaged = false

        // Untracked: not in HEAD, exists in workdir
        if (HEADStatus === 0 && workdirStatus === 2 && stageStatus === 0) {
          status = 'untracked'
          counts.untracked++
        }
        // Modified (unstaged): in HEAD, different in workdir, same in stage
        else if (HEADStatus === 1 && workdirStatus === 2 && stageStatus === 1) {
          status = 'modified'
          counts.modified++
        }
        // Staged (new file): not in HEAD, exists in workdir and stage
        else if (HEADStatus === 0 && workdirStatus === 2 && (stageStatus === 2 || stageStatus === 3)) {
          status = 'staged'
          isStaged = true
          counts.staged++
        }
        // Staged (modified file): in HEAD, different in stage
        else if (HEADStatus === 1 && workdirStatus === 2 && (stageStatus === 2 || stageStatus === 3)) {
          status = 'staged'
          isStaged = true
          counts.staged++
        }
        // Deleted (unstaged): in HEAD, absent in workdir, present in stage
        else if (HEADStatus === 1 && workdirStatus === 0 && stageStatus === 1) {
          status = 'deleted'
          counts.deleted++
        }
        // Deleted (staged): in HEAD, absent in workdir and stage
        else if (HEADStatus === 1 && workdirStatus === 0 && stageStatus === 0) {
          status = 'deleted'
          isStaged = true
          counts.deleted++
        }
        // Conflicted: different in all three (HEAD, workdir, stage)
        else if (HEADStatus === 1 && workdirStatus === 2 && stageStatus === 3) {
          status = 'conflicted'
          counts.conflicted++
        }
        // Unmodified: identical in all locations
        else if (HEADStatus === 1 && workdirStatus === 1 && stageStatus === 1) {
          status = 'unmodified'
          // Skip unmodified files (no indicator needed)
          continue
        }
        // Unknown status, skip
        else {
          continue
        }

        files.push({
          path: join(projectPath, filepath),
          status,
          staged: isStaged
        })
      }

      const durationMs = Math.round(performance.now() - overallStart)
      logger.info('GitStatus: completed', { durationMs, strategy: 'isomorphic-git', fileCount: files.length, truncated })

      return {
        isGitRepo: true,
        branch,
        isDetached,
        files,
        counts,
        truncated
      }
    } catch (error) {
      logger.error('Error getting git status', error instanceof Error ? error : undefined)
      return {
        ...this.createEmptyResponse(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Create an empty git status response (for non-git repos or errors)
   */
  private createEmptyResponse(): GitStatusResponse {
    return {
      isGitRepo: false,
      branch: null,
      isDetached: false,
      files: [],
      counts: {
        modified: 0,
        untracked: 0,
        deleted: 0,
        staged: 0,
        conflicted: 0
      },
      truncated: false
    }
  }
}

/**
 * Factory function to create a GitStatusService instance.
 * Enables dependency injection for testing.
 *
 * @returns New GitStatusService instance
 */
export function createGitStatusService(): GitStatusService {
  return new GitStatusService()
}

// Default singleton instance for production use
export const gitStatusService = createGitStatusService()

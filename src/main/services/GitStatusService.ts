import * as git from 'isomorphic-git'
import fs from 'fs'
import { join } from 'path'
import { stat } from 'fs/promises'
import type { GitStatusResponse, GitDisplayStatus, GitFileEntry, GitStatusCounts } from '../../shared/ipc/git-schema'

// Cap file entries at 10,000 to prevent performance issues
const GIT_STATUS_CAP = 10000

/**
 * GitStatusService - Git status detection using isomorphic-git
 *
 * Provides fast git status detection for Project Tree:
 * - Branch name and detached HEAD state
 * - File statuses (modified, untracked, deleted, staged, conflicted)
 * - Status counts for aggregation
 * - Efficient bulk operation using git.statusMatrix()
 */
export class GitStatusService {
  /**
   * Get git status for a project directory
   *
   * @param projectPath - Absolute path to project directory
   * @returns Git status response with branch, files, and counts
   */
  async getStatus(projectPath: string): Promise<GitStatusResponse> {
    try {
      // Check if .git directory exists
      const gitDir = join(projectPath, '.git')
      try {
        const stats = await stat(gitDir)
        if (!stats.isDirectory()) {
          return this.createEmptyResponse()
        }
      } catch {
        // .git doesn't exist, not a git repo
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
        console.error('🔀 Error getting branch name:', error)
        // Continue without branch info
      }

      // Get file statuses using statusMatrix (efficient bulk operation)
      const matrix = await git.statusMatrix({
        fs,
        dir: projectPath
      })

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

      console.log(`🔀 Git status: ${files.length} files (${counts.modified}M ${counts.untracked}U ${counts.deleted}D ${counts.staged}A)`)

      return {
        isGitRepo: true,
        branch,
        isDetached,
        files,
        counts,
        truncated
      }
    } catch (error) {
      console.error('🔀 Error getting git status:', error)
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

// Singleton instance
export const gitStatusService = new GitStatusService()

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { join } from 'path'
import { access } from 'fs/promises'
import { createEmptyGitStatusResponse } from '../../shared/ipc/git-schema'
import type { GitStatusResponse } from '../../shared/ipc/git-schema'
import type { IGitStatusWorker } from '../interfaces/IGitStatusWorker'
import { GitStatusCircuitBreaker } from './GitStatusCircuitBreaker'
import { GitStatusWorkerAdapter } from './GitStatusWorkerAdapter'
import { logger } from './LoggingService'

/**
 * GitStatusService - Orchestrates git status retrieval via worker thread
 *
 * Delegates all git status computation to an IGitStatusWorker implementation,
 * keeping the main Electron thread responsive. The service handles:
 * - Per-project operation queuing (prevents concurrent worker calls per project)
 * - Circuit breaker (disables worker after repeated crashes)
 * - Timing and structured logging
 *
 * Native git is the preferred strategy (it honours core.autocrlf /
 * .gitattributes, matching the user's own git). The worker falls back to
 * isomorphic-git only when no git binary is available; the native-vs-iso
 * decision is therefore made *inside* the worker (see
 * `git-status.worker.ts:resolveGitPath`), not here.
 *
 * Concurrency control:
 * Uses per-project operation queues to serialize requests. Different projects
 * can query in parallel without blocking each other.
 * See: https://github.com/qodeca/erfana/issues/67
 *
 * @see IGitStatusWorker for the worker interface
 * @see Spec #022 - Git status thread offloading
 */
export class GitStatusService {
  private readonly worker: IGitStatusWorker
  private readonly circuitBreaker = new GitStatusCircuitBreaker()

  /**
   * Per-project operation queues - prevents concurrent git operations on same project.
   * Different projects can query in parallel without blocking each other.
   */
  private operationQueues: Map<string, Promise<GitStatusResponse>> = new Map()

  constructor(worker?: IGitStatusWorker) {
    this.worker = worker ?? new GitStatusWorkerAdapter()
  }

  /**
   * Get git status for a project directory.
   *
   * Operations are queued per-project to prevent concurrent worker calls
   * that would create conflicting index.lock files.
   *
   * @param projectPath - Absolute path to project directory
   * @returns Git status response with branch, files, and counts
   */
  async getStatus(projectPath: string): Promise<GitStatusResponse> {
    // Get current queue for this project (or resolved empty promise if none)
    const currentQueue = this.operationQueues.get(projectPath) ?? Promise.resolve(createEmptyGitStatusResponse())

    // Chain this operation onto the queue
    // Previous failures don't block subsequent operations
    const operation = currentQueue
      .catch(() => createEmptyGitStatusResponse())
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
   * Terminate the worker thread and release all resources.
   * Safe to call multiple times.
   */
  async dispose(): Promise<void> {
    this.circuitBreaker.dispose()
    this.operationQueues.clear()
    await this.worker.dispose()
  }

  /**
   * Execute the actual git status retrieval by delegating to the worker.
   *
   * @param projectPath - Absolute path to project directory
   * @returns Git status response with branch, files, and counts
   */
  private async executeGetStatus(projectPath: string): Promise<GitStatusResponse> {
    // Quick bail-out: only when `.git` is truly absent (ENOENT).
    //
    // We intentionally do NOT require `.git` to be a directory: linked git
    // worktrees and submodules use a `.git` *file* containing a `gitdir:`
    // pointer, and native git resolves it fine. Short-circuiting on
    // !isDirectory() previously hid status for every worktree. The worker's
    // executeIsomorphicGit and executeNativeGit handle both shapes.
    const gitDir = join(projectPath, '.git')
    try {
      await access(gitDir)
    } catch {
      logger.trace('GitStatus: not a git repo', { projectPath })
      return createEmptyGitStatusResponse()
    }

    // Check circuit breaker - skip worker if it has crashed repeatedly
    if (this.circuitBreaker.isOpen(projectPath)) {
      return { ...createEmptyGitStatusResponse(), error: 'Git status disabled: worker crashed repeatedly' }
    }

    // Native is the *preferred* strategy. The native-vs-iso decision lives in
    // the worker, keyed on whether `resolveGitPath()` succeeds. Tests can pass
    // `'isomorphic-git'` to force the portable path.
    const strategy = 'native-git' as const

    // Delegate to worker with timing
    const startTime = performance.now()
    try {
      const response = await this.worker.execute({ projectPath, strategy })
      const duration = Math.round(performance.now() - startTime)

      // Record breaker success only when the worker returned a clean response.
      // A response with `error` set is the worker's "transient / durable
      // failure" signal; counting it as success here would reset interleaved
      // real-crash history and let a permanently failing worker mask the
      // breaker. Crashes (thrown by execute()) are handled in the catch below.
      if (!response.error) {
        this.circuitBreaker.recordSuccess(projectPath)
      }

      logger.info('GitStatus: completed', {
        strategy,
        durationMs: duration,
        fileCount: response.files.length,
        truncated: response.truncated,
        hasError: Boolean(response.error)
      })

      return response
    } catch (error) {
      const duration = Math.round(performance.now() - startTime)

      // Record crash for circuit breaker
      this.circuitBreaker.recordCrash(projectPath)

      logger.warn('GitStatus: worker error', {
        strategy,
        durationMs: duration,
        error: error instanceof Error ? error.message : String(error)
      })

      return {
        ...createEmptyGitStatusResponse(),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

}

/**
 * Factory function to create a GitStatusService instance.
 * Enables dependency injection for testing.
 *
 * @param worker - Optional worker implementation for testing
 * @returns New GitStatusService instance
 */
export function createGitStatusService(worker?: IGitStatusWorker): GitStatusService {
  return new GitStatusService(worker)
}

// Default singleton instance for production use
export const gitStatusService = createGitStatusService()

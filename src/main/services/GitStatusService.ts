import { join } from 'path'
import { stat } from 'fs/promises'
import { createEmptyGitStatusResponse } from '../../shared/ipc/git-schema'
import type { GitStatusResponse } from '../../shared/ipc/git-schema'
import type { IGitStatusWorker } from '../interfaces/IGitStatusWorker'
import { GitStatusCircuitBreaker } from './GitStatusCircuitBreaker'
import { GitStatusStrategySelector } from './GitStatusStrategySelector'
import { GitStatusWorkerAdapter } from './GitStatusWorkerAdapter'
import { logger } from './LoggingService'

/**
 * GitStatusService - Orchestrates git status retrieval via worker thread
 *
 * Delegates all git status computation to an IGitStatusWorker implementation,
 * keeping the main Electron thread responsive. The service handles:
 * - Per-project operation queuing (prevents concurrent worker calls per project)
 * - Circuit breaker (disables worker after repeated crashes)
 * - Strategy selection (isomorphic-git vs native git based on repo size)
 * - Timing and structured logging
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
  private readonly strategySelector = new GitStatusStrategySelector()

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
   * Clear the worker's statusMatrix cache for a specific project or all projects.
   *
   * @param projectPath - Optional path to clear; omit to clear all
   */
  async clearCache(projectPath?: string): Promise<void> {
    await this.worker.clearCache(projectPath)
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
    // Quick bail-out: check if .git directory exists
    const gitDir = join(projectPath, '.git')
    try {
      const stats = await stat(gitDir)
      if (!stats.isDirectory()) {
        return createEmptyGitStatusResponse()
      }
    } catch {
      logger.trace('GitStatus: not a git repo', { projectPath })
      return createEmptyGitStatusResponse()
    }

    // Check circuit breaker - skip worker if it has crashed repeatedly
    if (this.circuitBreaker.isOpen(projectPath)) {
      return { ...createEmptyGitStatusResponse(), error: 'Git status disabled: worker crashed repeatedly' }
    }

    // Select strategy based on repository size
    const strategy = await this.strategySelector.select(projectPath)

    // Delegate to worker with timing
    const startTime = performance.now()
    try {
      const response = await this.worker.execute({ projectPath, strategy })
      const duration = Math.round(performance.now() - startTime)

      // Record success for circuit breaker half-open recovery
      this.circuitBreaker.recordSuccess(projectPath)

      logger.info('GitStatus: completed', {
        strategy,
        durationMs: duration,
        fileCount: response.files.length,
        truncated: response.truncated
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

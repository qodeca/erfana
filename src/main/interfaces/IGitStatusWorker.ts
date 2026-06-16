// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { GitStatusResponse } from '../../shared/ipc/git-schema'

/** Strategy for git status computation */
export type GitStatusStrategy = 'isomorphic-git' | 'native-git'

/** Request payload sent to the worker thread */
export interface GitWorkerRequest {
  projectPath: string
  strategy: GitStatusStrategy
}

/**
 * Interface for git status worker adapter
 *
 * All git status computation is delegated through this interface
 * to a worker thread, keeping the main thread responsive.
 *
 * Follows Interface Segregation Principle by exposing only
 * the minimal API needed by GitStatusService.
 *
 * @see GitStatusWorkerAdapter for implementation
 * @see Spec #022 - Git status thread offloading
 */
export interface IGitStatusWorker {
  /**
   * Execute a git status operation in the worker thread.
   *
   * @param request - The worker request with project path and strategy
   * @returns Promise resolving with the git status response
   */
  execute(request: GitWorkerRequest): Promise<GitStatusResponse>

  /**
   * Terminate the worker thread and release resources.
   *
   * Safe to call multiple times.
   */
  dispose(): Promise<void>

  /**
   * Check if the worker thread is alive and accepting requests.
   */
  isAlive(): boolean
}

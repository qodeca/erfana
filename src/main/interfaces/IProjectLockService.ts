// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for the project lock service
 *
 * Manages file-based locks to prevent duplicate project opens across Erfana instances.
 * Lock files are stored in ~/.erfana/locks/{hash}.lock
 *
 * Implements Interface Segregation Principle by exposing only
 * the minimal API needed by consumers.
 *
 * @see ProjectLockService for implementation
 * @see Spec #010 - Multi-instance support specification
 * @see Issue #27 - Multiple independent instances
 */
import type { LockResult, LockStatus } from '../../shared/ipc/project-lock-schema'

export interface IProjectLockService {
  /**
   * Acquires a lock for the specified project path.
   * Creates lock file in ~/.erfana/locks/{hash}.lock
   *
   * @param projectPath - Absolute path to the project directory
   * @returns LockResult indicating success, already locked, or error
   */
  acquireLock(projectPath: string): Promise<LockResult>

  /**
   * Releases the lock for the specified project path.
   * Removes the lock file and stops focus polling.
   *
   * Safe to call even if lock doesn't exist or is held by another instance.
   *
   * @param projectPath - Absolute path to the project directory
   */
  releaseLock(projectPath: string): Promise<void>

  /**
   * Checks if a project is locked and by whom.
   *
   * @param projectPath - Absolute path to the project directory
   * @returns LockStatus indicating unlocked, locked_by_self, locked_by_other, or error
   */
  checkLock(projectPath: string): Promise<LockStatus>

  /**
   * Cleans up stale locks at application startup.
   * Removes locks from dead processes or timed-out network locks.
   *
   * Called during app initialization to recover from crashes.
   *
   * @returns Number of stale locks that were cleaned up
   */
  cleanupStaleLocks(): Promise<number>

  /**
   * Requests focus from the process that holds the lock.
   * Writes focus_request to the lock file and waits for response.
   *
   * Used when user attempts to open a project that's already open
   * in another Erfana instance.
   *
   * @param projectPath - Absolute path to the project directory
   * @returns true if focus request was acknowledged, false otherwise
   */
  requestFocus(projectPath: string): Promise<boolean>

  /**
   * Gets the path to the locks directory.
   *
   * @returns Absolute path to ~/.erfana/locks/
   */
  getLocksDirectory(): string

  /**
   * Computes the lock hash for a project path.
   * Uses SHA-256 hash of the normalized absolute path.
   *
   * @param projectPath - Absolute path to the project directory
   * @returns Hex-encoded hash string
   */
  computeLockHash(projectPath: string): Promise<string>

  /**
   * Subscribes to loss of lock ownership for a project.
   *
   * The lock is what guarantees a single Erfana process per project, and so a
   * single graph-index writer. Today the heartbeat's ownership-lost hook is
   * wired inline and only deletes the entry from `activeLocks` — nothing is
   * emitted, so a consumer that must react (close the writer, detach the
   * reader) has nothing to subscribe to.
   *
   * Declared by #21 as part of the graph contract set; **implemented by #23**,
   * which fans it out from the existing `LockHeartbeat` hook and wires
   * `GraphLifecycle` to it. Optional until then, purely so this declaration
   * changes no runtime behaviour — #23 drops the `?` when it lands.
   *
   * Residual, recorded rather than papered over: `checkLock` is async and
   * main-side while writes are synchronous in the worker, and the lock has a
   * documented stale-takeover window. This event narrows the TOCTOU window; it
   * does not close it.
   *
   * @param cb - Invoked with the project path whose lock was lost
   * @returns Unsubscribe function
   * @see Issue #21 - graph R1 architecture
   * @see specs/designs/sd-021-cross-cutting.md §9.7
   */
  onOwnershipLost?(cb: (projectPath: string) => void): () => void

  /**
   * Disposes of the service, releasing all locks and stopping polling.
   * Called on app shutdown.
   */
  dispose(): Promise<void>
}

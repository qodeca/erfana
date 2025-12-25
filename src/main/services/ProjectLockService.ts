/**
 * ProjectLockService - File-based project locking for multi-instance support
 *
 * Prevents duplicate project opens across Erfana instances using file locks.
 * Lock files are stored in ~/.erfana/locks/{sha256-hash}.lock
 *
 * Features:
 * - Hybrid stale detection: PID check (same host) + 60-min timeout (cross-host)
 * - 500ms focus polling for inter-instance focus requests
 * - Atomic writes for crash safety
 * - Platform-adaptive window focusing
 * - Session-based lock tracking with cleanup on dispose
 *
 * Design:
 * - Singleton pattern for centralized state
 * - Implements IProjectLockService interface
 * - Uses atomicWriteJSON for crash-safe writes
 * - Uses focusWindow for platform-adaptive focusing
 *
 * @see IProjectLockService for interface definition
 * @see BRS-010 - Multi-instance support specification
 * @see Issue #27 - Multiple independent instances
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, mkdir, lstat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import { app } from 'electron'
import { hostname } from 'node:os'

import { broadcastToAllWindows } from '../utils/ipcBroadcast'

import type { IProjectLockService } from '../interfaces/IProjectLockService'
import type { LockInfo, LockResult, LockStatus } from '../../shared/ipc/project-lock-schema'
import { LockInfoSchema } from '../../shared/ipc/project-lock-schema'
import { atomicWriteJSON, removeIfExists } from '../utils/atomicWrite'
import { focusWindow, getMainWindow } from '../utils/focusWindow'
import { logger } from './LoggingService'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Length of truncated SHA-256 hash (128 bits = 32 hex chars) */
const LOCK_HASH_LENGTH = 32

/** Focus request polling interval (ms) */
const POLL_INTERVAL_MS = 500

/** Stale lock timeout for cross-host detection (60 minutes) */
const STALE_TIMEOUT_MS = 60 * 60 * 1000

/** Clock skew buffer for cross-host timestamp comparison (5 minutes) */
const CLOCK_SKEW_BUFFER_MS = 5 * 60 * 1000

/** Lock file extension */
const LOCK_EXTENSION = '.lock'

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal tracking for active locks held by this instance
 */
interface ActiveLock {
  /** Truncated hash of the project path */
  hash: string
  /** Focus polling timer (null if not polling) */
  pollTimer: NodeJS.Timeout | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Service implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ProjectLockService
 *
 * Singleton service for managing file-based project locks.
 * Use `projectLockService.acquireLock(projectPath)` to lock a project.
 */
export class ProjectLockService implements IProjectLockService {
  /** Unique identifier for this Erfana instance */
  private readonly instanceId: string = randomUUID()

  /** Path to locks directory (~/.erfana/locks/) */
  private readonly locksDir: string

  /** Map of project paths to active lock state */
  private readonly activeLocks = new Map<string, ActiveLock>()

  /** Flag to prevent operations during disposal */
  private isDisposing = false

  /** Current hostname (cached for performance) */
  private readonly currentHostname: string

  constructor() {
    this.locksDir = join(app.getPath('userData'), 'locks')
    this.currentHostname = hostname()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Acquires a lock for the specified project path.
   * Creates lock file in ~/.erfana/locks/{hash}.lock
   *
   * @param projectPath - Absolute path to the project directory
   * @returns LockResult indicating success, already locked, or error
   */
  async acquireLock(projectPath: string): Promise<LockResult> {
    if (this.isDisposing) {
      return { status: 'error', message: 'Service is disposing' }
    }

    try {
      const hash = await this.computeLockHash(projectPath)
      const lockPath = this.getLockPath(hash)

      // Check if we already hold this lock
      if (this.activeLocks.has(projectPath)) {
        logger.debug('ProjectLockService: Lock already held by this instance', { projectPath })
        return { status: 'acquired', lockPath }
      }

      // Ensure locks directory exists
      await mkdir(this.locksDir, { recursive: true, mode: 0o700 })

      // Try to read existing lock
      const existingLock = await this.readLockFile(lockPath)

      if (existingLock) {
        // Check if the lock is stale
        const stale = await this.isLockStale(existingLock)

        if (stale) {
          logger.info('ProjectLockService: Removing stale lock', {
            projectPath,
            holderPid: existingLock.pid,
            holderHostname: existingLock.hostname
          })
          await removeIfExists(lockPath)
        } else {
          // Lock is held by another active instance
          logger.info('ProjectLockService: Project already locked', {
            projectPath,
            holderPid: existingLock.pid,
            holderHostname: existingLock.hostname
          })
          return {
            status: 'already_locked',
            holderPid: existingLock.pid,
            holderHostname: existingLock.hostname
          }
        }
      }

      // Create new lock
      const lockInfo: LockInfo = {
        instanceId: this.instanceId,
        pid: process.pid,
        timestamp: new Date().toISOString(),
        hostname: this.currentHostname,
        path: projectPath,
        focus_request: false
      }

      await atomicWriteJSON(lockPath, lockInfo)

      // Track the lock and start focus polling
      this.activeLocks.set(projectPath, {
        hash,
        pollTimer: this.startFocusPolling(projectPath, hash)
      })

      logger.info('ProjectLockService: Lock acquired', { projectPath, lockPath })
      return { status: 'acquired', lockPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        'ProjectLockService: Failed to acquire lock',
        error instanceof Error ? error : new Error(message),
        { projectPath }
      )
      return { status: 'error', message }
    }
  }

  /**
   * Releases the lock for the specified project path.
   * Removes the lock file and stops focus polling.
   *
   * Safe to call even if lock doesn't exist or is held by another instance.
   *
   * @param projectPath - Absolute path to the project directory
   */
  async releaseLock(projectPath: string): Promise<void> {
    const activeLock = this.activeLocks.get(projectPath)

    if (!activeLock) {
      // Not tracking this lock - may be held by another instance
      logger.debug('ProjectLockService: No active lock to release', { projectPath })
      return
    }

    // Stop focus polling
    if (activeLock.pollTimer) {
      clearInterval(activeLock.pollTimer)
    }

    // Remove lock file
    const lockPath = this.getLockPath(activeLock.hash)
    try {
      const removed = await removeIfExists(lockPath)
      if (removed) {
        logger.info('ProjectLockService: Lock released', { projectPath, lockPath })
      }
    } catch (error) {
      // Log but don't throw - release should be best-effort
      logger.warn('ProjectLockService: Error removing lock file', {
        projectPath,
        lockPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // Remove from tracking
    this.activeLocks.delete(projectPath)
  }

  /**
   * Checks if a project is locked and by whom.
   *
   * @param projectPath - Absolute path to the project directory
   * @returns LockStatus indicating unlocked, locked_by_self, locked_by_other, or error
   */
  async checkLock(projectPath: string): Promise<LockStatus> {
    try {
      const hash = await this.computeLockHash(projectPath)
      const lockPath = this.getLockPath(hash)

      const lockInfo = await this.readLockFile(lockPath)

      if (!lockInfo) {
        return { status: 'unlocked' }
      }

      // Check if we hold this lock
      if (lockInfo.instanceId === this.instanceId) {
        return { status: 'locked_by_self', lockPath }
      }

      // Check if lock is stale
      const stale = await this.isLockStale(lockInfo)

      if (stale) {
        return { status: 'unlocked' }
      }

      return {
        status: 'locked_by_other',
        holderPid: lockInfo.pid,
        holderHostname: lockInfo.hostname
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        'ProjectLockService: Failed to check lock',
        error instanceof Error ? error : new Error(message),
        { projectPath }
      )
      return { status: 'error', message }
    }
  }

  /**
   * Cleans up stale locks at application startup.
   * Removes locks from dead processes or timed-out network locks.
   *
   * Called during app initialization to recover from crashes.
   *
   * @returns Number of stale locks that were cleaned up
   */
  async cleanupStaleLocks(): Promise<number> {
    let cleanedCount = 0

    try {
      // Ensure locks directory exists
      await mkdir(this.locksDir, { recursive: true, mode: 0o700 })

      const entries = await readdir(this.locksDir)

      for (const entry of entries) {
        if (!entry.endsWith(LOCK_EXTENSION)) {
          continue
        }

        const lockPath = join(this.locksDir, entry)

        try {
          // Security: Skip symlinks to prevent file deletion outside locks directory
          const stats = await lstat(lockPath)
          if (stats.isSymbolicLink()) {
            logger.warn('ProjectLockService: Skipping symlink lock file', { lockPath })
            continue
          }

          const lockInfo = await this.readLockFile(lockPath)

          if (!lockInfo) {
            continue
          }

          const stale = await this.isLockStale(lockInfo)

          if (stale) {
            const removed = await removeIfExists(lockPath)
            if (removed) {
              cleanedCount++
              logger.info('ProjectLockService: Cleaned up stale lock', {
                lockPath,
                holderPid: lockInfo.pid,
                holderHostname: lockInfo.hostname,
                projectPath: lockInfo.path
              })
            }
          }
        } catch (error) {
          // Log individual lock cleanup errors but continue with others
          logger.warn('ProjectLockService: Error checking lock file', {
            lockPath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch (error) {
      // If we can't read the directory, just log and return 0
      logger.warn('ProjectLockService: Error reading locks directory', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    if (cleanedCount > 0) {
      logger.info('ProjectLockService: Cleanup complete', { cleanedCount })
    }

    return cleanedCount
  }

  /**
   * Requests focus from the process that holds the lock.
   * Writes focus_request to the lock file and waits for response.
   *
   * Used when user attempts to open a project that's already open
   * in another Erfana instance.
   *
   * @param projectPath - Absolute path to the project directory
   * @returns true if focus request was written, false otherwise
   */
  async requestFocus(projectPath: string): Promise<boolean> {
    try {
      const hash = await this.computeLockHash(projectPath)
      const lockPath = this.getLockPath(hash)

      const lockInfo = await this.readLockFile(lockPath)

      if (!lockInfo) {
        logger.debug('ProjectLockService: No lock file to request focus', { projectPath })
        return false
      }

      // Don't request focus from ourselves
      if (lockInfo.instanceId === this.instanceId) {
        return false
      }

      // Update lock file with focus request
      const updatedLock: LockInfo = {
        ...lockInfo,
        focus_request: true,
        requester_pid: process.pid
      }

      await atomicWriteJSON(lockPath, updatedLock)

      logger.info('ProjectLockService: Focus request sent', {
        projectPath,
        holderPid: lockInfo.pid,
        holderHostname: lockInfo.hostname
      })

      return true
    } catch (error) {
      logger.warn('ProjectLockService: Failed to request focus', {
        projectPath,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  /**
   * Gets the path to the locks directory.
   *
   * @returns Absolute path to ~/.erfana/locks/
   */
  getLocksDirectory(): string {
    return this.locksDir
  }

  /**
   * Computes the lock hash for a project path.
   * Uses SHA-256 hash of the normalized absolute path.
   *
   * Path normalization:
   * 1. Resolve symlinks with realpath
   * 2. Normalize path separators
   * 3. Case-fold on Windows (case-insensitive filesystem)
   *
   * @param projectPath - Absolute path to the project directory
   * @returns Hex-encoded hash string (32 chars, truncated SHA-256)
   */
  async computeLockHash(projectPath: string): Promise<string> {
    let canonicalPath: string

    try {
      // Resolve symlinks to get the actual path
      canonicalPath = await realpath(projectPath)
    } catch {
      // If realpath fails (path doesn't exist), use the original
      canonicalPath = projectPath
    }

    // Normalize path separators
    canonicalPath = normalize(canonicalPath)

    // Case-fold on Windows (case-insensitive filesystem)
    if (process.platform === 'win32') {
      canonicalPath = canonicalPath.toLowerCase()
    }

    // Ensure consistent trailing separator handling (no trailing separator)
    while (canonicalPath.endsWith(sep) && canonicalPath !== sep) {
      canonicalPath = canonicalPath.slice(0, -1)
    }

    // Compute SHA-256 hash and truncate to 32 hex chars (128 bits)
    const hash = createHash('sha256').update(canonicalPath, 'utf8').digest('hex')

    return hash.slice(0, LOCK_HASH_LENGTH)
  }

  /**
   * Disposes of the service, releasing all locks and stopping polling.
   * Called on app shutdown.
   */
  async dispose(): Promise<void> {
    this.isDisposing = true

    logger.info('ProjectLockService: Disposing', { activeLocksCount: this.activeLocks.size })

    // Release all locks
    const releasePromises = Array.from(this.activeLocks.keys()).map((projectPath) =>
      this.releaseLock(projectPath)
    )

    await Promise.all(releasePromises)

    logger.info('ProjectLockService: Disposed')
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Gets the full path to a lock file by hash.
   *
   * @param hash - Truncated SHA-256 hash
   * @returns Absolute path to the lock file
   */
  private getLockPath(hash: string): string {
    return join(this.locksDir, `${hash}${LOCK_EXTENSION}`)
  }

  /**
   * Reads and validates a lock file.
   *
   * @param lockPath - Absolute path to the lock file
   * @returns Parsed LockInfo or null if file doesn't exist or is invalid
   */
  private async readLockFile(lockPath: string): Promise<LockInfo | null> {
    try {
      const content = await readFile(lockPath, 'utf8')
      const parsed = JSON.parse(content)
      const validated = LockInfoSchema.parse(parsed)
      return validated
    } catch (error) {
      // ENOENT is expected if lock doesn't exist
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }

      // Log other errors (corrupt file, invalid schema, etc.)
      logger.debug('ProjectLockService: Error reading lock file', {
        lockPath,
        error: error instanceof Error ? error.message : String(error)
      })

      return null
    }
  }

  /**
   * Checks if a lock is stale (holder process is dead or timed out).
   *
   * Hybrid approach:
   * - Same hostname: Check if PID is alive
   * - Different hostname: Check if lock is older than STALE_TIMEOUT_MS
   *
   * @param lockInfo - Lock information to check
   * @returns true if lock is stale and can be removed
   */
  private async isLockStale(lockInfo: LockInfo): Promise<boolean> {
    // Same hostname: check if process is alive
    if (lockInfo.hostname === this.currentHostname) {
      const alive = this.isProcessAlive(lockInfo.pid)
      if (!alive) {
        logger.debug('ProjectLockService: Lock holder process is dead', {
          pid: lockInfo.pid,
          hostname: lockInfo.hostname
        })
        return true
      }
      return false
    }

    // Different hostname: check timestamp with clock skew buffer
    const lockTime = new Date(lockInfo.timestamp).getTime()
    const now = Date.now()
    const age = now - lockTime

    // Account for potential clock skew
    const effectiveTimeout = STALE_TIMEOUT_MS + CLOCK_SKEW_BUFFER_MS

    if (age > effectiveTimeout) {
      logger.debug('ProjectLockService: Cross-host lock timed out', {
        pid: lockInfo.pid,
        hostname: lockInfo.hostname,
        ageMinutes: Math.round(age / 60000)
      })
      return true
    }

    return false
  }

  /**
   * Checks if a process is alive using kill signal 0.
   *
   * process.kill(pid, 0) doesn't actually send a signal - it just
   * checks if the process exists and we have permission to signal it.
   *
   * @param pid - Process ID to check
   * @returns true if process exists, false otherwise
   */
  private isProcessAlive(pid: number): boolean {
    try {
      // Signal 0 doesn't actually kill - just checks if process exists
      process.kill(pid, 0)
      return true
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code

      // EPERM means process exists but we don't have permission to signal it
      // This shouldn't happen for our own locks, but handle it gracefully
      if (errno === 'EPERM') {
        return true
      }

      // ESRCH means process doesn't exist
      if (errno === 'ESRCH') {
        return false
      }

      // Other errors: assume process is gone
      return false
    }
  }

  /**
   * Starts focus request polling for a locked project.
   *
   * Polls the lock file every POLL_INTERVAL_MS to check for focus_request.
   * When a focus request is detected, focuses the main window and clears
   * the request.
   *
   * @param projectPath - The project path being locked
   * @param hash - The lock hash
   * @returns The interval timer (for cleanup)
   */
  private startFocusPolling(projectPath: string, hash: string): NodeJS.Timeout {
    const lockPath = this.getLockPath(hash)

    return setInterval(async () => {
      if (this.isDisposing) {
        return
      }

      try {
        const lockInfo = await this.readLockFile(lockPath)

        if (lockInfo && lockInfo.focus_request) {
          await this.handleFocusRequest(lockInfo, lockPath, projectPath)
        }
      } catch {
        // Ignore polling errors - lock file may be temporarily unavailable
      }
    }, POLL_INTERVAL_MS)
  }

  /**
   * Handles a focus request by focusing the main window and clearing the request.
   *
   * @param lockInfo - Current lock information
   * @param lockPath - Path to the lock file
   * @param projectPath - The project path
   */
  private async handleFocusRequest(
    lockInfo: LockInfo,
    lockPath: string,
    projectPath: string
  ): Promise<void> {
    logger.info('ProjectLockService: Handling focus request', {
      projectPath,
      requesterPid: lockInfo.requester_pid
    })

    // Focus the main window
    const mainWindow = getMainWindow()
    if (mainWindow) {
      const focused = await focusWindow(mainWindow)
      logger.debug('ProjectLockService: Window focus result', { focused })

      // Notify renderer that window was focused by another instance
      broadcastToAllWindows('project-lock:focused', {
        projectPath,
        requesterPid: lockInfo.requester_pid ?? 0
      })
    }

    // Clear the focus request
    const updatedLock: LockInfo = {
      ...lockInfo,
      focus_request: false,
      requester_pid: undefined
    }

    try {
      await atomicWriteJSON(lockPath, updatedLock)
    } catch (error) {
      logger.warn('ProjectLockService: Failed to clear focus request', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton instance */
export const projectLockService = new ProjectLockService()

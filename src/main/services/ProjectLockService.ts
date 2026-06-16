// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectLockService - Thin composer for file-based project locking
 *
 * Prevents duplicate project opens across Erfana instances using file locks.
 * Lock files are stored in ~/.erfana/locks/{sha256-hash}.lock
 *
 * Composition:
 * - LockStalenessPolicy — hybrid stale detection (PID check same-host, 60-min timeout cross-host)
 * - LockHeartbeatService — polling timer, heartbeat writes, powerMonitor integration, focus handling
 *
 * Owns:
 * - acquireLock / releaseLock / checkLock — lock lifecycle
 * - requestFocus — writes focus_request to the lock file
 * - cleanupStaleLocks — startup recovery (removes stale / orphan-tmp files)
 * - dispose — stops all timers then releases all active locks
 *
 * Constructor-injected: Clock, ProcessLiveness, hostname, locksDir, powerMonitor (testability).
 * Singleton instance exported at the bottom.
 *
 * @see IProjectLockService for interface definition
 * @see Spec #010 - Multi-instance support specification
 * @see Issue #27 - Multiple independent instances
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, mkdir, lstat, open } from 'node:fs/promises'
import { join, normalize, sep, isAbsolute } from 'node:path'
import { realpath } from 'node:fs/promises'
import { app, powerMonitor } from 'electron'
import { hostname } from 'node:os'

import { AppError, ErrorCode } from '../../shared/errors'

import { broadcastToAllWindows } from '../utils/ipcBroadcast'
import { systemClock, type Clock } from '../utils/Clock'
import { systemProcessLiveness, type ProcessLiveness } from '../utils/ProcessLiveness'
import { createLockStalenessPolicy, type LockStalenessPolicy } from './LockStalenessPolicy'
import { createLockHeartbeat, type LockHeartbeatService, type LockHeartbeatHandle } from './LockHeartbeat'
import type { PowerMonitorLike } from '../utils/PowerMonitorLike'

import type { IProjectLockService } from '../interfaces/IProjectLockService'
import type { LockInfo, LockResult, LockStatus } from '../../shared/ipc/project-lock-schema'
import { LockInfoSchema } from '../../shared/ipc/project-lock-schema'
import { atomicWriteJSON, removeIfExists } from '../utils/atomicWrite'
import { focusWindow, getMainWindow } from '../utils/focusWindow'
import { logger } from './LoggingService'
import { redactPath } from '../utils/redactUserInput'
import { signLock, verifyLock } from '../utils/lockHmac'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Length of truncated SHA-256 hash (128 bits = 32 hex chars) */
const LOCK_HASH_LENGTH = 32

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
  /** Handle returned by LockHeartbeat.start() — used to stop polling on release */
  heartbeatHandle: LockHeartbeatHandle
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency injection
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectLockServiceDeps {
  clock?: Clock
  liveness?: ProcessLiveness
  hostname?: string
  locksDir?: string
  powerMonitor?: PowerMonitorLike
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

  /** Cache the most recent raw content + parsed lock per lockPath, to skip re-parsing on unchanged ticks */
  private readonly lockReadCache = new Map<string, { raw: string; parsed: LockInfo }>()

  /** Flag to prevent operations during disposal */
  private isDisposing = false

  /** Current hostname (cached for performance) */
  private readonly currentHostname: string

  /** Clock abstraction for testability */
  private readonly clock: Clock

  /** Process liveness abstraction for testability */
  private readonly liveness: ProcessLiveness

  /** Staleness policy (same-host PID+heartbeat, cross-host timestamp) */
  private readonly stalenessPolicy: LockStalenessPolicy

  /** Heartbeat service — owns polling timer, heartbeat writes, and powerMonitor integration */
  private readonly lockHeartbeat: LockHeartbeatService

  constructor(deps: ProjectLockServiceDeps = {}) {
    this.clock = deps.clock ?? systemClock
    this.liveness = deps.liveness ?? systemProcessLiveness
    this.currentHostname = deps.hostname ?? hostname()
    this.locksDir = deps.locksDir ?? join(app.getPath('userData'), 'locks')
    this.stalenessPolicy = createLockStalenessPolicy({
      clock: this.clock,
      liveness: this.liveness,
      currentHostname: this.currentHostname
    })
    this.lockHeartbeat = createLockHeartbeat({
      clock: this.clock,
      powerMonitor: deps.powerMonitor ?? powerMonitor,
      readLockFile: (lockPath) => this.readLockFile(lockPath),
      onOwnershipLost: (projectPath) => {
        this.activeLocks.delete(projectPath)
      },
      onFocusRequest: async (lockInfo, projectPath) => {
        const mainWindow = getMainWindow()
        if (mainWindow) {
          const focused = await focusWindow(mainWindow)
          logger.debug('ProjectLockService: Window focus result', { focused })
          broadcastToAllWindows('project-lock:focused', {
            projectPath,
            requesterPid: lockInfo.requester_pid ?? 0
          })
        }
      }
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Acquires a lock for the specified project path.
   * Creates lock file in ~/.erfana/locks/{hash}.lock
   *
   * Uses atomic exclusive create (O_EXCL) to prevent TOCTOU race conditions.
   *
   * @param projectPath - Absolute path to the project directory
   * @returns LockResult indicating success, already locked, or error
   */
  async acquireLock(projectPath: string): Promise<LockResult> {
    const startTime = this.clock.now()

    if (this.isDisposing) {
      return { status: 'error', message: 'Service is disposing' }
    }

    let hash: string
    let lockPath: string

    try {
      hash = await this.computeLockHash(projectPath)
      lockPath = this.getLockPath(hash)

      // Check if we already hold this lock
      if (this.activeLocks.has(projectPath)) {
        logger.debug('ProjectLockService: Lock already held by this instance', {
          projectPath: redactPath(projectPath)
        })
        return { status: 'acquired', lockPath }
      }

      // Ensure locks directory exists
      await mkdir(this.locksDir, { recursive: true, mode: 0o700 })

      // Create new lock info
      const now = this.clock.nowIso()
      const lockInfo: LockInfo = {
        instanceId: this.instanceId,
        pid: process.pid,
        timestamp: now,
        hostname: this.currentHostname,
        path: projectPath,
        focus_request: false,
        lastHeartbeat: now
      }

      try {
        // Attempt exclusive create (atomic, fails if exists)
        const signedLock: LockInfo = { ...lockInfo, hmac: signLock(lockInfo) }
        const fileHandle = await open(lockPath, 'wx', 0o600)
        try {
          await fileHandle.writeFile(JSON.stringify(signedLock, null, 2))
        } finally {
          await fileHandle.close()
        }

        // Success - we created the lock
        const heartbeatHandle = this.lockHeartbeat.start({
          projectPath,
          lockPath,
          lockHash: hash,
          instanceId: this.instanceId
        })
        this.activeLocks.set(projectPath, { hash, heartbeatHandle })

        const result: LockResult = { status: 'acquired', lockPath }
        logger.info('ProjectLockService: Lock acquired', {
          projectPath: redactPath(projectPath),
          lockHash: hash
        })
        logger.debug('Lock operation completed', {
          operation: 'acquire',
          projectPath: redactPath(projectPath),
          status: result.status,
          latencyMs: this.clock.now() - startTime
        })
        return result
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          // Lock exists - read and check if stale
          const existingLock = await this.readLockFile(lockPath)

          if (!existingLock) {
            // Lock file is corrupt/invalid or disappeared - remove and retry
            logger.info('ProjectLockService: Removing corrupt/invalid lock file', {
              projectPath: redactPath(projectPath),
              lockHash: hash
            })
            await removeIfExists(lockPath)
            return this.acquireLockRetry(projectPath, lockInfo, hash, lockPath, startTime)
          }

          // Check if the lock is stale
          const stale = this.stalenessPolicy.isStale(existingLock)

          if (stale) {
            logger.info('ProjectLockService: Removing stale lock', {
              projectPath: redactPath(projectPath),
              lockHash: hash,
              holderPid: existingLock.pid,
              holderHostname: existingLock.hostname,
              holderInstanceId: existingLock.instanceId
            })
            await removeIfExists(lockPath)

            // Retry with exclusive create
            return this.acquireLockRetry(projectPath, lockInfo, hash, lockPath, startTime)
          }

          // Lock is held by another active instance
          logger.info('ProjectLockService: Project already locked', {
            projectPath: redactPath(projectPath),
            lockHash: hash,
            holderPid: existingLock.pid,
            holderHostname: existingLock.hostname
          })
          const result: LockResult = {
            status: 'already_locked',
            holderPid: existingLock.pid,
            holderHostname: existingLock.hostname
          }
          logger.debug('Lock operation completed', {
            operation: 'acquire',
            projectPath: redactPath(projectPath),
            status: result.status,
            latencyMs: this.clock.now() - startTime
          })
          return result
        }
        throw error
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        'ProjectLockService: Failed to acquire lock',
        error instanceof Error ? error : new Error(message),
        { projectPath: redactPath(projectPath) }
      )
      logger.debug('Lock operation completed', {
        operation: 'acquire',
        projectPath: redactPath(projectPath),
        status: 'error',
        latencyMs: this.clock.now() - startTime
      })
      return { status: 'error', message }
    }
  }

  /**
   * Retry acquiring lock after stale lock removal.
   * Helper for acquireLock to avoid code duplication.
   */
  private async acquireLockRetry(
    projectPath: string,
    lockInfo: LockInfo,
    hash: string,
    lockPath: string,
    startTime: number
  ): Promise<LockResult> {
    try {
      // Security: refuse to write through a symlink (CVE-2025-68146 class).
      // Between removeIfExists and open('wx'), an attacker on the same user account
      // could plant a symlink at lockPath pointing to an arbitrary file.  Node's
      // O_EXCL on Windows resolves symlinks before the exclusivity check, so the
      // target would be truncated and overwritten.  lstat (not stat) sees the link
      // itself, so it detects the plant before we touch anything.
      // ENOENT is the expected case after removeIfExists cleared the slot. Any
      // other lstat error (EACCES, EIO) is unexpected and surfaces to the outer
      // catch so the user sees it instead of us silently proceeding to open().
      const preExisting = await lstat(lockPath).catch((err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
      })
      if (preExisting && preExisting.isSymbolicLink()) {
        logger.warn('ProjectLockService: Refusing to write through a symlink at lock path', {
          lockPath: redactPath(lockPath),
          lockHash: hash
        })
        return { status: 'error', message: 'lock path is a symlink' }
      }

      const now = this.clock.nowIso()
      const freshLockInfo: LockInfo = { ...lockInfo, timestamp: now, lastHeartbeat: now }
      const signedFreshLock: LockInfo = { ...freshLockInfo, hmac: signLock(freshLockInfo) }
      const fileHandle = await open(lockPath, 'wx', 0o600)
      try {
        await fileHandle.writeFile(JSON.stringify(signedFreshLock, null, 2))
      } finally {
        await fileHandle.close()
      }

      const heartbeatHandle = this.lockHeartbeat.start({
        projectPath,
        lockPath,
        lockHash: hash,
        instanceId: this.instanceId
      })
      this.activeLocks.set(projectPath, { hash, heartbeatHandle })

      const result: LockResult = { status: 'acquired', lockPath }
      logger.info('ProjectLockService: Lock acquired after retry', {
        projectPath: redactPath(projectPath),
        lockHash: hash
      })
      logger.debug('Lock operation completed', {
        operation: 'acquire',
        projectPath: redactPath(projectPath),
        status: result.status,
        latencyMs: this.clock.now() - startTime
      })
      return result
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') {
        // Another instance grabbed the lock - check who
        const existingLock = await this.readLockFile(lockPath)
        if (existingLock) {
          const result: LockResult = {
            status: 'already_locked',
            holderPid: existingLock.pid,
            holderHostname: existingLock.hostname
          }
          logger.debug('Lock operation completed', {
            operation: 'acquire',
            projectPath: redactPath(projectPath),
            status: result.status,
            latencyMs: this.clock.now() - startTime
          })
          return result
        }
      }

      // EPERM on retry typically means an orphan process still holds a file handle
      // on the lock file (the original Windows bug scenario). Treat as "already locked"
      // so the user sees the correct "project already open" UX rather than a fault dialog.
      if ((retryError as NodeJS.ErrnoException).code === 'EPERM') {
        const existingLock = await this.readLockFile(lockPath)
        if (existingLock) {
          const result: LockResult = {
            status: 'already_locked',
            holderPid: existingLock.pid,
            holderHostname: existingLock.hostname
          }
          logger.info('ProjectLockService: EPERM on retry — treating as already_locked', {
            projectPath: redactPath(projectPath),
            lockHash: hash,
            holderPid: existingLock.pid
          })
          return result
        }
        // Lock file unreadable: fall through to the existing throw
      }

      throw retryError
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
    const startTime = this.clock.now()
    const activeLock = this.activeLocks.get(projectPath)

    if (!activeLock) {
      // Not tracking this lock - may be held by another instance
      logger.debug('ProjectLockService: No active lock to release', {
        projectPath: redactPath(projectPath)
      })
      return
    }

    // Stop focus polling
    activeLock.heartbeatHandle.stop()

    // Remove lock file
    const lockPath = this.getLockPath(activeLock.hash)
    try {
      const removed = await removeIfExists(lockPath)
      if (removed) {
        logger.info('ProjectLockService: Lock released', {
          projectPath: redactPath(projectPath),
          lockHash: activeLock.hash
        })
      }
    } catch (error) {
      // Log but don't throw - release should be best-effort
      logger.warn('ProjectLockService: Error removing lock file', {
        projectPath: redactPath(projectPath),
        lockHash: activeLock.hash,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // Invalidate cache for this lock path
    this.lockReadCache.delete(lockPath)

    // Remove from tracking
    this.activeLocks.delete(projectPath)

    logger.debug('Lock operation completed', {
      operation: 'release',
      projectPath: redactPath(projectPath),
      status: 'success',
      latencyMs: this.clock.now() - startTime
    })
  }

  /**
   * Checks if a project is locked and by whom.
   *
   * @param projectPath - Absolute path to the project directory
   * @returns LockStatus indicating unlocked, locked_by_self, locked_by_other, or error
   */
  async checkLock(projectPath: string): Promise<LockStatus> {
    const startTime = this.clock.now()

    if (this.isDisposing) {
      return { status: 'error', message: 'Service is disposing' }
    }

    try {
      const hash = await this.computeLockHash(projectPath)
      const lockPath = this.getLockPath(hash)

      const lockInfo = await this.readLockFile(lockPath)

      if (!lockInfo) {
        const result: LockStatus = { status: 'unlocked' }
        logger.debug('Lock operation completed', {
          operation: 'check',
          projectPath: redactPath(projectPath),
          status: result.status,
          latencyMs: this.clock.now() - startTime
        })
        return result
      }

      // Check if we hold this lock
      if (lockInfo.instanceId === this.instanceId) {
        const result: LockStatus = { status: 'locked_by_self', lockPath }
        logger.debug('Lock operation completed', {
          operation: 'check',
          projectPath: redactPath(projectPath),
          status: result.status,
          latencyMs: this.clock.now() - startTime
        })
        return result
      }

      // Check if lock is stale
      const stale = this.stalenessPolicy.isStale(lockInfo)

      if (stale) {
        const result: LockStatus = { status: 'unlocked' }
        logger.debug('Lock operation completed', {
          operation: 'check',
          projectPath: redactPath(projectPath),
          status: result.status,
          latencyMs: this.clock.now() - startTime
        })
        return result
      }

      const result: LockStatus = {
        status: 'locked_by_other',
        holderPid: lockInfo.pid,
        holderHostname: lockInfo.hostname
      }
      logger.debug('Lock operation completed', {
        operation: 'check',
        projectPath: redactPath(projectPath),
        status: result.status,
        latencyMs: this.clock.now() - startTime
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        'ProjectLockService: Failed to check lock',
        error instanceof Error ? error : new Error(message),
        { projectPath: redactPath(projectPath) }
      )
      logger.debug('Lock operation completed', {
        operation: 'check',
        projectPath: redactPath(projectPath),
        status: 'error',
        latencyMs: this.clock.now() - startTime
      })
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
    if (this.isDisposing) {
      return 0
    }

    // Security: refuse to operate if the locks directory is a symlink/junction.
    // On Windows, mode: 0o700 is a no-op; a peer process could pre-create the
    // locks directory as a junction redirecting all writes elsewhere. We detect
    // this at startup so we never write into a redirected location.
    const dirStat = await lstat(this.locksDir).catch((err) => {
      // ENOENT is fine — mkdir will create it below. Other errors propagate.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    })
    if (dirStat?.isSymbolicLink()) {
      logger.error(
        'ProjectLockService: Locks directory is a symlink; refusing to operate',
        new Error('locks directory is a symlink'),
        { locksDir: redactPath(this.locksDir) }
      )
      return 0
    }

    let cleanedCount = 0

    try {
      // Ensure locks directory exists
      await mkdir(this.locksDir, { recursive: true, mode: 0o700 })

      const entries = await readdir(this.locksDir)

      for (const entry of entries) {
        // Detect orphaned .tmp files left by atomicWriteJSON (written as .{uuid}.tmp then
        // renamed to the target; a kill between those two steps leaves the .tmp behind).
        const isOrphanTmp = entry.startsWith('.') && entry.endsWith('.tmp')

        if (!entry.endsWith(LOCK_EXTENSION) && !isOrphanTmp) {
          continue
        }

        const fullPath = join(this.locksDir, entry)

        if (isOrphanTmp) {
          try {
            const removed = await removeIfExists(fullPath)
            if (removed) {
              logger.debug('ProjectLockService: Cleaned up orphan atomic-write tmp file', {
                lockHash: entry
              })
            }
          } catch (error) {
            logger.warn('ProjectLockService: Error removing orphan tmp file', {
              error: error instanceof Error ? error.message : String(error)
            })
          }
          continue
        }

        const lockPath = fullPath

        try {
          // Security: Skip symlinks to prevent file deletion outside locks directory
          const stats = await lstat(lockPath)
          // Derive lockHash from filename stem (e.g. "abc123.lock" → "abc123")
          const lockHash = entry.slice(0, -LOCK_EXTENSION.length)

          if (stats.isSymbolicLink()) {
            logger.warn('ProjectLockService: Skipping symlink lock file', { lockHash })
            continue
          }

          const lockInfo = await this.readLockFile(lockPath)

          if (!lockInfo) {
            continue
          }

          const stale = this.stalenessPolicy.isStale(lockInfo)

          if (stale) {
            const removed = await removeIfExists(lockPath)
            if (removed) {
              cleanedCount++
              logger.info('ProjectLockService: Cleaned up stale lock', {
                lockHash,
                holderPid: lockInfo.pid,
                holderHostname: lockInfo.hostname,
                projectPath: redactPath(lockInfo.path)
              })
            }
          }
        } catch (error) {
          // Log individual lock cleanup errors but continue with others
          // Derive lockHash from filename stem for correlation (no lockHash in scope for error)
          const lockHash = entry.slice(0, -LOCK_EXTENSION.length)
          logger.warn('ProjectLockService: Error checking lock file', {
            lockHash,
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
    if (this.isDisposing) {
      return false
    }

    try {
      const hash = await this.computeLockHash(projectPath)
      const lockPath = this.getLockPath(hash)

      const lockInfo = await this.readLockFile(lockPath)

      if (!lockInfo) {
        logger.debug('ProjectLockService: No lock file to request focus', {
          projectPath: redactPath(projectPath),
          lockHash: hash
        })
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
      const signedUpdatedLock: LockInfo = { ...updatedLock, hmac: signLock(updatedLock) }

      await atomicWriteJSON(lockPath, signedUpdatedLock)

      logger.info('ProjectLockService: Focus request sent', {
        projectPath: redactPath(projectPath),
        lockHash: hash,
        holderPid: lockInfo.pid,
        holderHostname: lockInfo.hostname
      })

      return true
    } catch (error) {
      logger.warn('ProjectLockService: Failed to request focus', {
        projectPath: redactPath(projectPath),
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
   * @throws AppError if path is invalid or not absolute
   */
  async computeLockHash(projectPath: string): Promise<string> {
    // Validate input is non-empty absolute path
    if (!projectPath || typeof projectPath !== 'string') {
      throw new AppError('Invalid path for lock hash: path is required', ErrorCode.PATH_INVALID)
    }
    if (!isAbsolute(projectPath)) {
      throw new AppError('Invalid path for lock hash: must be absolute path', ErrorCode.PATH_INVALID)
    }

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
   *
   * Stops all timers first (guaranteed cleanup), then attempts lock releases (best-effort).
   */
  async dispose(): Promise<void> {
    this.isDisposing = true

    logger.info('ProjectLockService: Disposing', { activeLocksCount: this.activeLocks.size })

    // Stop all timers first (guaranteed cleanup)
    await this.lockHeartbeat.disposeAll()

    // Then attempt lock releases (best-effort)
    const releasePromises = Array.from(this.activeLocks.keys()).map((projectPath) =>
      this.releaseLock(projectPath).catch((e) => {
        logger.warn('Disposal release failed', {
          projectPath: redactPath(projectPath),
          error: e instanceof Error ? e.message : String(e)
        })
      })
    )

    await Promise.all(releasePromises)

    this.lockReadCache.clear()

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

      // Cache hit: same path, same raw bytes -> reuse parsed object
      const cached = this.lockReadCache.get(lockPath)
      if (cached && cached.raw === content) {
        return cached.parsed
      }

      const parsed = JSON.parse(content)
      const validated = LockInfoSchema.parse(parsed)

      const verifyResult = verifyLock(validated)
      if (verifyResult === 'invalid') {
        logger.warn('ProjectLockService: Lock failed HMAC verification — treating as absent', {
          lockPath: redactPath(lockPath),
          holderPid: validated.pid,
          holderHostname: validated.hostname,
          holderInstanceId: validated.instanceId
        })
        return null
      }
      // 'valid', 'missing' (legacy lock), or 'no-key' (safeStorage unavailable) — accept all
      this.lockReadCache.set(lockPath, { raw: content, parsed: validated })
      return validated
    } catch (error) {
      // ENOENT is expected if lock doesn't exist — also drop cache
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.lockReadCache.delete(lockPath)
        return null
      }

      // Log other errors (corrupt file, invalid schema, etc.)
      logger.debug('ProjectLockService: Error reading lock file', {
        lockPath: redactPath(lockPath),
        error: error instanceof Error ? error.message : String(error)
      })

      return null
    }
  }

}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton instance */
export const projectLockService = new ProjectLockService()

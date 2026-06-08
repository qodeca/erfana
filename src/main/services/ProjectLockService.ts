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

import type { IProjectLockService } from '../interfaces/IProjectLockService'
import type { LockInfo, LockResult, LockStatus } from '../../shared/ipc/project-lock-schema'
import { LockInfoSchema } from '../../shared/ipc/project-lock-schema'
import { atomicWriteJSON, removeIfExists } from '../utils/atomicWrite'
import { focusWindow, getMainWindow } from '../utils/focusWindow'
import { logger } from './LoggingService'
import { redactPath } from '../utils/redactUserInput'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Length of truncated SHA-256 hash (128 bits = 32 hex chars) */
const LOCK_HASH_LENGTH = 32

/** Focus request polling interval (ms) */
const POLL_INTERVAL_MS = 500

/** Stale lock timeout for cross-host detection (60 minutes) */
const STALE_TIMEOUT_MS = 60 * 60 * 1000

/** Clock skew buffer for cross-host timestamp comparison (15 minutes - robust for VMs and cloud) */
const CLOCK_SKEW_BUFFER_MS = 15 * 60 * 1000

/** Heartbeat write interval (ms) — holder rewrites lock with fresh heartbeat at this cadence */
const HEARTBEAT_INTERVAL_MS = 5000

/** Same-host stale threshold (ms) — if heartbeat is older than this, lock is considered zombie */
const HEARTBEAT_STALE_MS = 30000

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
  /** Epoch ms of the last successful heartbeat write (or lock creation) */
  lastHeartbeatAt: number
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

  /** True while the system is suspended (lid closed, sleep, etc.) */
  private isSuspended = false

  /** Guard so powerMonitor listeners are registered exactly once */
  private powerMonitorInitialized = false

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
   * Uses atomic exclusive create (O_EXCL) to prevent TOCTOU race conditions.
   *
   * @param projectPath - Absolute path to the project directory
   * @returns LockResult indicating success, already locked, or error
   */
  async acquireLock(projectPath: string): Promise<LockResult> {
    this.initPowerMonitor()
    const startTime = Date.now()

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
      const now = new Date().toISOString()
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
        const handle = await open(lockPath, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify(lockInfo, null, 2))
        } finally {
          await handle.close()
        }

        // Success - we created the lock
        const pollTimer = this.startFocusPolling(projectPath, hash)
        this.activeLocks.set(projectPath, { hash, pollTimer, lastHeartbeatAt: Date.now() })

        const result: LockResult = { status: 'acquired', lockPath }
        logger.info('ProjectLockService: Lock acquired', {
          projectPath: redactPath(projectPath),
          lockHash: hash
        })
        logger.debug('Lock operation completed', {
          operation: 'acquire',
          projectPath: redactPath(projectPath),
          status: result.status,
          latencyMs: Date.now() - startTime
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
          const stale = await this.isLockStale(existingLock)

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
            latencyMs: Date.now() - startTime
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
        latencyMs: Date.now() - startTime
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

      const now = new Date().toISOString()
      const freshLockInfo: LockInfo = { ...lockInfo, timestamp: now, lastHeartbeat: now }
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(freshLockInfo, null, 2))
      } finally {
        await handle.close()
      }

      const pollTimer = this.startFocusPolling(projectPath, hash)
      this.activeLocks.set(projectPath, { hash, pollTimer, lastHeartbeatAt: Date.now() })

      const result: LockResult = { status: 'acquired', lockPath }
      logger.info('ProjectLockService: Lock acquired after retry', {
        projectPath: redactPath(projectPath),
        lockHash: hash
      })
      logger.debug('Lock operation completed', {
        operation: 'acquire',
        projectPath: redactPath(projectPath),
        status: result.status,
        latencyMs: Date.now() - startTime
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
            latencyMs: Date.now() - startTime
          })
          return result
        }
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
    const startTime = Date.now()
    const activeLock = this.activeLocks.get(projectPath)

    if (!activeLock) {
      // Not tracking this lock - may be held by another instance
      logger.debug('ProjectLockService: No active lock to release', {
        projectPath: redactPath(projectPath)
      })
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
      latencyMs: Date.now() - startTime
    })
  }

  /**
   * Checks if a project is locked and by whom.
   *
   * @param projectPath - Absolute path to the project directory
   * @returns LockStatus indicating unlocked, locked_by_self, locked_by_other, or error
   */
  async checkLock(projectPath: string): Promise<LockStatus> {
    const startTime = Date.now()

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
          latencyMs: Date.now() - startTime
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
          latencyMs: Date.now() - startTime
        })
        return result
      }

      // Check if lock is stale
      const stale = await this.isLockStale(lockInfo)

      if (stale) {
        const result: LockStatus = { status: 'unlocked' }
        logger.debug('Lock operation completed', {
          operation: 'check',
          projectPath: redactPath(projectPath),
          status: result.status,
          latencyMs: Date.now() - startTime
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
        latencyMs: Date.now() - startTime
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
        latencyMs: Date.now() - startTime
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
        if (!entry.endsWith(LOCK_EXTENSION)) {
          continue
        }

        const lockPath = join(this.locksDir, entry)

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

          const stale = await this.isLockStale(lockInfo)

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

      await atomicWriteJSON(lockPath, updatedLock)

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
    for (const lock of this.activeLocks.values()) {
      if (lock.pollTimer) {
        clearInterval(lock.pollTimer)
        lock.pollTimer = null
      }
    }

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
   * Registers powerMonitor listeners exactly once (idempotent).
   * Called from acquireLock rather than the constructor so that the
   * Electron mock is fully initialized before subscription.
   */
  private initPowerMonitor(): void {
    if (this.powerMonitorInitialized) return
    this.powerMonitorInitialized = true

    powerMonitor.on('suspend', () => {
      this.isSuspended = true
    })
    powerMonitor.on('lock-screen', () => {
      this.isSuspended = true
    })
    powerMonitor.on('resume', () => {
      void this.handleResume()
    })
    powerMonitor.on('unlock-screen', () => {
      void this.handleResume()
    })
  }

  /**
   * Called when the system wakes from suspend or unlocks the screen.
   * Immediately refreshes every active lock heartbeat so a sibling
   * Erfana instance cannot observe staleness and steal the lock.
   */
  private async handleResume(): Promise<void> {
    this.isSuspended = false
    if (this.isDisposing) return

    for (const [projectPath, active] of this.activeLocks.entries()) {
      const lockPath = this.getLockPath(active.hash)
      const lockInfo = await this.readLockFile(lockPath)
      if (!lockInfo || lockInfo.instanceId !== this.instanceId) continue
      const ok = await this.writeHeartbeat(lockInfo, lockPath, projectPath)
      if (ok) active.lastHeartbeatAt = Date.now()
    }
  }

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
    // Same hostname: PID liveness + heartbeat freshness
    if (lockInfo.hostname === this.currentHostname) {
      const alive = this.isProcessAlive(lockInfo.pid)
      if (!alive) {
        logger.debug('ProjectLockService: Lock holder process is dead', {
          pid: lockInfo.pid,
          hostname: lockInfo.hostname,
          projectPath: redactPath(lockInfo.path)
        })
        return true
      }

      // PID alive → also require fresh heartbeat. Fall back to `timestamp` for legacy locks.
      const heartbeatStr = lockInfo.lastHeartbeat ?? lockInfo.timestamp
      const heartbeatAge = Date.now() - new Date(heartbeatStr).getTime()
      if (Number.isNaN(heartbeatAge)) {
        logger.warn(
          'ProjectLockService: Lock has unparseable heartbeat/timestamp – treating as stale',
          {
            projectPath: redactPath(lockInfo.path),
            holderPid: lockInfo.pid,
            heartbeatStr
          }
        )
        return true
      }
      if (heartbeatAge > HEARTBEAT_STALE_MS) {
        logger.warn('ProjectLockService: Same-host lock heartbeat expired (zombie holder)', {
          projectPath: redactPath(lockInfo.path),
          holderPid: lockInfo.pid,
          holderHostname: lockInfo.hostname,
          holderInstanceId: lockInfo.instanceId,
          heartbeatAgeMs: heartbeatAge,
          thresholdMs: HEARTBEAT_STALE_MS
        })
        return true
      }
      return false
    }

    // Different hostname: check timestamp with clock skew buffer (existing behavior)
    const lockTime = new Date(lockInfo.timestamp).getTime()
    const now = Date.now()
    const age = now - lockTime
    if (Number.isNaN(age)) {
      logger.warn(
        'ProjectLockService: Cross-host lock has unparseable timestamp – treating as stale',
        {
          holderHostname: lockInfo.hostname,
          timestamp: lockInfo.timestamp
        }
      )
      return true
    }
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

      // Unknown errno (Windows can surface ENOMEM, EACCES under load, etc.).
      // Fail-closed: assume alive. The heartbeat-stale path still cleans up
      // genuinely dead holders within HEARTBEAT_STALE_MS.
      logger.debug('ProjectLockService: isProcessAlive unknown errno; assuming alive', {
        pid,
        errno
      })
      return true
    }
  }

  /**
   * Starts focus request polling for a locked project.
   *
   * Polls the lock file every POLL_INTERVAL_MS to check for focus_request.
   * When a focus request is detected, focuses the main window and clears
   * the request.
   *
   * Also validates lock ownership on each poll - stops polling if lock was
   * deleted or stolen by another instance.
   *
   * @param projectPath - The project path being locked
   * @param hash - The lock hash
   * @returns The interval timer (for cleanup)
   */
  private startFocusPolling(projectPath: string, hash: string): NodeJS.Timeout {
    const lockPath = this.getLockPath(hash)
    let ticking = false

    const timer = setInterval(async () => {
      if (this.isDisposing) {
        return
      }

      if (this.isSuspended) {
        return
      }

      if (ticking) {
        return
      }
      ticking = true

      try {
        const lockInfo = await this.readLockFile(lockPath)

        if (!lockInfo) {
          // Lock was deleted - stop polling
          logger.warn('Lock file deleted, stopping polling', {
            projectPath: redactPath(projectPath),
            lockHash: hash
          })
          clearInterval(timer)
          this.activeLocks.delete(projectPath)
          return
        }

        if (lockInfo.instanceId !== this.instanceId) {
          // Lock stolen by another instance - stop polling
          logger.warn('Lock ownership lost', {
            projectPath: redactPath(projectPath),
            lockHash: hash,
            currentInstance: this.instanceId,
            lockInstance: lockInfo.instanceId
          })
          clearInterval(timer)
          this.activeLocks.delete(projectPath)
          return
        }

        if (lockInfo.focus_request) {
          if (this.isDisposing) return
          const ok = await this.handleFocusRequest(lockInfo, lockPath, projectPath)
          if (ok) {
            const active = this.activeLocks.get(projectPath)
            if (active) active.lastHeartbeatAt = Date.now()
          }
          return
        }

        const active = this.activeLocks.get(projectPath)
        if (active && Date.now() - active.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
          if (this.isDisposing) return
          const ok = await this.writeHeartbeat(lockInfo, lockPath, projectPath)
          if (ok) active.lastHeartbeatAt = Date.now()
        }
      } catch (err) {
        logger.debug('ProjectLockService: Polling tick error', {
          projectPath: redactPath(projectPath),
          error: err instanceof Error ? err.message : String(err),
          errno: (err as NodeJS.ErrnoException).code
        })
      } finally {
        ticking = false
      }
    }, POLL_INTERVAL_MS)

    return timer
  }

  /**
   * Writes a fresh heartbeat timestamp to the lock file.
   *
   * Called from the focus-polling timer when HEARTBEAT_INTERVAL_MS has elapsed
   * since the last heartbeat write. On failure, warns and lets the next tick retry.
   *
   * @param lockInfo - Current lock information (read this tick)
   * @param lockPath - Path to the lock file
   * @param projectPath - The project path (for logging)
   */
  private async writeHeartbeat(
    lockInfo: LockInfo,
    lockPath: string,
    projectPath: string
  ): Promise<boolean> {
    const updated: LockInfo = { ...lockInfo, lastHeartbeat: new Date().toISOString() }
    try {
      await atomicWriteJSON(lockPath, updated)
      return true
    } catch (error) {
      const age = Date.now() - new Date(lockInfo.lastHeartbeat ?? lockInfo.timestamp).getTime()
      logger.warn('ProjectLockService: Heartbeat write failed', {
        projectPath: redactPath(projectPath),
        heartbeatAgeMs: Number.isNaN(age) ? null : age,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
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
  ): Promise<boolean> {
    logger.info('ProjectLockService: Handling focus request', {
      projectPath: redactPath(projectPath),
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

    // Clear the focus request and refresh the heartbeat in the same atomic write
    const updatedLock: LockInfo = {
      ...lockInfo,
      focus_request: false,
      requester_pid: undefined,
      lastHeartbeat: new Date().toISOString()
    }

    try {
      await atomicWriteJSON(lockPath, updatedLock)
      return true
    } catch (error) {
      logger.warn('ProjectLockService: Failed to clear focus request', {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton instance */
export const projectLockService = new ProjectLockService()

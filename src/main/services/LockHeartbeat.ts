// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LockHeartbeat — polling timer, heartbeat write, and powerMonitor integration
 * for ProjectLockService file-based locks.
 *
 * Extracted from ProjectLockService (D2b) so the polling/heartbeat machinery
 * lives in a single self-contained file, injected via LockHeartbeatService.
 */

import type { Clock } from '../utils/Clock'
import type { PowerMonitorLike } from '../utils/PowerMonitorLike'
import type { LockInfo } from '../../shared/ipc/project-lock-schema'
import { atomicWriteJSON } from '../utils/atomicWrite'
import { logger } from './LoggingService'
import { redactPath } from '../utils/redactUserInput'
import { signLock } from '../utils/lockHmac'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Heartbeat write interval (ms) — holder rewrites lock with fresh heartbeat at this cadence */
export const HEARTBEAT_INTERVAL_MS = 5_000

/** Focus request polling interval (ms) */
export const POLL_INTERVAL_MS = 500

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface LockHeartbeatHandle {
  /** Stop polling and release resources for this lock */
  stop(): void
  /** Current epoch ms of the last successful heartbeat write (test introspection only) */
  lastHeartbeatAt(): number
}

export interface LockHeartbeatStartArgs {
  projectPath: string
  lockPath: string
  lockHash: string
  instanceId: string
}

export interface LockHeartbeatDeps {
  clock: Clock
  powerMonitor: PowerMonitorLike
  /** Read the current lock file. Used by the polling tick to detect ownership loss + focus requests. */
  readLockFile: (lockPath: string) => Promise<LockInfo | null>
  /** Called when the polling tick notices the lock was deleted or stolen */
  onOwnershipLost: (projectPath: string) => void
  /**
   * Optional hook called when a focus_request is detected on the lock file, before the flag
   * is cleared. ProjectLockService injects window focus + IPC broadcast here so that
   * LockHeartbeat stays free of Electron UI dependencies.
   */
  onFocusRequest?: (lockInfo: LockInfo, projectPath: string) => Promise<void>
}

export interface LockHeartbeatService {
  /** Start polling + heartbeat for a newly-acquired lock */
  start(args: LockHeartbeatStartArgs): LockHeartbeatHandle
  /** Refresh every active heartbeat immediately (called on powerMonitor resume) */
  refreshAll(): Promise<void>
  /** Stop everything (called from ProjectLockService.dispose) */
  disposeAll(): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveHeartbeat {
  args: LockHeartbeatStartArgs
  pollTimer: NodeJS.Timeout
  lastHeartbeatAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createLockHeartbeat(deps: LockHeartbeatDeps): LockHeartbeatService {
  const active = new Map<string, ActiveHeartbeat>()
  let isSuspended = false
  let isDisposing = false

  deps.powerMonitor.on('suspend', () => {
    isSuspended = true
  })
  deps.powerMonitor.on('lock-screen', () => {
    isSuspended = true
  })
  deps.powerMonitor.on('resume', () => {
    void refreshAll()
  })
  deps.powerMonitor.on('unlock-screen', () => {
    void refreshAll()
  })

  async function writeHeartbeat(
    lockInfo: LockInfo,
    lockPath: string,
    projectPath: string
  ): Promise<boolean> {
    const updated: LockInfo = { ...lockInfo, lastHeartbeat: deps.clock.nowIso() }
    const signed: LockInfo = { ...updated, hmac: signLock(updated) }
    try {
      await atomicWriteJSON(lockPath, signed)
      return true
    } catch (error) {
      const age =
        deps.clock.now() - new Date(lockInfo.lastHeartbeat ?? lockInfo.timestamp).getTime()
      logger.warn('LockHeartbeat: Heartbeat write failed', {
        projectPath: redactPath(projectPath),
        heartbeatAgeMs: Number.isNaN(age) ? null : age,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  async function handleFocusRequest(
    lockInfo: LockInfo,
    lockPath: string,
    projectPath: string,
    lockHash: string
  ): Promise<boolean> {
    logger.info('LockHeartbeat: Handling focus request', {
      projectPath: redactPath(projectPath),
      lockHash,
      requesterPid: lockInfo.requester_pid
    })

    // Delegate window focus + IPC broadcast to the injected hook (ProjectLockService).
    // LockHeartbeat itself has no dependency on Electron UI APIs.
    if (deps.onFocusRequest) {
      await deps.onFocusRequest(lockInfo, projectPath)
    }

    const cleared: LockInfo = {
      ...lockInfo,
      focus_request: false,
      requester_pid: undefined,
      lastHeartbeat: deps.clock.nowIso()
    }
    const signedCleared: LockInfo = { ...cleared, hmac: signLock(cleared) }
    try {
      await atomicWriteJSON(lockPath, signedCleared)
      return true
    } catch (error) {
      logger.warn('LockHeartbeat: Failed to clear focus request', {
        projectPath: redactPath(projectPath),
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  function start(args: LockHeartbeatStartArgs): LockHeartbeatHandle {
    let ticking = false

    const timer = setInterval(async () => {
      if (isDisposing) return
      if (isSuspended) return
      if (ticking) return
      ticking = true
      try {
        const lockInfo = await deps.readLockFile(args.lockPath)
        if (!lockInfo) {
          logger.warn('LockHeartbeat: Lock file deleted, stopping polling', {
            projectPath: redactPath(args.projectPath),
            lockHash: args.lockHash
          })
          clearInterval(timer)
          active.delete(args.projectPath)
          deps.onOwnershipLost(args.projectPath)
          return
        }
        if (lockInfo.instanceId !== args.instanceId) {
          logger.warn('LockHeartbeat: Lock ownership lost', {
            projectPath: redactPath(args.projectPath),
            lockHash: args.lockHash,
            currentInstance: args.instanceId,
            lockInstance: lockInfo.instanceId
          })
          clearInterval(timer)
          active.delete(args.projectPath)
          deps.onOwnershipLost(args.projectPath)
          return
        }
        if (lockInfo.focus_request) {
          if (isDisposing) return
          const ok = await handleFocusRequest(
            lockInfo,
            args.lockPath,
            args.projectPath,
            args.lockHash
          )
          if (ok) {
            const entry = active.get(args.projectPath)
            if (entry) entry.lastHeartbeatAt = deps.clock.now()
          }
          return
        }
        const entry = active.get(args.projectPath)
        if (entry && deps.clock.now() - entry.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
          if (isDisposing) return
          const ok = await writeHeartbeat(lockInfo, args.lockPath, args.projectPath)
          if (ok) entry.lastHeartbeatAt = deps.clock.now()
        }
      } catch (err) {
        logger.debug('LockHeartbeat: Polling tick error', {
          projectPath: redactPath(args.projectPath),
          error: err instanceof Error ? err.message : String(err),
          errno: (err as NodeJS.ErrnoException).code
        })
      } finally {
        ticking = false
      }
    }, POLL_INTERVAL_MS)

    const entry: ActiveHeartbeat = {
      args,
      pollTimer: timer,
      lastHeartbeatAt: deps.clock.now()
    }
    active.set(args.projectPath, entry)

    return {
      stop() {
        clearInterval(entry.pollTimer)
        active.delete(args.projectPath)
      },
      lastHeartbeatAt: () => entry.lastHeartbeatAt
    }
  }

  async function refreshAll(): Promise<void> {
    isSuspended = false
    if (isDisposing) return
    for (const [projectPath, entry] of active.entries()) {
      const lockInfo = await deps.readLockFile(entry.args.lockPath)
      if (!lockInfo || lockInfo.instanceId !== entry.args.instanceId) continue
      const ok = await writeHeartbeat(lockInfo, entry.args.lockPath, projectPath)
      if (ok) entry.lastHeartbeatAt = deps.clock.now()
    }
  }

  async function disposeAll(): Promise<void> {
    isDisposing = true
    for (const entry of active.values()) clearInterval(entry.pollTimer)
    active.clear()
  }

  return { start, refreshAll, disposeAll }
}

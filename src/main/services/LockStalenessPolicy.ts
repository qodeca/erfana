// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Clock } from '../utils/Clock'
import type { ProcessLiveness } from '../utils/ProcessLiveness'
import type { LockInfo } from '../../shared/ipc/project-lock-schema'
import { logger } from './LoggingService'
import { redactPath } from '../utils/redactUserInput'

/** Same-host stale threshold (ms) — if heartbeat is older than this, lock is considered zombie */
export const HEARTBEAT_STALE_MS = 30_000

/** Stale lock timeout for cross-host detection (60 minutes) */
export const STALE_TIMEOUT_MS = 60 * 60 * 1000

/** Clock skew buffer for cross-host timestamp comparison (15 minutes — robust for VMs and cloud) */
export const CLOCK_SKEW_BUFFER_MS = 15 * 60 * 1000

export interface LockStalenessPolicy {
  isStale(lockInfo: LockInfo): boolean
}

export interface LockStalenessPolicyDeps {
  clock: Clock
  liveness: ProcessLiveness
  currentHostname: string
}

/**
 * Create a staleness policy. Same-host branch checks PID liveness + heartbeat freshness
 * (HEARTBEAT_STALE_MS). Cross-host branch checks timestamp against STALE_TIMEOUT_MS +
 * CLOCK_SKEW_BUFFER_MS. Both branches treat unparseable datetimes (NaN) as stale.
 */
export function createLockStalenessPolicy(deps: LockStalenessPolicyDeps): LockStalenessPolicy {
  return {
    isStale(lockInfo: LockInfo): boolean {
      // Same-host: PID liveness + heartbeat freshness
      if (lockInfo.hostname === deps.currentHostname) {
        const alive = deps.liveness.isAlive(lockInfo.pid)
        if (!alive) {
          logger.debug('LockStalenessPolicy: Lock holder process is dead', {
            holderPid: lockInfo.pid,
            holderHostname: lockInfo.hostname,
            projectPath: redactPath(lockInfo.path)
          })
          return true
        }

        // PID alive → also require fresh heartbeat. Fall back to `timestamp` for legacy locks.
        const heartbeatStr = lockInfo.lastHeartbeat ?? lockInfo.timestamp
        const heartbeatAge = deps.clock.now() - new Date(heartbeatStr).getTime()
        if (Number.isNaN(heartbeatAge)) {
          logger.warn(
            'LockStalenessPolicy: Lock has unparseable heartbeat/timestamp – treating as stale',
            {
              projectPath: redactPath(lockInfo.path),
              holderPid: lockInfo.pid,
              heartbeatStr
            }
          )
          return true
        }
        if (heartbeatAge > HEARTBEAT_STALE_MS) {
          logger.warn('LockStalenessPolicy: Same-host lock heartbeat expired (zombie holder)', {
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
      const age = deps.clock.now() - lockTime
      if (Number.isNaN(age)) {
        logger.warn(
          'LockStalenessPolicy: Cross-host lock has unparseable timestamp – treating as stale',
          {
            holderHostname: lockInfo.hostname,
            timestamp: lockInfo.timestamp
          }
        )
        return true
      }
      const effectiveTimeout = STALE_TIMEOUT_MS + CLOCK_SKEW_BUFFER_MS
      if (age > effectiveTimeout) {
        logger.debug('LockStalenessPolicy: Cross-host lock timed out', {
          holderPid: lockInfo.pid,
          holderHostname: lockInfo.hostname,
          ageMinutes: Math.round(age / 60_000)
        })
        return true
      }
      return false
    }
  }
}

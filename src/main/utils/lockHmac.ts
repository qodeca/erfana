// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HMAC sign/verify for project-lock authenticity (lens-review F6).
 *
 * Threat model: a process running as the same user on the same machine can
 * write a forged lock file (denying us the project, or planting a fake
 * "stale" lock to trigger a steal). HMAC over the lock body with a key only
 * Erfana can produce defeats both: forged locks fail verification and are
 * treated as if the file didn't exist (so we proceed to acquire normally).
 *
 * Key derivation:
 *   - Use Electron `safeStorage.encryptString('erfana-lock-hmac-v1')` to derive
 *     a per-user-account key. Different OSes back safeStorage differently
 *     (macOS Keychain, Windows DPAPI, Linux secret-service or basic password),
 *     but in all cases another local user cannot reproduce the encryption
 *     without our process credentials.
 *   - The derived key is cached in-process. We never write it to disk.
 *   - If safeStorage is unavailable (e.g. Linux without secret-service), we
 *     skip signing — `signLock` returns `undefined`, `verifyLock` returns
 *     `'no-key'`. The caller treats no-key as "accept for backward compat".
 */

import { createHmac } from 'node:crypto'
import { safeStorage } from 'electron'
import type { LockInfo } from '../../shared/ipc/project-lock-schema'
import { logger } from '../services/LoggingService'

const KEY_LABEL = 'erfana-lock-hmac-v1'

let cachedKey: Buffer | null = null
let keyDerivationAttempted = false
let noKeyLoggedOnce = false

function getKey(): Buffer | null {
  if (cachedKey) return cachedKey
  if (keyDerivationAttempted) return null
  keyDerivationAttempted = true

  try {
    if (!safeStorage.isEncryptionAvailable()) {
      if (!noKeyLoggedOnce) {
        logger.warn('lockHmac: safeStorage encryption not available; HMAC disabled')
        noKeyLoggedOnce = true
      }
      return null
    }
    cachedKey = safeStorage.encryptString(KEY_LABEL)
    return cachedKey
  } catch (err) {
    logger.warn('lockHmac: failed to derive key', {
      error: err instanceof Error ? err.message : String(err)
    })
    return null
  }
}

/**
 * Canonicalize the lock body (all fields except `hmac` itself) for signing.
 * Field order is fixed so signer and verifier produce identical bytes.
 */
function canonicalize(lock: Omit<LockInfo, 'hmac'>): string {
  return JSON.stringify({
    instanceId: lock.instanceId,
    pid: lock.pid,
    timestamp: lock.timestamp,
    hostname: lock.hostname,
    path: lock.path,
    focus_request: lock.focus_request,
    requester_pid: lock.requester_pid,
    lastHeartbeat: lock.lastHeartbeat
  })
}

/**
 * Sign a lock body and return the HMAC-SHA-256 hex digest, or undefined
 * if safeStorage is unavailable. Caller attaches the result as `lock.hmac`.
 */
export function signLock(lock: Omit<LockInfo, 'hmac'>): string | undefined {
  const key = getKey()
  if (!key) return undefined
  return createHmac('sha256', key).update(canonicalize(lock)).digest('hex')
}

/**
 * Verify the HMAC. Outcomes:
 *   - 'valid'   : `hmac` present and matches the canonicalized body
 *   - 'missing' : `hmac` absent (legacy lock — caller decides)
 *   - 'invalid' : `hmac` present but does not match (forged or corrupted)
 *   - 'no-key'  : safeStorage unavailable; treat as 'missing' for legacy compat
 */
export function verifyLock(lock: LockInfo): 'valid' | 'missing' | 'invalid' | 'no-key' {
  if (!lock.hmac) return 'missing'
  const key = getKey()
  if (!key) return 'no-key'
  const expected = createHmac('sha256', key).update(canonicalize(lock)).digest('hex')
  return expected === lock.hmac ? 'valid' : 'invalid'
}

/**
 * Reset cached state — exported for tests only. Production never calls this.
 */
export function _resetForTesting(): void {
  cachedKey = null
  keyDerivationAttempted = false
  noKeyLoggedOnce = false
}

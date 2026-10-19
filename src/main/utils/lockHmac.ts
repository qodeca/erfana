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
 * How strong that is depends on the platform. Only on macOS is the secret tied
 * to the app (Keychain item owned by Erfana). On Windows (DPAPI) and Linux
 * (secret-service) any other program running as the same user can decrypt the
 * secret, so there the HMAC catches accidental or corrupted locks and naive
 * forgeries, not a determined same-user program.
 *
 * Key derivation:
 *   - A random 32-byte secret is generated once and stored encrypted with
 *     Electron `safeStorage` in `~/.erfana/lock-hmac-secret.enc`. Every launch
 *     (and every Erfana instance of the same user) decrypts the SAME secret, so
 *     signatures are stable even where `encryptString` output is randomized
 *     (Windows DPAPI / AES-GCM).
 *   - Earlier versions used `encryptString('erfana-lock-hmac-v1')` itself as the
 *     key. `verifyLock` still accepts that legacy key (verify only, never sign)
 *     so locks written by an older build keep working until they are rewritten.
 *     The legacy key only matches where `encryptString` is deterministic
 *     (macOS); on Windows it cannot match, so older locks verify as 'invalid'
 *     there and are re-acquired once.
 *   - The decrypted secret is cached in-process.
 *   - The secret file is published with a hard link of a fully written temp
 *     file (create-if-absent), so a second instance never sees a partial file
 *     and an existing secret is never overwritten.
 *   - If safeStorage is unavailable (e.g. Linux without secret-service, or the
 *     Linux `basic_text` backend, which has no real protection), we
 *     skip signing — `signLock` returns `undefined`, `verifyLock` returns
 *     `'no-key'`. The caller treats no-key as "accept for backward compat".
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { LockInfo } from '../../shared/ipc/project-lock-schema'
import { logger } from '../services/LoggingService'

/** Label whose ciphertext was the HMAC key before the random secret (legacy). */
const LEGACY_KEY_LABEL = 'erfana-lock-hmac-v1'
const SECRET_BYTES = 32
const SECRET_FILE_NAME = 'lock-hmac-secret.enc'

let cachedKey: Buffer | null = null
let cachedLegacyKey: Buffer | null | undefined
let keyDerivationAttempted = false
let noKeyLoggedOnce = false

function secretDir(): string {
  return join(homedir(), '.erfana')
}

function secretPath(): string {
  return join(secretDir(), SECRET_FILE_NAME)
}

/** Decrypt the stored secret, or null when absent / unreadable. */
function readStoredSecret(): Buffer | null {
  try {
    const hex = safeStorage.decryptString(readFileSync(secretPath()))
    const secret = Buffer.from(hex, 'hex')
    return secret.length === SECRET_BYTES ? secret : null
  } catch {
    return null
  }
}

const EXISTING_READ_ATTEMPTS = 5
const EXISTING_READ_WAIT_MS = 20

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Load the stored secret, creating it on first use. Returns null (no key for
 * this run) when a secret file exists but cannot be read; an existing secret is
 * never overwritten.
 */
function loadOrCreateSecret(): Buffer | null {
  const existing = readStoredSecret()
  if (existing) return existing

  const secret = randomBytes(SECRET_BYTES)
  mkdirSync(secretDir(), { recursive: true, mode: 0o700 })
  const encrypted = safeStorage.encryptString(secret.toString('hex'))
  const tempPath = join(secretDir(), `.${randomUUID()}.tmp`)
  try {
    writeFileSync(tempPath, encrypted, { mode: 0o600, flag: 'wx' })
    // linkSync fails with EEXIST instead of replacing, and the file it publishes
    // is already complete.
    linkSync(tempPath, secretPath())
    return secret
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    // Another instance won the race: use its secret.
    for (let attempt = 0; attempt < EXISTING_READ_ATTEMPTS; attempt++) {
      const winner = readStoredSecret()
      if (winner) return winner
      sleepSync(EXISTING_READ_WAIT_MS)
    }
    return null
  } finally {
    try {
      unlinkSync(tempPath)
    } catch {
      // Temp file may not exist
    }
  }
}

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
    if (
      process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text'
    ) {
      if (!noKeyLoggedOnce) {
        logger.warn('lockHmac: safeStorage uses basic_text backend; HMAC disabled')
        noKeyLoggedOnce = true
      }
      return null
    }
    cachedKey = loadOrCreateSecret()
    return cachedKey
  } catch (err) {
    logger.warn('lockHmac: failed to derive key', {
      error: err instanceof Error ? err.message : String(err)
    })
    return null
  }
}

/** Key used by older builds; only ever used to verify existing locks. */
function getLegacyKey(): Buffer | null {
  if (cachedLegacyKey !== undefined) return cachedLegacyKey
  try {
    cachedLegacyKey = safeStorage.encryptString(LEGACY_KEY_LABEL)
  } catch {
    cachedLegacyKey = null
  }
  return cachedLegacyKey
}

function hmacHex(key: Buffer, body: string): string {
  return createHmac('sha256', key).update(body).digest('hex')
}

/** Constant-time comparison of two hex digests. */
function digestsMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)
  return a.length === b.length && timingSafeEqual(a, b)
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
  const body = canonicalize(lock)
  if (digestsMatch(hmacHex(key, body), lock.hmac)) return 'valid'
  // Lock written by an older build: signed with the legacy key.
  const legacyKey = getLegacyKey()
  if (legacyKey && digestsMatch(hmacHex(legacyKey, body), lock.hmac)) {
    return 'valid'
  }
  return 'invalid'
}

/**
 * Reset cached state — exported for tests only. Production never calls this.
 */
export function _resetForTesting(): void {
  cachedKey = null
  cachedLegacyKey = undefined
  keyDerivationAttempted = false
  noKeyLoggedOnce = false
}

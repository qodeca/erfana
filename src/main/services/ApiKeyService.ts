// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * API Key Service
 *
 * Manages API key encryption/decryption using Electron's safeStorage API.
 * Keys are stored as encrypted files in ~/.erfana/ directory.
 *
 * Security:
 * - Uses safeStorage.encryptStringAsync() for platform-native encryption
 * - Refuses to store a key (never writes plaintext) when encryption is
 *   unavailable or Linux falls back to the `basic_text` backend
 * - Key files written by older versions in plaintext are still read once and
 *   rewritten encrypted when encryption is available
 * - Never logs API key values
 *
 * @see Issue #75 - Media import with transcription
 */
import { safeStorage } from 'electron'
import { readFile, writeFile, unlink, access, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { logger } from './LoggingService'
import { ApiKeyEncryptionUnavailableError } from './apiKeyErrors'

/** Directory for storing encrypted keys */
const KEYS_DIR = join(homedir(), '.erfana')

/** Printable ASCII only: a legacy plaintext key file (encrypted blobs are binary). */
const LEGACY_PLAINTEXT_PATTERN = /^[\x21-\x7e]+$/
const ENCRYPTED_PREFIX_PATTERN = /^v1[0-9]/

/** True when keys can be encrypted with a real OS-backed store. */
async function canEncrypt(): Promise<boolean> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
  // Linux without a keyring falls back to a hard-coded key – no real protection.
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return false
  }
  return true
}

/**
 * API Key Service Interface
 *
 * Service-agnostic design allows reuse for future API keys
 * (e.g., Anthropic, Google Cloud, etc.)
 */
interface IApiKeyService {
  /** Store an API key for a service */
  storeKey(serviceName: string, key: string): Promise<void>
  /** Retrieve an API key for a service */
  getKey(serviceName: string): Promise<string | null>
  /** Check if an API key exists for a service */
  hasKey(serviceName: string): boolean
  /** Remove an API key for a service */
  clearKey(serviceName: string): Promise<void>
}

/**
 * API Key Service Implementation
 *
 * Encrypts API keys using Electron safeStorage and stores them
 * as binary files in ~/.erfana/{serviceName}-api-key.enc
 */
class ApiKeyService implements IApiKeyService {
  /** Cache of known key file existence (avoids repeated fs checks) */
  private knownKeys: Set<string> = new Set()

  /**
   * Store an API key encrypted with safeStorage
   *
   * @param serviceName - Service identifier (e.g., 'openai')
   * @param key - The API key to store
   */
  async storeKey(serviceName: string, key: string): Promise<void> {
    const filePath = this.getKeyPath(serviceName)

    // Ensure directory exists with restricted permissions
    await mkdir(KEYS_DIR, { recursive: true, mode: 0o700 })

    if (!(await canEncrypt())) {
      logger.warn('Encryption unavailable, refusing to store API key', { serviceName })
      throw new ApiKeyEncryptionUnavailableError()
    }

    const encrypted = await safeStorage.encryptStringAsync(key)
    await writeFile(filePath, encrypted, { mode: 0o600 })
    logger.debug('API key stored with encryption', { serviceName })

    this.knownKeys.add(serviceName)
  }

  /**
   * Retrieve a stored API key
   *
   * @param serviceName - Service identifier (e.g., 'openai')
   * @returns The decrypted API key, or null if not found
   */
  async getKey(serviceName: string): Promise<string | null> {
    const filePath = this.getKeyPath(serviceName)

    try {
      await access(filePath)
    } catch {
      this.knownKeys.delete(serviceName)
      return null
    }

    try {
      const data = await readFile(filePath)

      if (await canEncrypt()) {
        try {
          const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(data)
          if (shouldReEncrypt) {
            await writeFile(filePath, await safeStorage.encryptStringAsync(result), {
              mode: 0o600
            })
          }
          return result
        } catch (decryptError) {
          // Not decryptable: may be a plaintext file from an older version.
          const legacy = this.parseLegacyPlaintext(data)
          if (legacy === null) throw decryptError
          await writeFile(filePath, await safeStorage.encryptStringAsync(legacy), { mode: 0o600 })
          logger.info('Migrated legacy API key file to encrypted storage', { serviceName })
          return legacy
        }
      }

      // Encryption unavailable: a legacy plaintext file stays readable so an
      // existing setup keeps working, but nothing new is ever written as plaintext.
      return this.parseLegacyPlaintext(data)
    } catch (error) {
      logger.error(
        'Failed to read API key',
        error instanceof Error ? error : undefined
      )
      return null
    }
  }

  /**
   * Check if an API key exists for a service
   *
   * Uses cached knowledge from storeKey/clearKey operations.
   * For fresh checks, use getKey() which hits the filesystem.
   *
   * @param serviceName - Service identifier
   * @returns true if key is known to exist
   */
  hasKey(serviceName: string): boolean {
    return this.knownKeys.has(serviceName)
  }

  /**
   * Remove a stored API key
   *
   * @param serviceName - Service identifier
   */
  async clearKey(serviceName: string): Promise<void> {
    const filePath = this.getKeyPath(serviceName)

    try {
      await unlink(filePath)
      logger.debug('API key cleared', { serviceName })
    } catch (error) {
      // File may not exist, which is fine
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.error(
          'Failed to clear API key',
          error instanceof Error ? error : undefined
        )
      }
    }

    this.knownKeys.delete(serviceName)
  }

  /**
   * Initialize known keys cache by checking filesystem
   *
   * Call this after app is ready to populate the hasKey() cache
   * without reading actual key values.
   *
   * @param serviceNames - Service names to check
   */
  async initializeCache(serviceNames: string[]): Promise<void> {
    for (const name of serviceNames) {
      const filePath = this.getKeyPath(name)
      try {
        await access(filePath)
        this.knownKeys.add(name)
      } catch {
        // Key file doesn't exist
      }
    }
  }

  /** Returns the key when the file holds an older plaintext key, otherwise null. */
  private parseLegacyPlaintext(data: Buffer): string | null {
    const text = data.toString('utf-8').trim()
    if (!LEGACY_PLAINTEXT_PATTERN.test(text) || ENCRYPTED_PREFIX_PATTERN.test(text)) return null
    return text
  }

  /**
   * Get file path for a service's encrypted key.
   * Validates serviceName to prevent path traversal.
   */
  private getKeyPath(serviceName: string): string {
    if (!/^[a-z0-9-]+$/.test(serviceName)) {
      throw new Error(`Invalid service name: ${serviceName}`)
    }
    return join(KEYS_DIR, `${serviceName}-api-key.enc`)
  }
}

/** Singleton instance */
export const apiKeyService = new ApiKeyService()

/** Factory function for testing */
export function createApiKeyService(): ApiKeyService {
  return new ApiKeyService()
}

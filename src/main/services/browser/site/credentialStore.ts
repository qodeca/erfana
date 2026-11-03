// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Saved HTTP sign-ins of one project (spec 025, 025-FR-022; ADR 0009
 * decisions 6 and 7).
 *
 * A sign-in is saved for one scheme, host, port and realm – the
 * {@link CredentialKey} – and used only for a challenge with that same key.
 *
 * - **Encrypted at rest.** `profile/Erfana/credentials.json` holds, per key,
 *   the user name and password encrypted together with the OS key store
 *   (`safeStorage`: Keychain, DPAPI, the Secret Service). Neither ever
 *   appears in plain text in the file; the file is also signed
 *   (`signedProfileFile.ts`), so an entry planted by a project script is
 *   ignored.
 * - **`session`** – no OS key store (Linux `basic_text`), encryption not
 *   available, or no signing key: nothing is read or written, and
 *   **Remember for this project** is not offered ("No keyring – cannot store
 *   passwords safely"). Anything kept lives in memory until quit.
 * - In memory the `saved` store keeps the encrypted blobs and decrypts one
 *   only when a challenge needs it. A blob that no longer decrypts (the key
 *   store changed) is dropped.
 * - Never logs a user name, a password or a realm.
 */
import { z } from 'zod'
import type { PurposeSigner } from '../browserProfileMarker'
import { profileErfanaSegments, readSignedList, SerialWriter, writeSignedList, type SignedListFile } from './signedProfileFile'
import { logger } from '../../LoggingService'

export const CREDENTIALS_FILE_NAME = 'credentials.json'
export const CREDENTIALS_PURPOSE = 'browser-saved-credentials'
export const CREDENTIALS_SEGMENTS = profileErfanaSegments(CREDENTIALS_FILE_NAME)
export const MAX_SAVED_CREDENTIALS = 200
/** The longest user name or password kept (the IPC schema's cap). */
const MAX_FIELD_CHARS = 1024

/** What a saved sign-in is for: the page's scheme, the challenging host and port, and the realm. */
export interface CredentialKey {
  readonly scheme: 'http' | 'https'
  readonly host: string
  readonly port: number
  readonly realm: string
}

export interface Credentials {
  readonly username: string
  readonly password: string
}

/** `safeStorage`, as far as the store needs it. */
export interface CredentialCrypto {
  isEncryptionAvailable(): boolean
  encryptString(text: string): Buffer
  decryptString(encrypted: Buffer): string
}

const EntrySchema = z
  .object({
    scheme: z.enum(['http', 'https']),
    host: z.string().min(1).max(255),
    port: z.number().int().min(0).max(65_535),
    realm: z.string().max(1024),
    /** Base64 of `safeStorage.encryptString(JSON.stringify({ username, password }))`. */
    secret: z.string().min(1).max(16 * 1024).regex(/^[A-Za-z0-9+/=]+$/)
  })
  .strict()
type Entry = z.infer<typeof EntrySchema>

const PlainSchema = z.object({ username: z.string().max(MAX_FIELD_CHARS), password: z.string().max(MAX_FIELD_CHARS) }).strict()

function keyText(key: CredentialKey): string {
  return JSON.stringify([key.scheme, key.host.toLowerCase(), key.port, key.realm])
}

export interface CredentialStoreOptions {
  readonly signer: PurposeSigner
  readonly crypto: CredentialCrypto
  /** `safeStorage`'s backend name; `basic_text` means no OS key store. */
  readonly backend: string
}

export class BrowserCredentialStore {
  /** `saved`: encrypted entries; `session`: plain credentials in memory. */
  private readonly saved = new Map<string, Entry>()
  private readonly memory = new Map<string, Credentials>()
  private readonly writer = new SerialWriter()

  private constructor(
    private readonly file: SignedListFile<Entry>,
    private readonly crypto: CredentialCrypto,
    /** `saved`: Remember is offered and kept encrypted; `session`: not offered, memory only. */
    readonly persistence: 'saved' | 'session'
  ) {}

  /** The store of the project at `canonical`. Never rejects. */
  static async open(canonical: string, options: CredentialStoreOptions): Promise<BrowserCredentialStore> {
    const file: SignedListFile<Entry> = {
      canonical,
      segments: CREDENTIALS_SEGMENTS,
      purpose: CREDENTIALS_PURPOSE,
      signer: options.signer,
      entry: EntrySchema,
      maxEntries: MAX_SAVED_CREDENTIALS,
      maxBytes: 1024 * 1024,
      label: 'Browser saved sign-ins'
    }
    const store = new BrowserCredentialStore(file, options.crypto, persistenceOf(options))
    if (store.persistence === 'saved') {
      for (const entry of await readSignedList(file)) store.saved.set(keyText(entry), entry)
    }
    return store
  }

  /** The sign-in saved for `key`, or `undefined`. */
  get(key: CredentialKey): Credentials | undefined {
    const text = keyText(key)
    if (this.persistence === 'session') return this.memory.get(text)
    const entry = this.saved.get(text)
    if (entry === undefined) return undefined
    try {
      return PlainSchema.parse(JSON.parse(this.crypto.decryptString(Buffer.from(entry.secret, 'base64'))))
    } catch {
      logger.warn('Browser saved sign-ins: an entry no longer decrypts, dropped')
      this.saved.delete(text)
      void this.persist()
      return undefined
    }
  }

  /** Save `credentials` for `key`, replacing any. Resolves when written; never rejects. */
  set(key: CredentialKey, credentials: Credentials): Promise<void> {
    const plain = PlainSchema.safeParse(credentials)
    if (!plain.success) return Promise.resolve()
    const text = keyText(key)
    if (this.persistence === 'session') {
      this.memory.delete(text)
      this.memory.set(text, plain.data)
      this.trim(this.memory)
      return Promise.resolve()
    }
    let secret: string
    try {
      secret = this.crypto.encryptString(JSON.stringify(plain.data)).toString('base64')
    } catch (error) {
      logger.warn('Browser saved sign-ins: encryption failed, not saved', { error: String(error) })
      return Promise.resolve()
    }
    this.saved.delete(text)
    this.saved.set(text, { scheme: key.scheme, host: key.host.toLowerCase(), port: key.port, realm: key.realm, secret })
    this.trim(this.saved)
    return this.persist()
  }

  /** Forget every saved sign-in (Clear browsing data, 025-FR-023). Never rejects. */
  clear(): Promise<void> {
    this.saved.clear()
    this.memory.clear()
    return this.persist()
  }

  size(): number {
    return this.persistence === 'saved' ? this.saved.size : this.memory.size
  }

  private trim(map: Map<string, unknown>): void {
    while (map.size > MAX_SAVED_CREDENTIALS) map.delete(map.keys().next().value as string)
  }

  private persist(): Promise<void> {
    if (this.persistence === 'session') return Promise.resolve()
    return this.writer.persist(() => writeSignedList(this.file, [...this.saved.values()]))
  }
}

function persistenceOf(options: CredentialStoreOptions): 'saved' | 'session' {
  if (options.backend === 'basic_text' || !options.signer.hasKey()) return 'session'
  try {
    return options.crypto.isEncryptionAvailable() ? 'saved' : 'session'
  } catch {
    return 'session'
  }
}

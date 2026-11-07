// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Certificate exceptions of one project (spec 025, 025-FR-021; ADR 0009
 * decisions 6 and 7; spec change S-26).
 *
 * **Proceed anyway** saves an exception for the host and the certificate's
 * SHA-256 fingerprint, for {@link CERTIFICATE_EXCEPTION_MS} (7 days, as
 * Chrome does). A different certificate on the same host is not covered, so
 * it warns again. Time is the injected clock's, so a test moves 7 days.
 *
 * - **Signed file** `profile/Erfana/trust.json` (`signedProfileFile.ts`):
 *   a file that does not verify is ignored, and replaced by the next save.
 * - **Memory only** when this run has no signing key (Linux `basic_text`,
 *   S-26): the file is neither read nor written; exceptions last until quit.
 * - Expired exceptions are dropped when read; at most
 *   {@link MAX_CERTIFICATE_EXCEPTIONS} are kept, the oldest go first.
 */
import { z } from 'zod'
import type { Clock } from '../../../../shared/clock'
import type { PurposeSigner } from '../browserProfileMarker'
import { profileGenerations } from '../profileGenerations'
import { profileErfanaSegments, readSignedList, SerialWriter, writeSignedList, type SignedListFile } from './signedProfileFile'

export const TRUST_FILE_NAME = 'trust.json'
export const TRUST_PURPOSE = 'browser-certificate-trust'
export const TRUST_SEGMENTS = profileErfanaSegments(TRUST_FILE_NAME)
/** How long **Proceed anyway** is remembered (025-FR-021). */
export const CERTIFICATE_EXCEPTION_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_CERTIFICATE_EXCEPTIONS = 500

const ExceptionSchema = z
  .object({
    host: z.string().min(1).max(255),
    /** SHA-256 of the certificate's DER bytes, lower-case hex. */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    expiresAt: z.number().int().nonnegative()
  })
  .strict()
type CertificateException = z.infer<typeof ExceptionSchema>

const keyOf = (host: string, fingerprint: string): string => `${host.toLowerCase()} ${fingerprint}`

export class BrowserCertificateStore {
  private readonly exceptions = new Map<string, CertificateException>()
  private readonly writer = new SerialWriter()

  private constructor(
    private readonly file: SignedListFile<CertificateException>,
    private readonly clock: Pick<Clock, 'now'>,
    /** Whether exceptions reach the file (`saved`) or last for this run (`session`). */
    readonly persistence: 'saved' | 'session'
  ) {}

  /**
   * The store of the project at `canonical`; `homeDir` holds its generation
   * record (ADR 0009 decision 6). Never rejects.
   */
  static async open(
    canonical: string,
    homeDir: string,
    signer: PurposeSigner,
    clock: Pick<Clock, 'now'>
  ): Promise<BrowserCertificateStore> {
    const file: SignedListFile<CertificateException> = {
      canonical,
      segments: TRUST_SEGMENTS,
      purpose: TRUST_PURPOSE,
      signer,
      generations: profileGenerations(homeDir, canonical),
      entry: ExceptionSchema,
      maxEntries: MAX_CERTIFICATE_EXCEPTIONS,
      maxBytes: 256 * 1024,
      label: 'Browser certificate trust'
    }
    const store = new BrowserCertificateStore(file, clock, signer.hasKey() ? 'saved' : 'session')
    if (store.persistence === 'saved') {
      for (const entry of await readSignedList(file)) store.exceptions.set(keyOf(entry.host, entry.fingerprint), entry)
    }
    return store
  }

  /** Whether `host` has an unexpired exception for the certificate `fingerprint`. */
  isExcepted(host: string, fingerprint: string): boolean {
    const key = keyOf(host, fingerprint)
    const entry = this.exceptions.get(key)
    if (entry === undefined) return false
    if (entry.expiresAt > this.clock.now()) return true
    this.exceptions.delete(key)
    return false
  }

  /** Save an exception for 7 days from now. Memory changes at once; resolves when written. */
  add(host: string, fingerprint: string): Promise<void> {
    const key = keyOf(host, fingerprint)
    this.exceptions.delete(key)
    this.exceptions.set(key, { host: host.toLowerCase(), fingerprint, expiresAt: this.clock.now() + CERTIFICATE_EXCEPTION_MS })
    while (this.exceptions.size > MAX_CERTIFICATE_EXCEPTIONS) {
      this.exceptions.delete(this.exceptions.keys().next().value as string)
    }
    return this.persist()
  }

  /** Forget every exception (Clear browsing data, 025-FR-023). Never rejects. */
  clear(): Promise<void> {
    this.exceptions.clear()
    return this.persist()
  }

  size(): number {
    return this.exceptions.size
  }

  private persist(): Promise<void> {
    if (this.persistence === 'session') return Promise.resolve()
    return this.writer.persist(() => {
      const now = this.clock.now()
      return writeSignedList(this.file, [...this.exceptions.values()].filter((e) => e.expiresAt > now))
    })
  }
}

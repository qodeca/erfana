// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Fakes for the site suites: an HMAC signer with or without a key, a
 * reversible stand-in for `safeStorage`, and a project root that holds
 * `.erfana/browser/profile/Erfana/`.
 */
import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PurposeSigner } from '../../browserProfileMarker'
import type { CredentialCrypto } from '../credentialStore'
import { profileErfanaSegments } from '../signedProfileFile'

/** A signer over `key`; `null` is a run with no signing key (Linux `basic_text`). */
export function testSigner(key: string | null): PurposeSigner {
  const digest = (purpose: string, body: string): string =>
    createHmac('sha256', key ?? '').update(`${purpose}\0${body}`).digest('hex')
  return {
    hasKey: () => key !== null,
    sign: (purpose, body) => (key === null ? undefined : digest(purpose, body)),
    verify: (purpose, body, d) => {
      if (!d) return 'missing'
      if (key === null) return 'no-key'
      return digest(purpose, body) === d ? 'valid' : 'invalid'
    }
  }
}

/** Reversible "encryption" (XOR and a tag) so tests can see the file never holds plain text. */
export function testCrypto(available = true, key = 0x5a): CredentialCrypto & { broken: boolean } {
  const fake = {
    broken: false,
    isEncryptionAvailable: () => available,
    encryptString: (text: string): Buffer => Buffer.concat([Buffer.from('ENC1'), Buffer.from(text, 'utf8').map((b) => b ^ key)]),
    decryptString: (data: Buffer): string => {
      if (fake.broken || data.subarray(0, 4).toString() !== 'ENC1') throw new Error('cannot decrypt')
      return Buffer.from(data.subarray(4).map((b) => b ^ key)).toString('utf8')
    }
  }
  return fake
}

/** A canonical temp project with the profile's Erfana folder in place. */
export function tempProject(prefix: string): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  mkdirSync(join(root, ...profileErfanaSegments('x').slice(0, -1)), { recursive: true })
  return root
}

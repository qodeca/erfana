// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The TEST-ONLY certificates of the spec 025 browser fixtures (`../certs/`).
 *
 * They are generated on first use by `../certs/generate.sh` and never
 * committed: the required `Secret scan` check runs gitleaks over every ref in
 * the repository, so a committed test key on this branch would fail the scan
 * on `develop` and every other branch (docs/ci.md § Secret scan).
 */

import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, X509Certificate } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** Holds `generate.sh` and the git-ignored `generated/` folder. */
export const CERTS_ROOT = path.join(__dirname, '..', 'certs')
/** The generated set; every file in it comes from one run of `generate.sh`. */
export const CERTS_DIR = path.join(CERTS_ROOT, 'generated')

const ALL_FILES = ['ca', 'valid', 'expired', 'mismatch', 'selfsigned', 'selfsigned-b'].flatMap(n => [
  `${n}.pem`,
  `${n}.key.pem`
])

const complete = (dir: string): boolean => ALL_FILES.every(f => fs.existsSync(path.join(dir, f)))

/**
 * Generate the certificate set once if it is missing. Safe when several
 * Playwright workers start together: each generates a whole set into its own
 * temporary folder and renames it into place in one step; a worker that loses
 * the race drops its set, so a certificate is never paired with another run's
 * key or CA.
 */
export function ensureCerts(): void {
  if (complete(CERTS_DIR)) return
  const tmp = path.join(CERTS_ROOT, `.gen-${process.pid}-${randomBytes(4).toString('hex')}`)
  fs.mkdirSync(tmp)
  try {
    execFileSync('bash', [path.join(CERTS_ROOT, 'generate.sh'), tmp], { stdio: 'pipe' })
    try {
      fs.renameSync(tmp, CERTS_DIR)
    } catch {
      // Another worker placed its set first; keep that one.
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  if (!complete(CERTS_DIR)) throw new Error(`test certificates could not be generated in ${CERTS_DIR}`)
}

/** The certificate files `generate.sh` writes, each with a `<name>.key.pem`. */
export type CertName = 'valid' | 'expired' | 'mismatch' | 'selfsigned' | 'selfsigned-b'

export interface CertPair {
  readonly cert: string
  readonly key: string
}

export function readCertPair(name: CertName): CertPair {
  ensureCerts()
  return {
    cert: fs.readFileSync(path.join(CERTS_DIR, `${name}.pem`), 'utf8'),
    key: fs.readFileSync(path.join(CERTS_DIR, `${name}.key.pem`), 'utf8')
  }
}

export function readCaPem(): string {
  ensureCerts()
  return fs.readFileSync(path.join(CERTS_DIR, 'ca.pem'), 'utf8')
}

/**
 * Base64 SHA-256 of a certificate's SubjectPublicKeyInfo – the form Chromium's
 * `--ignore-certificate-errors-spki-list` takes, should a test choose to trust
 * the valid leaf that way rather than through a test hook.
 */
export function spkiSha256(certPem: string): string {
  const spki = new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(spki).digest('base64')
}

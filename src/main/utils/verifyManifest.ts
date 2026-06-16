// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Minisign (Ed25519) signature verification for whisper manifests.
 *
 * Implements the minisign signature format per
 * https://jedisct1.github.io/minisign/ using `@noble/ed25519` as the
 * Ed25519 primitive (pure JS, audited, no native deps).
 *
 * The dual-key trust model: a manifest signed by EITHER our primary
 * (`4AEBCE8499845646`) OR rotation (`E8E4B205269790F1`) minisign key is
 * accepted. This lets us rotate the primary without bricking installs
 * that predate the rotation. Only the untrusted-comment / primary
 * signature is verified; the trusted-comment layer is ignored for
 * performance (we've never used it and our threat model doesn't
 * require it).
 *
 * @see src/main/services/whisper-pubkeys.ts
 * @see docs/build/whisper-binaries.md
 */

import { verifyAsync } from '@noble/ed25519'
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'

import { WHISPER_PUBKEYS, type WhisperPubKey } from '../services/whisper-pubkeys'

/** Minisign algorithm identifiers (bytes 0–1 of every payload). */
const MINISIGN_ALG_ED_LEGACY: readonly [number, number] = [0x45, 0x64] // "Ed" — raw content signed
const MINISIGN_ALG_ED_PREHASHED: readonly [number, number] = [0x45, 0x44] // "ED" — BLAKE2b-512(content) signed, minisign >= 0.7 default

const PUBKEY_LEN = 42 // 2 alg + 8 keyId + 32 ed25519 pubkey
const SIG_LEN = 74 // 2 alg + 8 keyId + 64 ed25519 sig

export type VerifyManifestErrorCode =
  | 'malformed-signature'
  | 'unsupported-algorithm'
  | 'key-id-mismatch'
  | 'ed25519-rejected'
  | 'no-trusted-pubkey'

export class VerifyManifestError extends Error {
  constructor(
    public readonly code: VerifyManifestErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'VerifyManifestError'
  }
}

export interface VerifyManifestOpts {
  /** Absolute path to the manifest content file (e.g. `manifest.json`). */
  contentPath: string
  /** Absolute path to the detached minisign signature (e.g. `manifest.json.minisig`). */
  signaturePath: string
  /** Override the trusted pubkey set — for tests. Default: `WHISPER_PUBKEYS`. */
  trustedPubkeys?: readonly WhisperPubKey[]
}

export interface VerifyManifestResult {
  valid: boolean
  /** Which embedded pubkey role verified. `null` on failure. */
  signingKeyRole: WhisperPubKey['role'] | null
  /** Hex-encoded 8-byte key ID from the signature. */
  signingKeyId: string
}

/**
 * Verify a minisign signature against the embedded trusted pubkeys.
 *
 * Returns `{ valid: true, signingKeyRole }` on success; throws
 * `VerifyManifestError` on any parse / algorithm / key-ID / Ed25519 failure.
 */
export async function verifyManifest(
  opts: VerifyManifestOpts
): Promise<VerifyManifestResult> {
  const pubkeys = opts.trustedPubkeys ?? WHISPER_PUBKEYS

  const [content, sigFile] = await Promise.all([
    readFile(opts.contentPath),
    readFile(opts.signaturePath, 'utf8')
  ])

  const sig = parseSignature(sigFile)
  // Minisign displays key IDs in REVERSED byte order (documented convention —
  // the `minisign public key <hex>` string you see in a .pub file is the
  // payload's 8-byte keyId read big-endian, which equals the little-endian
  // file bytes reversed). Reverse here so our reported signingKeyId matches
  // what users see in the .pub file and in release descriptions.
  const sigKeyIdHex = Buffer.from(sig.keyId).reverse().toString('hex').toUpperCase()

  // For prehashed (`ED`) signatures — the modern minisign default — the
  // signature is over BLAKE2b-512(content), not raw content. Compute once
  // so we don't re-hash per pubkey.
  const signedMessage =
    sig.alg === 'ed-prehashed'
      ? new Uint8Array(createHash('blake2b512').update(content).digest())
      : new Uint8Array(content)

  for (const trusted of pubkeys) {
    let parsedPub: ParsedPubkey
    try {
      parsedPub = parsePubkey(trusted.publicKey)
    } catch {
      // Malformed embedded pubkey — skip, try next.
      continue
    }
    if (!timingSafeEqual(sig.keyId, parsedPub.keyId)) continue

    const ok = await verifyAsync(sig.signature, signedMessage, parsedPub.pubkey)
    if (!ok) {
      throw new VerifyManifestError(
        'ed25519-rejected',
        `Ed25519 verify failed for key ${sigKeyIdHex} (${trusted.role}, alg=${sig.alg})`
      )
    }
    return {
      valid: true,
      signingKeyRole: trusted.role,
      signingKeyId: sigKeyIdHex
    }
  }

  throw new VerifyManifestError(
    'no-trusted-pubkey',
    `Signature key ID ${sigKeyIdHex} matches no embedded trusted pubkey`
  )
}

interface ParsedPubkey {
  keyId: Uint8Array
  pubkey: Uint8Array
}

type MinisignAlg = 'ed-legacy' | 'ed-prehashed'

interface ParsedSignature {
  alg: MinisignAlg
  keyId: Uint8Array
  signature: Uint8Array
}

function detectAlg(raw: Buffer, label: string): MinisignAlg {
  if (raw[0] === MINISIGN_ALG_ED_LEGACY[0] && raw[1] === MINISIGN_ALG_ED_LEGACY[1]) {
    return 'ed-legacy'
  }
  if (
    raw[0] === MINISIGN_ALG_ED_PREHASHED[0] &&
    raw[1] === MINISIGN_ALG_ED_PREHASHED[1]
  ) {
    return 'ed-prehashed'
  }
  throw new VerifyManifestError(
    'unsupported-algorithm',
    `${label} algorithm bytes 0x${raw[0]?.toString(16) ?? '?'} 0x${raw[1]?.toString(16) ?? '?'} — not Ed25519`
  )
}

function parsePubkey(base64Payload: string): ParsedPubkey {
  const raw = Buffer.from(base64Payload.trim(), 'base64')
  if (raw.length !== PUBKEY_LEN) {
    throw new VerifyManifestError(
      'malformed-signature',
      `Pubkey length ${raw.length} != ${PUBKEY_LEN}`
    )
  }
  detectAlg(raw, 'Pubkey') // throws if not Ed25519 (either variant)
  return {
    keyId: new Uint8Array(raw.subarray(2, 10)),
    pubkey: new Uint8Array(raw.subarray(10, 42))
  }
}

function parseSignature(sigFile: string): ParsedSignature {
  // Minisign signature file format:
  //   untrusted comment: <free-form>
  //   <base64: 2 alg + 8 keyId + 64 ed25519 sig>
  //   trusted comment: <free-form>
  //   <base64: 64 ed25519 sig over (primary_sig || trusted_comment)>
  // We only verify the primary (line 2).
  const lines = sigFile.trim().split(/\r?\n/)
  if (lines.length < 2) {
    throw new VerifyManifestError(
      'malformed-signature',
      `Signature file must have >= 2 lines, got ${lines.length}`
    )
  }
  const raw = Buffer.from(lines[1].trim(), 'base64')
  if (raw.length !== SIG_LEN) {
    throw new VerifyManifestError(
      'malformed-signature',
      `Signature payload length ${raw.length} != ${SIG_LEN}`
    )
  }
  const alg = detectAlg(raw, 'Signature')
  return {
    alg,
    keyId: new Uint8Array(raw.subarray(2, 10)),
    signature: new Uint8Array(raw.subarray(10, 74))
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

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
 * that predate the rotation. Both layers are checked: the signature over
 * the manifest bytes, and the global signature that covers the trusted
 * comment. Only the prehashed (`ED`) signature form is accepted.
 *
 * @see src/main/services/whisper-pubkeys.ts
 * @see docs/build/whisper-binaries.md
 */

import { verifyAsync } from '@noble/ed25519'
import { blake2b } from '@noble/hashes/blake2'
import { readFile } from 'fs/promises'

import { WHISPER_PUBKEYS, type WhisperPubKey } from '../services/whisper-pubkeys'

/** Minisign algorithm identifiers (bytes 0–1 of every payload). */
const MINISIGN_ALG_ED_LEGACY: readonly [number, number] = [0x45, 0x64] // "Ed" — public keys always use this; signatures must not
const MINISIGN_ALG_ED_PREHASHED: readonly [number, number] = [0x45, 0x44] // "ED" — BLAKE2b-512(content) signed, minisign >= 0.7 default

const TRUSTED_COMMENT_PREFIX = 'trusted comment: '
const ED25519_SIG_LEN = 64

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
  /** The exact manifest bytes that were verified. Parse these, not the file again. */
  content: Buffer
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

  // Prehashed (`ED`) signatures — the only accepted form — sign
  // BLAKE2b-512(content). Compute once so we don't re-hash per pubkey.
  // Pure-JS BLAKE2b on purpose: Electron's Node uses BoringSSL, which has no
  // `blake2b512`, so `crypto.createHash` throws "Digest method not supported"
  // in packaged builds.
  const signedMessage = blake2b(new Uint8Array(content), { dkLen: 64 })

  for (const trusted of pubkeys) {
    let parsedPub: ParsedPubkey
    try {
      parsedPub = parsePubkey(trusted.publicKey)
    } catch {
      // Malformed embedded pubkey — skip, try next.
      continue
    }
    if (!timingSafeEqual(sig.keyId, parsedPub.keyId)) continue

    const ok = await verifyAsync(sig.signature, signedMessage, parsedPub.pubkey, {
      zip215: false
    })
    if (!ok) {
      throw new VerifyManifestError(
        'ed25519-rejected',
        `Ed25519 verify failed for key ${sigKeyIdHex} (${trusted.role})`
      )
    }

    // Global signature: same key over signature || trusted comment.
    const globalMessage = new Uint8Array(ED25519_SIG_LEN + sig.trustedComment.length)
    globalMessage.set(sig.signature, 0)
    globalMessage.set(sig.trustedComment, ED25519_SIG_LEN)
    const globalOk = await verifyAsync(sig.globalSignature, globalMessage, parsedPub.pubkey, {
      zip215: false
    })
    if (!globalOk) {
      throw new VerifyManifestError(
        'ed25519-rejected',
        `Global signature verify failed for key ${sigKeyIdHex} (${trusted.role})`
      )
    }

    return {
      valid: true,
      signingKeyRole: trusted.role,
      signingKeyId: sigKeyIdHex,
      content
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

interface ParsedSignature {
  keyId: Uint8Array
  signature: Uint8Array
  /** UTF-8 bytes of the trusted comment, without the `trusted comment: ` prefix. */
  trustedComment: Uint8Array
  globalSignature: Uint8Array
}

/** Strict base64 decode: rejects anything that does not round-trip exactly. */
function decodeStrictBase64(text: string, label: string): Buffer {
  const raw = Buffer.from(text, 'base64')
  if (raw.toString('base64') !== text) {
    throw new VerifyManifestError('malformed-signature', `${label} is not canonical base64`)
  }
  return raw
}

function algBytesMatch(raw: Buffer, alg: readonly [number, number]): boolean {
  return raw[0] === alg[0] && raw[1] === alg[1]
}

function algDescription(raw: Buffer): string {
  return `0x${raw[0]?.toString(16) ?? '?'} 0x${raw[1]?.toString(16) ?? '?'}`
}

function parsePubkey(base64Payload: string): ParsedPubkey {
  let raw: Buffer
  try {
    raw = decodeStrictBase64(base64Payload.trim(), 'Pubkey')
  } catch {
    throw new VerifyManifestError('malformed-signature', 'Pubkey is not canonical base64')
  }
  if (raw.length !== PUBKEY_LEN) {
    throw new VerifyManifestError(
      'malformed-signature',
      `Pubkey length ${raw.length} != ${PUBKEY_LEN}`
    )
  }
  // Minisign public keys always carry the "Ed" identifier.
  if (!algBytesMatch(raw, MINISIGN_ALG_ED_LEGACY)) {
    throw new VerifyManifestError(
      'unsupported-algorithm',
      `Pubkey algorithm bytes ${algDescription(raw)} — not Ed25519`
    )
  }
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
  const lines = sigFile.trim().split(/\r?\n/)
  if (lines.length < 4) {
    throw new VerifyManifestError(
      'malformed-signature',
      `Signature file must have >= 4 lines, got ${lines.length}`
    )
  }
  const raw = decodeStrictBase64(lines[1].trim(), 'Signature payload')
  if (raw.length !== SIG_LEN) {
    throw new VerifyManifestError(
      'malformed-signature',
      `Signature payload length ${raw.length} != ${SIG_LEN}`
    )
  }
  if (!algBytesMatch(raw, MINISIGN_ALG_ED_PREHASHED)) {
    throw new VerifyManifestError(
      'unsupported-algorithm',
      `Signature algorithm bytes ${algDescription(raw)} — only prehashed Ed25519 ("ED") is accepted`
    )
  }
  if (!lines[2].startsWith(TRUSTED_COMMENT_PREFIX)) {
    throw new VerifyManifestError('malformed-signature', 'Missing trusted comment line')
  }
  const trustedComment = Buffer.from(lines[2].slice(TRUSTED_COMMENT_PREFIX.length), 'utf8')
  const globalSignature = decodeStrictBase64(lines[3].trim(), 'Global signature')
  if (globalSignature.length !== ED25519_SIG_LEN) {
    throw new VerifyManifestError(
      'malformed-signature',
      `Global signature length ${globalSignature.length} != ${ED25519_SIG_LEN}`
    )
  }
  return {
    keyId: new Uint8Array(raw.subarray(2, 10)),
    signature: new Uint8Array(raw.subarray(10, 74)),
    trustedComment: new Uint8Array(trustedComment),
    globalSignature: new Uint8Array(globalSignature)
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

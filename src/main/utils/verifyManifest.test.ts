// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for verifyManifest.ts — minisign Ed25519 signature verification.
 *
 * Uses the REAL whisper-build-v1.8.4-erfana1 manifest + signature as a
 * fixture (fetched from the just-published release; copied into
 * fixtures/whisper-manifest/ as a one-time artifact). This gives the
 * test a genuine signed-and-verified pair, not a synthetic one.
 *
 * Negative tests are synthesised — the tiny 187-byte signature file
 * makes tampering deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { WHISPER_PUBKEYS } from '../services/whisper-pubkeys'
import { verifyManifest } from './verifyManifest'

// Electron's Node uses BoringSSL, which has no BLAKE2b: `createHash('blake2b512')`
// throws "Digest method not supported". Mirror that here so a regression to the
// native hash fails in plain Node too. Electron 44.9.0 getHashes():
// md4,md5,ripemd160,sha1,sha224,sha256,sha384,sha512,sha512-256
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  const guard =
    <T extends (...a: never[]) => unknown>(fn: T): T =>
    ((algorithm: string, ...rest: unknown[]) => {
      if (/^blake2/i.test(algorithm)) throw new Error('Digest method not supported')
      return (fn as unknown as (...a: unknown[]) => unknown)(algorithm, ...rest)
    }) as unknown as T
  const createHash = guard(actual.createHash)
  const createHmac = guard(actual.createHmac)
  const hash = guard(actual.hash)
  return {
    ...actual,
    default: { ...actual, createHash, createHmac, hash },
    createHash,
    createHmac,
    hash
  }
})

/**
 * Real fixture from whisper-build-v1.8.4-erfana1 (published 2026-04-22).
 * `manifest.fixture.json` is the byte-identical manifest.json that the CI
 * workflow signed; `.minisig` is the detached signature emitted by the
 * primary minisign key (4AEBCE8499845646). If these fixtures ever fall
 * out of date with the source code, re-copy from the corresponding
 * whisper-build release before re-running the test.
 */
const FIXTURE_DIR = resolve(__dirname, '__fixtures__')
const FIXTURE_MANIFEST_PATH = join(FIXTURE_DIR, 'manifest.fixture.json')
const FIXTURE_SIGNATURE_PATH = join(FIXTURE_DIR, 'manifest.fixture.json.minisig')

describe('verifyManifest', () => {
  let workDir: string
  let manifestPath: string
  let sigPath: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'erfana-verify-'))
    manifestPath = join(workDir, 'manifest.json')
    sigPath = join(workDir, 'manifest.json.minisig')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('accepts a valid signature from the primary embedded pubkey', async () => {
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await copyFile(FIXTURE_SIGNATURE_PATH, sigPath)
    const result = await verifyManifest({
      contentPath: manifestPath,
      signaturePath: sigPath
    })
    expect(result.valid).toBe(true)
    expect(result.signingKeyRole).toBe('primary')
    expect(result.signingKeyId).toBe('4AEBCE8499845646')
  })

  it('rejects a tampered manifest (content modified after signing)', async () => {
    const original = await readFile(FIXTURE_MANIFEST_PATH)
    const tampered = Buffer.concat([original, Buffer.from('\n// tampered')])
    await writeFile(manifestPath, tampered)
    await copyFile(FIXTURE_SIGNATURE_PATH, sigPath)
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({
      name: 'VerifyManifestError',
      code: 'ed25519-rejected'
    })
  })

  it('rejects a signature whose key ID is not in our trusted set', async () => {
    // Surgically swap the 8-byte key ID in the signature payload to
    // something that isn't primary or rotation, keeping alg byte + sig
    // intact so parse succeeds and we reach the trust-list check.
    const sigFile = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const lines = sigFile.split(/\r?\n/)
    const raw = Buffer.from(lines[1], 'base64')
    // Replace bytes 2-9 (keyId) with all-zeros.
    raw.fill(0x00, 2, 10)
    lines[1] = raw.toString('base64')
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, lines.join('\n'))
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({
      code: 'no-trusted-pubkey'
    })
  })

  it('rejects a malformed signature file (< 4 lines)', async () => {
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, 'only one line')
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({
      code: 'malformed-signature'
    })
  })

  it('rejects a signature payload with wrong length', async () => {
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(
      sigPath,
      'untrusted comment: custom\nZm9v\ntrusted comment: x\nZm9v\n' // base64 "foo" — 3 bytes, way short
    )
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({
      code: 'malformed-signature'
    })
  })

  it('rejects a signature with non-Ed algorithm bytes', async () => {
    const bogus = Buffer.alloc(74)
    bogus[0] = 0x00 // not E
    bogus[1] = 0x00 // not d/D
    const base64 = bogus.toString('base64')
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(
      sigPath,
      `untrusted comment: custom\n${base64}\ntrusted comment: x\n${Buffer.alloc(64).toString('base64')}\n`
    )
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({
      code: 'unsupported-algorithm'
    })
  })

  it('refuses the legacy "Ed" algorithm for signatures', async () => {
    // Flip the signature alg byte from prehashed ("ED") to legacy ("Ed").
    // Minisign keys always use "Ed", but a signature must be prehashed.
    const sigFile = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const lines = sigFile.split(/\r?\n/)
    const raw = Buffer.from(lines[1], 'base64')
    raw[1] = 0x64 // 0x44 ("D", prehashed) → 0x64 ("d", legacy)
    lines[1] = raw.toString('base64')
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, lines.join('\n'))
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({ code: 'unsupported-algorithm' })
  })

  it('verifies the global signature and returns the verified bytes', async () => {
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await copyFile(FIXTURE_SIGNATURE_PATH, sigPath)
    const result = await verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    expect(result.content.equals(await readFile(FIXTURE_MANIFEST_PATH))).toBe(true)
  })

  it('rejects a changed trusted comment', async () => {
    const sigFile = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const lines = sigFile.split(/\r?\n/)
    lines[2] = lines[2].replace('timestamp:1776875913', 'timestamp:1776875914')
    expect(lines[2]).not.toBe(sigFile.split(/\r?\n/)[2])
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, lines.join('\n'))
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({ code: 'ed25519-rejected' })
  })

  it('rejects a garbage global signature', async () => {
    const sigFile = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const lines = sigFile.split(/\r?\n/)
    lines[3] = Buffer.alloc(64, 7).toString('base64')
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, lines.join('\n'))
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({ code: 'ed25519-rejected' })
  })

  it('rejects a signature file without the global signature lines', async () => {
    const sigFile = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const lines = sigFile.split(/\r?\n/).slice(0, 2)
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, lines.join('\n'))
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({ code: 'malformed-signature' })
  })

  it('rejects non-canonical base64 in the signature payload', async () => {
    const sigFile = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const lines = sigFile.split(/\r?\n/)
    lines[1] = `${lines[1]}!!`
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, lines.join('\n'))
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({ code: 'malformed-signature' })
  })

  it('rejects a signature file with no trusted comment line', async () => {
    const sigFile = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const lines = sigFile.split(/\r?\n/)
    lines[2] = 'comment: timestamp:1776875913'
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, lines.join('\n'))
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({ code: 'malformed-signature' })
  })

  it('rejects a global signature of the wrong length', async () => {
    const sigFile = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const lines = sigFile.split(/\r?\n/)
    lines[3] = Buffer.alloc(63, 1).toString('base64')
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, lines.join('\n'))
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({ code: 'malformed-signature' })
  })

  it('skips embedded pubkeys that are non-canonical base64 or not "Ed" keys', async () => {
    const prehashedAlg = Buffer.from(WHISPER_PUBKEYS[0].publicKey, 'base64')
    prehashedAlg[1] = 0x44 // "ED" is a signature identifier, never a key's
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await copyFile(FIXTURE_SIGNATURE_PATH, sigPath)
    await expect(
      verifyManifest({
        contentPath: manifestPath,
        signaturePath: sigPath,
        trustedPubkeys: [
          { ...WHISPER_PUBKEYS[0], publicKey: `${WHISPER_PUBKEYS[0].publicKey}!!` },
          { ...WHISPER_PUBKEYS[0], publicKey: prehashedAlg.toString('base64') }
        ]
      })
    ).rejects.toMatchObject({ code: 'no-trusted-pubkey' })
  })

  it('parses every embedded pubkey: a rotation-key ID reaches the Ed25519 check', async () => {
    // Point the fixture's key ID at the rotation key. Its pubkey must parse and
    // match, so the (wrong-key) signature fails Ed25519 rather than being
    // reported as "no trusted pubkey".
    const rotation = WHISPER_PUBKEYS.find((k) => k.role === 'rotation')!
    const rotationKeyId = Buffer.from(rotation.publicKey, 'base64').subarray(2, 10)
    const sigFile = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const lines = sigFile.split(/\r?\n/)
    const raw = Buffer.from(lines[1], 'base64')
    rotationKeyId.copy(raw, 2)
    lines[1] = raw.toString('base64')
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await writeFile(sigPath, lines.join('\n'))
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({ code: 'ed25519-rejected' })
  })

  it('does not import node crypto (BoringSSL has no BLAKE2b)', async () => {
    const source = await readFile(join(__dirname, 'verifyManifest.ts'), 'utf8')
    expect(source).not.toMatch(/(from\s+|require\(\s*|import\(\s*)['"](node:)?crypto['"]/)
  })

  it('verifies a prehashed signature when the runtime has no native BLAKE2b (BoringSSL)', async () => {
    expect(() => createHash('blake2b512')).toThrow('Digest method not supported')
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await copyFile(FIXTURE_SIGNATURE_PATH, sigPath)
    const result = await verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    expect(result.valid).toBe(true)
    expect(result.signingKeyRole).toBe('primary')
  })

  it('still rejects a tampered manifest without native BLAKE2b', async () => {
    await writeFile(manifestPath, 'tampered')
    await copyFile(FIXTURE_SIGNATURE_PATH, sigPath)
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({ code: 'ed25519-rejected' })
  })

  it('skips a malformed embedded pubkey and verifies against the next valid one', async () => {
    // A too-short base64 pubkey makes parsePubkey throw on its length check; the
    // verifier must catch it, `continue`, and still match the real primary key.
    // Covers the malformed-pubkey skip branch + the PUBKEY_LEN mismatch throw.
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await copyFile(FIXTURE_SIGNATURE_PATH, sigPath)
    const withMalformed = [
      { ...WHISPER_PUBKEYS[0], publicKey: 'Zm9v' }, // "foo" — 3 bytes, not 42
      ...WHISPER_PUBKEYS
    ]
    const result = await verifyManifest({
      contentPath: manifestPath,
      signaturePath: sigPath,
      trustedPubkeys: withMalformed
    })
    expect(result.valid).toBe(true)
    expect(result.signingKeyRole).toBe('primary')
  })

  it('trusts any pubkey in the list — primary match still wins when primary signed', async () => {
    // Both pubkeys embedded; signature is signed by primary. The verifier
    // scans the list, returns the one that matches by key ID.
    const reordered = [WHISPER_PUBKEYS[1], WHISPER_PUBKEYS[0]] // rotation first
    await copyFile(FIXTURE_MANIFEST_PATH, manifestPath)
    await copyFile(FIXTURE_SIGNATURE_PATH, sigPath)
    const result = await verifyManifest({
      contentPath: manifestPath,
      signaturePath: sigPath,
      trustedPubkeys: reordered
    })
    expect(result.valid).toBe(true)
    expect(result.signingKeyRole).toBe('primary')
  })
})

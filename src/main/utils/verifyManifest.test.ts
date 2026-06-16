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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { WHISPER_PUBKEYS } from '../services/whisper-pubkeys'
import { verifyManifest } from './verifyManifest'

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

  it('rejects a malformed signature file (< 2 lines)', async () => {
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
      'untrusted comment: custom\nZm9v\n' // base64 "foo" — 3 bytes, way short
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
    await writeFile(sigPath, `untrusted comment: custom\n${base64}\n`)
    await expect(
      verifyManifest({ contentPath: manifestPath, signaturePath: sigPath })
    ).rejects.toMatchObject({
      code: 'unsupported-algorithm'
    })
  })

  it('accepts prehashed ("ED") signatures — the minisign >= 0.7 default', async () => {
    // Our CI-produced fixture IS prehashed. This test re-asserts the
    // branch was exercised (future-proofing if we ever switch to legacy).
    const sigContent = await readFile(FIXTURE_SIGNATURE_PATH, 'utf8')
    const payloadB64 = sigContent.split(/\r?\n/)[1]
    const raw = Buffer.from(payloadB64, 'base64')
    expect(raw[0]).toBe(0x45) // E
    expect(raw[1]).toBe(0x44) // D — prehashed
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

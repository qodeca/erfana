// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { verifyBinary, MEDIA_BINARY_MIN_BYTES, cacheNativeFfmpeg } = require('./ensure-media-binaries.js')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

let dir
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'erfana-media-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('verifyBinary', () => {
  it('passes for a binary at/above the minimum size (no SHA pin)', () => {
    const p = join(dir, 'big')
    writeFileSync(p, Buffer.alloc(MEDIA_BINARY_MIN_BYTES))
    expect(() => verifyBinary(p, 'ffmpeg')).not.toThrow()
  })

  it('throws for a too-small stub', () => {
    const p = join(dir, 'stub')
    writeFileSync(p, 'not a real binary')
    expect(() => verifyBinary(p, 'ffmpeg')).toThrow(/too small|missing/i)
  })

  it('throws for an absent file', () => {
    expect(() => verifyBinary(join(dir, 'nope'), 'ffmpeg')).toThrow(/missing/i)
  })

  it('passes when the SHA-256 pin matches', () => {
    const p = join(dir, 'pinned-ok')
    const buf = Buffer.alloc(MEDIA_BINARY_MIN_BYTES, 7)
    writeFileSync(p, buf)
    expect(() => verifyBinary(p, 'ffmpeg', MEDIA_BINARY_MIN_BYTES, sha256(buf))).not.toThrow()
  })

  it('throws when the SHA-256 pin does not match', () => {
    const p = join(dir, 'pinned-bad')
    writeFileSync(p, Buffer.alloc(MEDIA_BINARY_MIN_BYTES, 7))
    expect(() =>
      verifyBinary(p, 'ffmpeg', MEDIA_BINARY_MIN_BYTES, 'deadbeef'.repeat(8))
    ).toThrow(/integrity|sha/i)
  })
})

describe('cacheNativeFfmpeg', () => {
  it('copies a present native binary into the cache dest and returns it', () => {
    const staticBin = join(dir, 'native-ffmpeg.exe')
    writeFileSync(staticBin, Buffer.alloc(MEDIA_BINARY_MIN_BYTES, 9))
    const dest = join(dir, 'cache', 'win32-arm64', 'ffmpeg.exe')
    const out = cacheNativeFfmpeg(staticBin, dest, 'win32-arm64')
    expect(out).toBe(dest)
    expect(() => verifyBinary(dest, 'win32-arm64')).not.toThrow()
  })

  it('throws a remediation-pointing error when the native binary is absent', () => {
    const staticBin = join(dir, 'does-not-exist.exe')
    const dest = join(dir, 'cache2', 'ffmpeg.exe')
    expect(() => cacheNativeFfmpeg(staticBin, dest, 'win32-arm64')).toThrow(
      /npm install|fetch-ffmpeg-arm64/i
    )
  })
})

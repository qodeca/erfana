// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  isTargetPlatform,
  sha256File,
  assertArchiveSha,
  findExe,
  ARCHIVE_SHA256,
} = require('./fetch-ffmpeg-arm64.mjs')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

let dir
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'erfana-fetch-')) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

describe('isTargetPlatform', () => {
  it('is true only for win32 + arm64', () => {
    expect(isTargetPlatform('win32', 'arm64')).toBe(true)
    expect(isTargetPlatform('win32', 'x64')).toBe(false)
    expect(isTargetPlatform('darwin', 'arm64')).toBe(false)
    expect(isTargetPlatform('linux', 'arm64')).toBe(false)
  })
})

describe('assertArchiveSha', () => {
  it('passes when the hash matches', () => {
    const p = join(dir, 'a.bin')
    const buf = Buffer.from('hello world')
    writeFileSync(p, buf)
    expect(() => assertArchiveSha(p, sha256(buf))).not.toThrow()
    expect(sha256File(p)).toBe(sha256(buf))
  })
  it('throws on mismatch', () => {
    const p = join(dir, 'b.bin')
    writeFileSync(p, Buffer.from('hello world'))
    expect(() => assertArchiveSha(p, 'deadbeef'.repeat(8))).toThrow(/mismatch/i)
  })
  it('exposes the real pinned archive hash as the default', () => {
    expect(ARCHIVE_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('findExe', () => {
  it('finds a nested binary case-insensitively', () => {
    const root = join(dir, 'tree')
    mkdirSync(join(root, 'ffmpeg-x', 'bin'), { recursive: true })
    writeFileSync(join(root, 'ffmpeg-x', 'bin', 'ffmpeg.exe'), 'x')
    writeFileSync(join(root, 'ffmpeg-x', 'bin', 'ffprobe.exe'), 'x')
    expect(findExe(root, 'FFMPEG.EXE')).toContain('ffmpeg.exe')
    expect(findExe(root, 'ffprobe.exe')).toContain('ffprobe.exe')
  })
  it('returns null when absent', () => {
    const root = join(dir, 'empty')
    mkdirSync(root, { recursive: true })
    expect(findExe(root, 'ffmpeg.exe')).toBeNull()
  })
})

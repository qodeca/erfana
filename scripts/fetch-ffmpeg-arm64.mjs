// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/* global fetch */
/**
 * Provision native Windows-ARM64 ffmpeg + ffprobe.
 *
 * ffmpeg-static / ffprobe-static publish NO win32-arm64 binary, so on a
 * Windows-on-ARM host their installers 404 and both `npm run dev` and the
 * packaged runtime hit `spawn ffmpeg ENOENT`. This script downloads a pinned,
 * SHA-verified native arm64 build from tordona/ffmpeg-win-arm64 and drops
 * ffmpeg.exe / ffprobe.exe where the runtime resolvers
 * (src/main/utils/mediaBinaries.ts) already look. Clean no-op on every other
 * platform, so it is safe to run from `postinstall` unconditionally.
 *
 * Re-pinning: bump TAG + ASSET + ARCHIVE_SHA256 together. Get the hash from the
 * release's `<asset>.sha256` companion file. See docs/build/windows.md.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'

const require = createRequire(import.meta.url)

export const TAG = '8.1.2'
export const ASSET = `ffmpeg-${TAG}-full-static-win-arm64.7z`
export const ARCHIVE_SHA256 =
  '8af8143ded6804721f6c884f05525c956a5b69809df94dd1036ae90b84614981'
export const DOWNLOAD_URL =
  `https://github.com/tordona/ffmpeg-win-arm64/releases/download/${TAG}/${ASSET}`

/** Size floor guarding against a stub/truncated exe (real ffmpeg is 10s of MB). */
export const MIN_EXE_BYTES = 1_000_000

export function isTargetPlatform(platform = process.platform, arch = process.arch) {
  return platform === 'win32' && arch === 'arm64'
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function assertArchiveSha(file, expected = ARCHIVE_SHA256) {
  const got = sha256File(file)
  if (got !== expected) {
    throw new Error(
      `Archive SHA-256 mismatch for ${file}: expected ${expected}, got ${got}`
    )
  }
}

/** Recursively find the first file whose basename equals `name` (case-insensitive). */
export function findExe(root, name) {
  const wanted = name.toLowerCase()
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.toLowerCase() === wanted) return full
    }
  }
  return null
}

/** node_modules/ffmpeg-static/ffmpeg.exe */
export function ffmpegDest() {
  const dir = path.dirname(require.resolve('ffmpeg-static/package.json'))
  return path.join(dir, 'ffmpeg.exe')
}

/** node_modules/ffprobe-static/bin/win32/arm64/ffprobe.exe */
export function ffprobeDest() {
  const dir = path.dirname(require.resolve('ffprobe-static/package.json'))
  return path.join(dir, 'bin', 'win32', 'arm64', 'ffprobe.exe')
}

function extract7z(archive, outDir) {
  // 7zip-bin ships with electron-builder; 7za reads .7z natively. Only a
  // missing module falls back to tar — an actual extraction failure must
  // surface, not be masked by a second attempt with a misleading message.
  let path7za
  try {
    ;({ path7za } = require('7zip-bin'))
  } catch (err) {
    console.warn(
      `⚠️  7zip-bin unavailable (${err.message}); falling back to tar (bsdtar reads .7z on Windows 11)`
    )
    execFileSync('tar', ['-xf', archive, '-C', outDir], { stdio: 'inherit' })
    return
  }
  execFileSync(path7za, ['x', archive, `-o${outDir}`, '-y'], { stdio: 'inherit' })
}

async function main() {
  if (!isTargetPlatform()) return // silent no-op off arm64-win

  const ffmpegOut = ffmpegDest()
  const ffprobeOut = ffprobeDest()
  const present = (p) => {
    try {
      return fs.statSync(p).size >= MIN_EXE_BYTES
    } catch {
      return false
    }
  }
  if (present(ffmpegOut) && present(ffprobeOut)) {
    console.log('✅ native arm64 ffmpeg/ffprobe already present — skipping')
    return
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erfana-ffmpeg-arm64-'))
  try {
    const archive = path.join(tmp, ASSET)
    console.log(`⬇️  downloading ${DOWNLOAD_URL}`)
    const res = await fetch(DOWNLOAD_URL) // follows the release-assets redirect
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()))

    assertArchiveSha(archive)
    console.log('✅ archive SHA-256 verified')

    const ex = path.join(tmp, 'x')
    fs.mkdirSync(ex, { recursive: true })
    extract7z(archive, ex)

    const ffmpegSrc = findExe(ex, 'ffmpeg.exe')
    const ffprobeSrc = findExe(ex, 'ffprobe.exe')
    if (!ffmpegSrc || !ffprobeSrc) {
      throw new Error(`Extracted archive missing ffmpeg.exe/ffprobe.exe under ${ex}`)
    }
    fs.mkdirSync(path.dirname(ffmpegOut), { recursive: true })
    fs.mkdirSync(path.dirname(ffprobeOut), { recursive: true })
    fs.copyFileSync(ffmpegSrc, ffmpegOut)
    fs.copyFileSync(ffprobeSrc, ffprobeOut)
    for (const [label, p] of [
      ['ffmpeg', ffmpegOut],
      ['ffprobe', ffprobeOut]
    ]) {
      const size = fs.statSync(p).size
      if (size < MIN_EXE_BYTES) {
        throw new Error(`Installed ${label} is implausibly small (${size} bytes) at ${p}`)
      }
    }
    console.log(`✅ installed native arm64 ffmpeg  → ${ffmpegOut}`)
    console.log(`✅ installed native arm64 ffprobe → ${ffprobeOut}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`❌ fetch-ffmpeg-arm64 failed: ${err.message}`)
    process.exit(1)
  })
}

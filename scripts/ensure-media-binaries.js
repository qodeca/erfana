// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Electron `beforePack` Hook — cache the correct ffmpeg binary per architecture.
 *
 * Why: ffmpeg-static downloads a single host-arch binary in a postinstall step
 * that CI skips (`npm ci --ignore-scripts`); a packaged build could ship
 * without it (the v0.9.6 ENOENT regression) or with the wrong arch (the macOS
 * release builds both x64 and arm64 in one job). This hook downloads each arch
 * Erfana targets into a build cache, verified by size AND a pinned SHA-256.
 * The matching arch is then copied into each bundle by the afterPack hook
 * (scripts/fuses.js), so every dmg carries exactly its own current ffmpeg and
 * afterPack performs no network I/O.
 *
 * ffprobe-static vendors all arches in-package, so it only needs verifying.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

/** ffmpeg is ~45-79MB; guards against a stub / text placeholder. */
const MEDIA_BINARY_MIN_BYTES = 1_000_000

/**
 * SHA-256 pins for ffmpeg-static@5.3.0 (ffmpeg 6.0) per platform-arch.
 * Recompute with: npm_config_arch=<arch> node node_modules/ffmpeg-static/install.js
 * then `shasum -a 256 node_modules/ffmpeg-static/ffmpeg`. A missing pin falls
 * back to size-only verification (so a newly-targeted arch never silently
 * blocks a build), but every shipped Mac arch is pinned here.
 */
const FFMPEG_SHA256 = {
  'darwin-x64': 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
  'darwin-arm64': 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584'
  // 'win32-x64': '…', 'linux-x64': '…'  — add when those legs are built/pinned
}

// Overridable via env for tests / CI; defaults under the (gitignored) release dir.
const CACHE_ROOT = process.env.ERFANA_MEDIA_CACHE || path.join(process.cwd(), 'release', '.media-cache')

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/**
 * Assert a binary exists, meets the size floor, and (when a pin is supplied)
 * matches its SHA-256.
 * @throws if missing, too small, or hash mismatch.
 */
function verifyBinary(file, label, minBytes = MEDIA_BINARY_MIN_BYTES, expectedSha) {
  let size
  try {
    size = fs.statSync(file).size
  } catch {
    throw new Error(`${label} binary missing at ${file}. Refusing to build a broken bundle.`)
  }
  if (size < minBytes) {
    throw new Error(`${label} binary too small (${size} bytes) at ${file}.`)
  }
  if (expectedSha) {
    const got = sha256(file)
    if (got !== expectedSha) {
      throw new Error(`${label} integrity check failed at ${file}: expected ${expectedSha}, got ${got}`)
    }
  }
  return file
}

/** Path to ffmpeg-static's single downloaded binary. */
function ffmpegStaticBinary(platform) {
  const dir = path.dirname(require.resolve('ffmpeg-static/package.json'))
  return path.join(dir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

/**
 * Download one arch via ffmpeg-static's installer (honors npm_config_arch) and
 * copy it into the per-arch build cache, verified against its pin.
 * @returns the cache path.
 */
function cacheFfmpegArch(platform, arch) {
  const key = `${platform}-${arch}`
  const dest = path.join(CACHE_ROOT, key, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (fs.existsSync(dest)) {
    verifyBinary(dest, key, MEDIA_BINARY_MIN_BYTES, FFMPEG_SHA256[key])
    return dest
  }
  const installer = path.join(path.dirname(require.resolve('ffmpeg-static/package.json')), 'install.js')
  const staticBin = ffmpegStaticBinary(platform)
  fs.rmSync(staticBin, { force: true })
  console.log(`⬇️  downloading ffmpeg for ${key}...`)
  execFileSync(process.execPath, [installer], {
    stdio: 'inherit',
    env: { ...process.env, npm_config_arch: arch, npm_config_platform: platform }
  })
  verifyBinary(staticBin, key, MEDIA_BINARY_MIN_BYTES, FFMPEG_SHA256[key])
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(staticBin, dest)
  console.log(`✅ cached ffmpeg for ${key}`)
  return dest
}

async function beforePack(context) {
  const platform = (context && context.electronPlatformName) || process.platform
  console.log(`🔧 ensure-media-binaries: caching ffmpeg for ${platform}`)
  // macOS builds both arches in one job; other platforms ship the host arch.
  const arches = platform === 'darwin' ? ['x64', 'arm64'] : [process.arch]
  for (const arch of arches) cacheFfmpegArch(platform, arch)
  // Leave the host-arch binary in node_modules for dev runtime / `npm run dev`.
  cacheFfmpegArch(platform, process.arch)
  // ffprobe-static vendors all arches in-package; just confirm it resolves.
  verifyBinary(require('ffprobe-static').path, 'ffprobe')
}

module.exports = beforePack
module.exports.verifyBinary = verifyBinary
module.exports.cacheFfmpegArch = cacheFfmpegArch
module.exports.ffmpegStaticBinary = ffmpegStaticBinary
module.exports.MEDIA_BINARY_MIN_BYTES = MEDIA_BINARY_MIN_BYTES
module.exports.FFMPEG_SHA256 = FFMPEG_SHA256
module.exports.CACHE_ROOT = CACHE_ROOT

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Central resolution of the bundled ffmpeg/ffprobe binary paths.
 *
 * ffmpeg-static's default export is a path string, or `null` when
 * `process.arch` is outside its per-platform allow-list — on win32 that
 * allow-list is `['x64', 'ia32']`, so it returns `null` on win32-arm64 even
 * though `scripts/fetch-ffmpeg-arm64.mjs` has already placed a real
 * `ffmpeg.exe` alongside it (see that script's doc comment). We recover that
 * path by resolving the ffmpeg-static package directory and looking for the
 * exe it dropped there. ffprobe-static has no such allow-list — it computes
 * its path unconditionally for every arch it vendors — so ffprobe needs no
 * fallback.
 *
 * Both are placed/verified per-arch by the build hooks
 * (scripts/ensure-media-binaries.js + scripts/fuses.js) and, on win32-arm64,
 * by the postinstall step (scripts/fetch-ffmpeg-arm64.mjs).
 *
 * Single source of truth so the two consumers (AudioExtractionService,
 * LocalWhisperService) cannot drift.
 */
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Recover the win32-arm64 ffmpeg.exe path that fetch-ffmpeg-arm64.mjs
 * installs into the ffmpeg-static package directory, when ffmpeg-static's
 * own resolution returned null (its arch allow-list omits arm64 on win32).
 */
function resolveArm64FfmpegFallback(): string | undefined {
  if (process.platform !== 'win32' || process.arch !== 'arm64') return undefined
  try {
    const candidate = join(dirname(require.resolve('ffmpeg-static/package.json')), 'ffmpeg.exe')
    return existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

export const ffmpegPath: string | undefined = ffmpegStatic ?? resolveArm64FfmpegFallback()
export const ffprobePath: string | undefined = ffprobeStatic?.path ?? undefined

/** True when both ffmpeg and ffprobe binaries resolved. */
export const mediaBinariesAvailable = (): boolean => !!ffmpegPath && !!ffprobePath

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Central resolution of the bundled ffmpeg/ffprobe binary paths.
 *
 * Development: the packages' own answer (a path in the repo's node_modules).
 * ffmpeg-static's default export is a path string (or null) and never throws,
 * so importing it is safe at module load.
 *
 * Packaged: the path is BUILT from `process.resourcesPath`, never taken from
 * the package. Both packages compute it from `__dirname`, which points into
 * `app.asar` (the OS cannot execute that), and ffmpeg-static also honours an
 * `FFMPEG_BIN` environment variable – which would let whoever starts the app
 * choose the binary it runs. The real files live in
 * `Resources/app.asar.unpacked/` (`asarUnpack` in electron-builder.yml), and
 * the build hooks place and verify them per arch (scripts/ensure-media-binaries.js
 * + scripts/fuses.js).
 *
 * Single source of truth so the two consumers (AudioExtractionService,
 * LocalWhisperService) cannot drift.
 */
import { app } from 'electron'
import { join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

/** Where a packaged build keeps an unpacked file, anchored on `process.resourcesPath`. */
export function packagedUnpackedPath(resourcesPath: string, ...segments: string[]): string {
  return join(resourcesPath, 'app.asar.unpacked', 'node_modules', ...segments)
}

/** The bundled ffmpeg / ffprobe paths for this process. Exported for tests. */
export function resolveMediaBinaryPaths(
  isPackaged: boolean,
  resourcesPath: string | undefined,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): { ffmpegPath: string | undefined; ffprobePath: string | undefined } {
  // Electron always sets resourcesPath in a packaged app; only a test double lacks it.
  if (isPackaged && typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    const exe = platform === 'win32' ? '.exe' : ''
    return {
      ffmpegPath: packagedUnpackedPath(resourcesPath, 'ffmpeg-static', `ffmpeg${exe}`),
      ffprobePath: packagedUnpackedPath(resourcesPath, 'ffprobe-static', 'bin', platform, arch, `ffprobe${exe}`)
    }
  }
  return {
    ffmpegPath: ffmpegStatic ?? undefined,
    ffprobePath: ffprobeStatic?.path ?? undefined
  }
}

const resolved = resolveMediaBinaryPaths(app.isPackaged, process.resourcesPath)

export const ffmpegPath: string | undefined = resolved.ffmpegPath
export const ffprobePath: string | undefined = resolved.ffprobePath

/** True when both ffmpeg and ffprobe binaries resolved. */
export const mediaBinariesAvailable = (): boolean => !!ffmpegPath && !!ffprobePath

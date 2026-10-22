// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Central resolution of the bundled ffmpeg/ffprobe binary paths.
 *
 * ffmpeg-static's default export is a path string (or null) and never throws,
 * so importing it is safe at module load. ffprobe-static vendors all arches
 * in-package. Both are placed/verified per-arch by the build hooks
 * (scripts/ensure-media-binaries.js + scripts/fuses.js).
 *
 * Single source of truth so the two consumers (AudioExtractionService,
 * LocalWhisperService) cannot drift.
 */
import { sep } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const ASAR_SEGMENT = `${sep}app.asar${sep}`
const UNPACKED_SEGMENT = `${sep}app.asar.unpacked${sep}`

/**
 * Map a path inside `app.asar` to its real-file copy in `app.asar.unpacked`.
 *
 * Both packages compute their binary path from `__dirname`, which in a packaged
 * build points INTO the archive. Electron's fs shim can read such a path, but
 * the OS cannot exec it: `spawn` needs the real file, which electron-builder
 * puts under `app.asar.unpacked/` (`asarUnpack` in electron-builder.yml).
 * Only the first `app.asar` directory segment is rewritten, so a path that
 * merely contains the text elsewhere, or a dev path with no archive, is
 * returned unchanged.
 */
export function toUnpackedPath(p: string): string {
  return p.includes(ASAR_SEGMENT) ? p.replace(ASAR_SEGMENT, UNPACKED_SEGMENT) : p
}

export const ffmpegPath: string | undefined = ffmpegStatic ? toUnpackedPath(ffmpegStatic) : undefined
export const ffprobePath: string | undefined = ffprobeStatic?.path
  ? toUnpackedPath(ffprobeStatic.path)
  : undefined

/** True when both ffmpeg and ffprobe binaries resolved. */
export const mediaBinariesAvailable = (): boolean => !!ffmpegPath && !!ffprobePath

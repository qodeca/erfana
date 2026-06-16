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
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

export const ffmpegPath: string | undefined = ffmpegStatic ?? undefined
export const ffprobePath: string | undefined = ffprobeStatic?.path ?? undefined

/** True when both ffmpeg and ffprobe binaries resolved. */
export const mediaBinariesAvailable = (): boolean => !!ffmpegPath && !!ffprobePath

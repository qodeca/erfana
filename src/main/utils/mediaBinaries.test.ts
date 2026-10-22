// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { join, sep } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('ffmpeg-static', () => ({ default: '/repo/node_modules/ffmpeg-static/ffmpeg' }))
vi.mock('ffprobe-static', () => ({
  default: { path: '/repo/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe' }
}))

import {
  ffmpegPath,
  ffprobePath,
  mediaBinariesAvailable,
  packagedUnpackedPath,
  resolveMediaBinaryPaths
} from './mediaBinaries'

const RESOURCES = join(sep, 'Applications', 'Erfana.app', 'Contents', 'Resources')

describe('resolveMediaBinaryPaths', () => {
  it('builds packaged paths from resourcesPath into app.asar.unpacked (macOS)', () => {
    expect(resolveMediaBinaryPaths(true, RESOURCES, 'darwin', 'arm64')).toEqual({
      ffmpegPath: join(RESOURCES, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg'),
      ffprobePath: join(RESOURCES, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin', 'darwin', 'arm64', 'ffprobe')
    })
  })

  it('adds .exe on Windows', () => {
    const res = join(sep, 'Erfana', 'resources')
    const paths = resolveMediaBinaryPaths(true, res, 'win32', 'x64')
    expect(paths.ffmpegPath).toBe(join(res, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'))
    expect(paths.ffprobePath).toBe(
      join(res, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe')
    )
  })

  it('ignores FFMPEG_BIN and the package answer in a packaged build', () => {
    vi.stubEnv('FFMPEG_BIN', '/tmp/evil-ffmpeg')
    try {
      const paths = resolveMediaBinaryPaths(true, RESOURCES, 'darwin', 'arm64')
      expect(paths.ffmpegPath).not.toContain('evil')
      expect(paths.ffmpegPath).not.toBe('/repo/node_modules/ffmpeg-static/ffmpeg')
      expect(paths.ffmpegPath?.startsWith(RESOURCES)).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('uses the packages in development', () => {
    expect(resolveMediaBinaryPaths(false, RESOURCES)).toEqual({
      ffmpegPath: '/repo/node_modules/ffmpeg-static/ffmpeg',
      ffprobePath: '/repo/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe'
    })
  })

  it('anchors packagedUnpackedPath on resourcesPath', () => {
    expect(packagedUnpackedPath(RESOURCES, 'a', 'b')).toBe(join(RESOURCES, 'app.asar.unpacked', 'node_modules', 'a', 'b'))
  })
})

describe('module-level paths (unpackaged test process)', () => {
  it('come from the packages', () => {
    expect(ffmpegPath).toBe('/repo/node_modules/ffmpeg-static/ffmpeg')
    expect(ffprobePath).toBe('/repo/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe')
    expect(mediaBinariesAvailable()).toBe(true)
  })
})

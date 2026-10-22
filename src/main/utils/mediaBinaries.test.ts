// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { join, sep } from 'path'
import { describe, expect, it, vi } from 'vitest'

const { RESOURCES } = await vi.hoisted(async () => {
  const { join: j, sep: s } = await import('path')
  return { RESOURCES: j(s, 'Applications', 'Erfana.app', 'Contents', 'Resources') }
})

vi.mock('ffmpeg-static', () => ({
  default: join(RESOURCES, 'app.asar', 'node_modules', 'ffmpeg-static', 'ffmpeg')
}))
vi.mock('ffprobe-static', () => ({
  default: { path: join(RESOURCES, 'app.asar', 'node_modules', 'ffprobe-static', 'bin', 'darwin', 'arm64', 'ffprobe') }
}))

import { ffmpegPath, ffprobePath, mediaBinariesAvailable, toUnpackedPath } from './mediaBinaries'

describe('toUnpackedPath', () => {
  it('maps a path inside app.asar to its real-file copy in app.asar.unpacked', () => {
    expect(toUnpackedPath(join(RESOURCES, 'app.asar', 'node_modules', 'x', 'bin'))).toBe(
      join(RESOURCES, 'app.asar.unpacked', 'node_modules', 'x', 'bin')
    )
  })

  it('leaves a dev path (no archive) unchanged', () => {
    const dev = join(sep, 'repo', 'node_modules', 'ffmpeg-static', 'ffmpeg')
    expect(toUnpackedPath(dev)).toBe(dev)
  })

  it('does not rewrite an already-unpacked path or a name that only contains the text', () => {
    const unpacked = join(RESOURCES, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg')
    expect(toUnpackedPath(unpacked)).toBe(unpacked)
    const lookalike = join(sep, 'home', 'my-app.asar-notes', 'ffmpeg')
    expect(toUnpackedPath(lookalike)).toBe(lookalike)
  })

  it('rewrites only the first archive segment', () => {
    const nested = join(RESOURCES, 'app.asar', 'node_modules', 'app.asar', 'f')
    expect(toUnpackedPath(nested)).toBe(join(RESOURCES, 'app.asar.unpacked', 'node_modules', 'app.asar', 'f'))
  })
})

describe('bundled media binary paths', () => {
  it('resolve to app.asar.unpacked, where the OS can execute them', () => {
    expect(ffmpegPath).toBe(join(RESOURCES, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg'))
    expect(ffprobePath).toBe(
      join(RESOURCES, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin', 'darwin', 'arm64', 'ffprobe')
    )
    expect(mediaBinariesAvailable()).toBe(true)
  })
})

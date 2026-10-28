// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * mediaBinaries.arm64.test.ts
 *
 * ffmpeg-static's default export is null when process.arch is outside its
 * per-platform allow-list; on win32 that allow-list omits arm64. This file
 * verifies mediaBinaries.ts recovers the win32-arm64 ffmpeg.exe path that
 * scripts/fetch-ffmpeg-arm64.mjs places in the ffmpeg-static package dir —
 * without depending on the real host platform/arch, since CI runs on
 * ubuntu-latest / macos-latest / windows-latest (x64), never win32-arm64.
 *
 * Split into its own file (rather than living in mediaBinaries.test.ts)
 * because the module under test resolves
 * its exports at import time, so every case needs vi.resetModules() +
 * a fresh dynamic import under mocked process.platform/process.arch —
 * mirrors the module-reset pattern used by src/main/menu.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// This test file runs under vitest/vite-node (ESM), unlike src/main source
// files which build to CJS — createRequire is the correct way to resolve a
// package path here (see mediaBinaries.ts's own doc comment for why the
// *source* uses bare require.resolve instead).
vi.mock('electron', () => ({ app: { isPackaged: false } }))

const nodeRequire = createRequire(import.meta.url)
const REAL_FFMPEG_STATIC_DIR = dirname(nodeRequire.resolve('ffmpeg-static/package.json'))

const ORIGINAL_PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform')!
const ORIGINAL_ARCH = Object.getOwnPropertyDescriptor(process, 'arch')!

function setPlatformArch(platform: string, arch: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  Object.defineProperty(process, 'arch', { value: arch, configurable: true })
}

describe('mediaBinaries win32-arm64 fallback', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('ffmpeg-static')
    vi.doUnmock('ffprobe-static')
    vi.doUnmock('node:fs')
    Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM)
    Object.defineProperty(process, 'arch', ORIGINAL_ARCH)
  })

  it('resolves the package-dir ffmpeg.exe when win32-arm64 and the file exists', async () => {
    setPlatformArch('win32', 'arm64')

    vi.doMock('ffmpeg-static', () => ({ default: null }))
    vi.doMock('ffprobe-static', () => ({ default: { path: 'C:\\ffprobe.exe' } }))
    vi.doMock('node:fs', () => ({ existsSync: vi.fn(() => true) }))

    const mod = await import('./mediaBinaries')

    expect(mod.ffmpegPath).toBe(join(REAL_FFMPEG_STATIC_DIR, 'ffmpeg.exe'))
    expect(mod.ffprobePath).toBe('C:\\ffprobe.exe')
    expect(mod.mediaBinariesAvailable()).toBe(true)
  })

  it('returns undefined when win32-arm64 and the fallback file is absent', async () => {
    setPlatformArch('win32', 'arm64')

    vi.doMock('ffmpeg-static', () => ({ default: null }))
    vi.doMock('ffprobe-static', () => ({ default: { path: 'C:\\ffprobe.exe' } }))
    vi.doMock('node:fs', () => ({ existsSync: vi.fn(() => false) }))

    const mod = await import('./mediaBinaries')

    expect(mod.ffmpegPath).toBeUndefined()
    expect(mod.mediaBinariesAvailable()).toBe(false)
  })

  it('does not take the fallback when ffmpeg-static already resolved a real path', async () => {
    setPlatformArch('win32', 'x64')

    vi.doMock('ffmpeg-static', () => ({ default: 'C:\\real\\ffmpeg.exe' }))
    vi.doMock('ffprobe-static', () => ({ default: { path: 'C:\\ffprobe.exe' } }))
    vi.doMock('node:fs', () => ({ existsSync: vi.fn(() => true) }))

    const mod = await import('./mediaBinaries')

    expect(mod.ffmpegPath).toBe('C:\\real\\ffmpeg.exe')
    expect(mod.mediaBinariesAvailable()).toBe(true)
  })
})

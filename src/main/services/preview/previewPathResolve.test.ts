// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `node:fs/promises` is mocked so we can (a) observe every FileHandle.close()
 * and (b) force a dev/ino mismatch that is otherwise unreachable without a race.
 * Everything except `open` and `lstat` passes straight through to the real
 * implementation, so realpath/symlink/write behaviour is genuine.
 */
const closeSpies: Array<ReturnType<typeof vi.fn>> = []
let lstatOverride: ((path: string) => Promise<{ dev: number; ino: number }>) | null = null

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      const realClose = handle.close.bind(handle)
      const spy = vi.fn(() => realClose())
      // Override the instance method purely to observe closing.
      ;(handle as unknown as { close: typeof spy }).close = spy
      closeSpies.push(spy)
      return handle
    },
    lstat: ((path: string, ...rest: unknown[]) =>
      lstatOverride
        ? lstatOverride(path)
        : (actual.lstat as (...a: unknown[]) => unknown)(
            path,
            ...rest
          )) as typeof actual.lstat
  }
})

// Shrink the asset cap so a 413 is reachable without a 25 MB fixture. The
// literal is inlined inside the factory because vi.mock is hoisted above any
// module-level const; MOCK_MAX_ASSET_BYTES mirrors it for the test bodies.
const MOCK_MAX_ASSET_BYTES = 64
vi.mock('../../../shared/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/constants')>()
  return {
    ...actual,
    PREVIEW: { ...actual.PREVIEW, MAX_ASSET_BYTES: 64 }
  }
})

import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { confinePath, isSafeSegment, resolveConfined } from './previewPathResolve'

let root: string
let realRoot: string
let outside: string
let realOutside: string

beforeEach(async () => {
  closeSpies.length = 0
  lstatOverride = null
  root = await mkdtemp(join(tmpdir(), 'preview-root-'))
  realRoot = await realpath(root)
  outside = await mkdtemp(join(tmpdir(), 'preview-out-'))
  realOutside = await realpath(outside)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('isSafeSegment', () => {
  it('rejects empty, dot and dotdot segments', () => {
    expect(isSafeSegment('')).toBe(false)
    expect(isSafeSegment('.')).toBe(false)
    expect(isSafeSegment('..')).toBe(false)
  })

  it('rejects NUL and separators', () => {
    expect(isSafeSegment('a\0b')).toBe(false)
    expect(isSafeSegment('a/b')).toBe(false)
    expect(isSafeSegment('a\\b')).toBe(false)
  })

  it('accepts a normal filename segment', () => {
    expect(isSafeSegment('index.html')).toBe(true)
    expect(isSafeSegment('style.css')).toBe(true)
  })

  it('rejects 8.3 short-name aliases only on win32', () => {
    expect(isSafeSegment('ENV~1', 'win32')).toBe(false)
    expect(isSafeSegment('ENV~1', 'darwin')).toBe(true)
  })
})

describe('confinePath', () => {
  it('accepts an in-root file and returns its relative path', async () => {
    await writeFile(join(realRoot, 'index.html'), '<h1>ok</h1>')
    const verdict = await confinePath(realRoot, join(realRoot, 'index.html'))
    expect(verdict).toEqual({
      ok: true,
      realTarget: join(realRoot, 'index.html'),
      rel: 'index.html'
    })
  })

  it('reports missing for a non-existent parent', async () => {
    const verdict = await confinePath(realRoot, join(realRoot, 'nope', 'x.html'))
    expect(verdict).toEqual({ ok: false, reason: 'missing' })
  })

  it('reports excluded for a file inside an excluded directory', async () => {
    await mkdir(join(realRoot, 'node_modules'))
    await writeFile(join(realRoot, 'node_modules', 'x.js'), 'x')
    const verdict = await confinePath(realRoot, join(realRoot, 'node_modules', 'x.js'))
    expect(verdict).toEqual({ ok: false, reason: 'excluded' })
  })

  it('reports escape when an intermediate directory symlinks outside the root', async () => {
    await writeFile(join(realOutside, 'secret.txt'), 'secret')
    await symlink(realOutside, join(realRoot, 'linkdir'), 'dir')
    const verdict = await confinePath(realRoot, join(realRoot, 'linkdir', 'secret.txt'))
    expect(verdict).toEqual({ ok: false, reason: 'escape' })
  })
})

describe('resolveConfined', () => {
  it('serves an in-root file and closes the descriptor', async () => {
    await writeFile(join(realRoot, 'index.html'), '<h1>hi</h1>')
    const result = await resolveConfined(realRoot, ['index.html'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.body.toString('utf8')).toBe('<h1>hi</h1>')
      expect(result.ext).toBe('.html')
    }
    expect(closeSpies).toHaveLength(1)
    expect(closeSpies[0]).toHaveBeenCalledTimes(1)
  })

  it('returns 400 for an unsafe segment', async () => {
    const result = await resolveConfined(realRoot, ['..'])
    expect(result).toEqual({ ok: false, status: 400, reason: 'path-escape' })
  })

  it('returns 404 for a missing file', async () => {
    const result = await resolveConfined(realRoot, ['ghost.html'])
    expect(result).toEqual({ ok: false, status: 404, reason: 'missing-local-file' })
  })

  it('returns 403 excluded-path for a file inside .git', async () => {
    await mkdir(join(realRoot, '.git'))
    await writeFile(join(realRoot, '.git', 'config'), '[core]')
    const result = await resolveConfined(realRoot, ['.git', 'config'])
    expect(result).toEqual({ ok: false, status: 403, reason: 'excluded-path' })
  })

  it('returns 403 path-escape when an intermediate directory symlinks outside', async () => {
    await writeFile(join(realOutside, 'secret.txt'), 'secret')
    await symlink(realOutside, join(realRoot, 'linkdir'), 'dir')
    const result = await resolveConfined(realRoot, ['linkdir', 'secret.txt'])
    expect(result).toEqual({ ok: false, status: 403, reason: 'path-escape' })
  })

  it('returns 404 for a directory (not a regular file) and closes the descriptor', async () => {
    await mkdir(join(realRoot, 'assets'))
    const result = await resolveConfined(realRoot, ['assets'])
    expect(result).toEqual({ ok: false, status: 404, reason: 'missing-local-file' })
    // The directory was opened before the isFile() check, so it must be closed.
    expect(closeSpies).toHaveLength(1)
    expect(closeSpies[0]).toHaveBeenCalledTimes(1)
  })

  it('returns 403 path-escape on a dev/ino mismatch and closes the descriptor', async () => {
    await writeFile(join(realRoot, 'index.html'), '<h1>hi</h1>')
    lstatOverride = async () => ({ dev: 0xdead, ino: 0xbeef })
    const result = await resolveConfined(realRoot, ['index.html'])
    expect(result).toEqual({ ok: false, status: 403, reason: 'path-escape' })
    expect(closeSpies).toHaveLength(1)
    expect(closeSpies[0]).toHaveBeenCalledTimes(1)
  })

  it('returns 413 when the file exceeds the cap and closes the descriptor', async () => {
    await writeFile(join(realRoot, 'big.bin'), Buffer.alloc(MOCK_MAX_ASSET_BYTES + 10, 0x41))
    const result = await resolveConfined(realRoot, ['big.bin'])
    expect(result).toEqual({ ok: false, status: 413, reason: 'asset-too-large' })
    expect(closeSpies).toHaveLength(1)
    expect(closeSpies[0]).toHaveBeenCalledTimes(1)
  })

  it('serves a file exactly at the cap boundary', async () => {
    await writeFile(join(realRoot, 'edge.bin'), Buffer.alloc(MOCK_MAX_ASSET_BYTES, 0x42))
    const result = await resolveConfined(realRoot, ['edge.bin'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.body).toHaveLength(MOCK_MAX_ASSET_BYTES)
    }
  })
})

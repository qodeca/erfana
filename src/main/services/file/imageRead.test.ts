// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the version-gated image read (issue #70).
 *
 * These run against a real temp directory: the whole point of the module is how
 * it reads `stat`, so mocking `stat` would test the mock. Only `readFile` is
 * wrapped, and only to observe WHETHER the expensive read happened - it still
 * delegates to the real implementation.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { mkdtempSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  const passthrough = actual.readFile as unknown as (...args: unknown[]) => unknown
  return {
    ...actual,
    readFile: vi.fn((...args: unknown[]) => passthrough(...args))
  }
})

import { MAX_IMAGE_SIZE, readImage } from './imageRead'

/** Bytes are never decoded here, so any payload of a known length will do. */
const PNG_BYTES = Buffer.from('first-revision')
const PNG_BASE64 = PNG_BYTES.toString('base64')

describe('readImage', () => {
  let dir: string
  let imagePath: string
  let readFileMock: Mock

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'erfana-imageread-'))
    imagePath = join(dir, 'shot.png')
    writeFileSync(imagePath, PNG_BYTES)

    const fsPromises = await import('fs/promises')
    readFileMock = fsPromises.readFile as unknown as Mock
    readFileMock.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('full read', () => {
    it('returns the bytes as a data URL with the version they belong to', async () => {
      const result = await readImage(imagePath)

      expect(result).toEqual({
        status: 'ok',
        dataUrl: `data:image/png;base64,${PNG_BASE64}`,
        version: expect.any(String)
      })
      expect(result.version).not.toBe('')
      expect(readFileMock).toHaveBeenCalledTimes(1)
    })

    it('reads even when nothing changed, if no version is offered', async () => {
      const first = await readImage(imagePath)
      readFileMock.mockClear()

      const second = await readImage(imagePath)

      expect(second.status).toBe('ok')
      expect(second.version).toBe(first.version)
      expect(readFileMock).toHaveBeenCalledTimes(1)
    })

    it('reads when the offered version belongs to an older revision', async () => {
      const stale = '1:2:3'

      const result = await readImage(imagePath, stale)

      expect(result.status).toBe('ok')
      expect(result.version).not.toBe(stale)
      expect(readFileMock).toHaveBeenCalledTimes(1)
    })

    it('maps the extension to a MIME type', async () => {
      const svgPath = join(dir, 'diagram.svg')
      writeFileSync(svgPath, '<svg />')

      const result = await readImage(svgPath)

      expect(result.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true)
    })
  })

  describe('skip path', () => {
    it('reports unchanged without reading when the version still matches', async () => {
      const first = await readImage(imagePath)
      readFileMock.mockClear()

      const second = await readImage(imagePath, first.version)

      expect(second).toEqual({ status: 'unchanged', version: first.version })
      expect(readFileMock).not.toHaveBeenCalled()
    })

    it('skips repeatedly while the file is untouched', async () => {
      const first = await readImage(imagePath)
      readFileMock.mockClear()

      for (let i = 0; i < 3; i++) {
        const result = await readImage(imagePath, first.version)
        expect(result.status).toBe('unchanged')
      }
      expect(readFileMock).not.toHaveBeenCalled()
    })
  })

  describe('changed after a skip', () => {
    it('serves the new bytes once the content changes', async () => {
      const first = await readImage(imagePath)
      const skipped = await readImage(imagePath, first.version)
      expect(skipped.status).toBe('unchanged')
      readFileMock.mockClear()

      const nextBytes = Buffer.from('second revision, different length')
      writeFileSync(imagePath, nextBytes)

      const refreshed = await readImage(imagePath, first.version)

      expect(refreshed).toEqual({
        status: 'ok',
        dataUrl: `data:image/png;base64,${nextBytes.toString('base64')}`,
        version: expect.any(String)
      })
      expect(refreshed.version).not.toBe(first.version)
      expect(readFileMock).toHaveBeenCalledTimes(1)
    })

    it('notices a rewrite that keeps the byte count identical', async () => {
      const first = await readImage(imagePath)
      expect((await readImage(imagePath, first.version)).status).toBe('unchanged')

      const sameLength = Buffer.from('FIRST-REVISION')
      expect(sameLength.length).toBe(PNG_BYTES.length)
      writeFileSync(imagePath, sameLength)
      // Push mtime forward explicitly so the assertion is about the version
      // rule, not about the filesystem's clock resolution.
      const now = Date.now() / 1000
      utimesSync(imagePath, now, now + 1)

      const refreshed = await readImage(imagePath, first.version)

      expect(refreshed.status).toBe('ok')
      expect(refreshed.version).not.toBe(first.version)
    })

    it('notices a file swapped in with the same size and mtime', async () => {
      const first = await readImage(imagePath)
      const original = statSync(imagePath)

      const replacement = join(dir, 'replacement.png')
      writeFileSync(replacement, Buffer.from('SWAPPED-REVISI'))
      utimesSync(replacement, original.atime, original.mtime)
      rmSync(imagePath)
      writeFileSync(imagePath, Buffer.from('SWAPPED-REVISI'))
      utimesSync(imagePath, original.atime, original.mtime)

      const refreshed = await readImage(imagePath, first.version)

      expect(refreshed.status).toBe('ok')
      expect(refreshed.version).not.toBe(first.version)
    })

    it('resumes skipping against the version it just handed out', async () => {
      const first = await readImage(imagePath)
      writeFileSync(imagePath, Buffer.from('a much longer second revision'))
      const refreshed = await readImage(imagePath, first.version)
      readFileMock.mockClear()

      const settled = await readImage(imagePath, refreshed.version)

      expect(settled.status).toBe('unchanged')
      expect(readFileMock).not.toHaveBeenCalled()
    })
  })

  describe('refusals', () => {
    it('rejects an unsupported extension before touching the disk', async () => {
      const notAnImage = join(dir, 'notes.md')
      writeFileSync(notAnImage, '# hi')

      await expect(readImage(notAnImage)).rejects.toThrow('Unsupported image format: .md')
      expect(readFileMock).not.toHaveBeenCalled()
    })

    it('rejects a file over the size cap, version offered or not', async () => {
      const huge = join(dir, 'huge.png')
      writeFileSync(huge, '')
      truncateSync(huge, MAX_IMAGE_SIZE + 1)

      await expect(readImage(huge)).rejects.toThrow('Image file too large')
      await expect(readImage(huge, '1:2:3')).rejects.toThrow('Image file too large')
      expect(readFileMock).not.toHaveBeenCalled()
    })

    it('propagates the stat failure for a missing file', async () => {
      await expect(readImage(join(dir, 'gone.png'))).rejects.toThrow(/ENOENT/)
      expect(readFileMock).not.toHaveBeenCalled()
    })
  })
})

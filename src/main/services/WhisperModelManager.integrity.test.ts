// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Model integrity tests for WhisperModelManager against the REAL filesystem
 * and the REAL downloadToFile (only `fetch` is stubbed). The other manager
 * test files mock fs and the downloader, so they cannot prove that wrong bytes
 * never reach the models directory.
 *
 * `tiny` is re-pinned to a tiny payload so no test needs a 75 MB file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const GOOD = Buffer.from('good-model-bytes-0123456789')
const EVIL = Buffer.from('evil-model-bytes-0123456789')
const GOOD_SHA = createHash('sha256').update(GOOD).digest('hex')

const env = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: (): string => env.userData }
}))

vi.mock('./LoggingService', () => ({
  logger: {
    trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
    warn: vi.fn(), error: vi.fn(), fatal: vi.fn()
  }
}))

vi.mock('./whisper-assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./whisper-assets')>()
  return {
    ...actual,
    MODEL_PINS: {
      ...actual.MODEL_PINS,
      tiny: {
        remoteFilename: 'ggml-tiny.bin',
        sizeBytes: 27,
        sha256: createHash('sha256').update(Buffer.from('good-model-bytes-0123456789')).digest('hex')
      }
    }
  }
})

function bytesResponse(body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { 'content-length': String(body.length) }
  })
}

/** huggingface.co 302 -> us.aws.cdn.hf.co 200, like the live host. */
function stubFetchServing(body: Buffer): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    if (new URL(url).hostname === 'huggingface.co') {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://us.aws.cdn.hf.co/xet-bridge-us/abc?sig=SECRET' }
      })
    }
    return bytesResponse(body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('WhisperModelManager model integrity (real fs)', () => {
  let modelsDir: string

  const makeManager = async () => {
    const { createWhisperModelManager } = await import('./WhisperModelManager')
    return createWhisperModelManager()
  }

  beforeEach(async () => {
    env.userData = await mkdtemp(join(tmpdir(), 'erfana-wmm-'))
    modelsDir = join(env.userData, 'whisper', 'models')
    await mkdir(modelsDir, { recursive: true })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(env.userData, { recursive: true, force: true })
  })

  describe('ensureModel()', () => {
    it('installs the model when the downloaded bytes match the pin', async () => {
      stubFetchServing(GOOD)
      const manager = await makeManager()
      const path = await manager.ensureModel('tiny')
      expect(await readFile(path)).toEqual(GOOD)
      expect(await readdir(modelsDir)).toEqual(['ggml-tiny.bin'])
    })

    it('refuses wrong bytes from the CDN: nothing is renamed and no file is left', async () => {
      const fetchMock = stubFetchServing(EVIL)
      const manager = await makeManager()
      await expect(manager.ensureModel('tiny')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_DOWNLOAD_FAILED'
      })
      // The redirect chain was followed, so the bytes really came from the CDN host.
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(await readdir(modelsDir)).toEqual([])
      expect(await manager.isModelInstalled('tiny')).toBe(false)
    })
  })

  describe('isModelInstalled() / listInstalledModels()', () => {
    it('requires the exact pinned size', async () => {
      const manager = await makeManager()
      await writeFile(join(modelsDir, 'ggml-tiny.bin'), Buffer.from('short'))
      expect(await manager.isModelInstalled('tiny')).toBe(false)
      expect(await manager.listInstalledModels()).toEqual([])

      await writeFile(join(modelsDir, 'ggml-tiny.bin'), GOOD)
      expect(await manager.isModelInstalled('tiny')).toBe(true)
      expect(await manager.listInstalledModels()).toEqual(['tiny'])
    })
  })

  describe('verifyInstalledModelFile()', () => {
    it('accepts a file whose hash matches the pin', async () => {
      const manager = await makeManager()
      const path = join(modelsDir, 'ggml-tiny.bin')
      await writeFile(path, GOOD)
      await expect(manager.verifyInstalledModelFile(path)).resolves.toBeUndefined()
    })

    it('deletes a same-size file with wrong bytes and reports a re-download', async () => {
      const manager = await makeManager()
      const path = join(modelsDir, 'ggml-tiny.bin')
      await writeFile(path, EVIL)
      expect(await manager.isModelInstalled('tiny')).toBe(true) // size alone passes
      await expect(manager.verifyInstalledModelFile(path)).rejects.toMatchObject({
        code: 'WHISPER_MODEL_NOT_FOUND'
      })
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await manager.isModelInstalled('tiny')).toBe(false)
    })

    it('deletes a file with the wrong size', async () => {
      const manager = await makeManager()
      const path = join(modelsDir, 'ggml-tiny.bin')
      await writeFile(path, Buffer.from('truncated'))
      await expect(manager.verifyInstalledModelFile(path)).rejects.toMatchObject({
        code: 'WHISPER_MODEL_NOT_FOUND'
      })
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('reports a missing file and refuses paths that are not model files', async () => {
      const manager = await makeManager()
      await expect(
        manager.verifyInstalledModelFile(join(modelsDir, 'ggml-tiny.bin'))
      ).rejects.toMatchObject({ code: 'WHISPER_MODEL_NOT_FOUND' })
      await expect(
        manager.verifyInstalledModelFile(join(modelsDir, 'evil.bin'))
      ).rejects.toMatchObject({ code: 'WHISPER_MODEL_NOT_FOUND' })
    })

    it('re-hashes when size, mtime or inode changed since the last good check', async () => {
      const manager = await makeManager()
      const path = join(modelsDir, 'ggml-tiny.bin')
      await writeFile(path, GOOD)
      const before = await stat(path)
      await manager.verifyInstalledModelFile(path)

      // Same size and path, new bytes, new mtime: the cache key changes.
      await writeFile(path, EVIL)
      const later = new Date(before.mtimeMs + 60_000)
      await utimes(path, later, later)
      await expect(manager.verifyInstalledModelFile(path)).rejects.toMatchObject({
        code: 'WHISPER_MODEL_NOT_FOUND'
      })
    })

    it('hashes once per session while path, size, mtime and inode stay the same', async () => {
      const manager = await makeManager()
      const path = join(modelsDir, 'ggml-tiny.bin')
      const fixed = new Date('2026-01-01T00:00:00Z')
      await writeFile(path, GOOD)
      await utimes(path, fixed, fixed)
      await manager.verifyInstalledModelFile(path)

      // Identical metadata: the cached verdict is reused (documented trade-off).
      await writeFile(path, EVIL)
      await utimes(path, fixed, fixed)
      await expect(manager.verifyInstalledModelFile(path)).resolves.toBeUndefined()
    })
  })

  describe('stale download temp files', () => {
    const STALE = 'ggml-base.bin.download-3f2a9c1e-0000-4000-8000-000000000000'

    it('listInstalledModels() removes leftovers and keeps everything else', async () => {
      await writeFile(join(modelsDir, STALE), Buffer.alloc(10))
      await writeFile(join(modelsDir, 'notes.txt'), 'keep')
      const manager = await makeManager()
      await manager.listInstalledModels()
      expect((await readdir(modelsDir)).sort()).toEqual(['notes.txt'])
    })

    it('ensureModel() removes leftovers before it downloads', async () => {
      await writeFile(join(modelsDir, STALE), Buffer.alloc(10))
      stubFetchServing(GOOD)
      const manager = await makeManager()
      await manager.ensureModel('tiny')
      expect(await readdir(modelsDir)).toEqual(['ggml-tiny.bin'])
    })
  })

  describe('aborting an in-flight download', () => {
    /** 200 response whose body sends one chunk and then waits for the abort. */
    function stubHangingFetch(): void {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
          if (new URL(url).hostname === 'huggingface.co') {
            return new Response(null, {
              status: 302,
              headers: { location: 'https://us.aws.cdn.hf.co/xet-bridge-us/abc' }
            })
          }
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(10))
            },
            pull() {
              return new Promise<void>((_resolve, reject) => {
                init?.signal?.addEventListener(
                  'abort',
                  () => reject(new DOMException('aborted', 'AbortError')),
                  { once: true }
                )
              })
            }
          })
          return new Response(body, { status: 200, headers: { 'content-length': '27' } })
        })
      )
    }

    const tempFiles = async (): Promise<string[]> =>
      (await readdir(modelsDir)).filter((f) => f.includes('.download-'))

    it('dispose() (app quit) aborts the download and removes the temp file', async () => {
      stubHangingFetch()
      const manager = await makeManager()
      const pending = manager.ensureModel('tiny')
      const settled = pending.catch((e: unknown) => e)
      await vi.waitFor(async () => expect(await tempFiles()).toHaveLength(1))

      await manager.dispose()

      expect(await settled).toMatchObject({ code: 'WHISPER_MODEL_DOWNLOAD_FAILED' })
      expect(await readdir(modelsDir)).toEqual([])
    })

    it('a caller abort mid-stream leaves no temp file and no model', async () => {
      stubHangingFetch()
      const manager = await makeManager()
      const controller = new AbortController()
      const settled = manager
        .ensureModel('tiny', { signal: controller.signal })
        .catch((e: unknown) => e)
      await vi.waitFor(async () => expect(await tempFiles()).toHaveLength(1))

      controller.abort()

      expect(await settled).toMatchObject({ code: 'WHISPER_MODEL_DOWNLOAD_FAILED' })
      expect(await readdir(modelsDir)).toEqual([])
      expect(await manager.isModelInstalled('tiny')).toBe(false)
    })
  })

  it('uses a pin hash derived from the good payload (guards the test fixture)', () => {
    expect(GOOD_SHA).toHaveLength(64)
    expect(createHash('sha256').update(EVIL).digest('hex')).not.toBe(GOOD_SHA)
  })
})

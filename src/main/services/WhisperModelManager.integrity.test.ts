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
import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const GOOD = Buffer.from('good-model-bytes-0123456789')
const EVIL = Buffer.from('evil-model-bytes-0123456789')
const GOOD_SHA = createHash('sha256').update(GOOD).digest('hex')

const env = vi.hoisted(() => ({ userData: '' }))

/** Lets a test make the PATH stat disagree with the open handle (Windows dev/ino quirks). */
const statControl = vi.hoisted(() => ({
  skewIno: false,
  /**
   * An inode that can never equal the real one. Not `ino + 1`: NTFS file ids are
   * above 2^53, where a number has no room for +1 and rounds back to the same id.
   */
  skewed: (ino: number | bigint): number | bigint => (typeof ino === 'bigint' ? -ino - 1n : -ino - 1)
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const result = await actual.stat(...args)
      return statControl.skewIno ? { ...result, ino: statControl.skewed(result.ino) } : result
    }
  }
})

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
    statControl.skewIno = false
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
    const tinyPath = (): string => join(modelsDir, 'ggml-tiny.bin')

    it('accepts a file whose hash matches the pin', async () => {
      const manager = await makeManager()
      await writeFile(tinyPath(), GOOD)
      await expect(manager.verifyInstalledModelFile('tiny')).resolves.toMatchObject({
        size: GOOD.length
      })
      expect(await readFile(tinyPath())).toEqual(GOOD)
    })

    it('deletes a same-size file with wrong bytes and reports an integrity failure', async () => {
      const manager = await makeManager()
      await writeFile(tinyPath(), EVIL)
      expect(await manager.isModelInstalled('tiny')).toBe(true) // size alone passes
      await expect(manager.verifyInstalledModelFile('tiny')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_INTEGRITY_FAILED'
      })
      await expect(stat(tinyPath())).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await manager.isModelInstalled('tiny')).toBe(false)
    })

    it('deletes a file with the wrong size', async () => {
      const manager = await makeManager()
      await writeFile(tinyPath(), Buffer.from('truncated'))
      await expect(manager.verifyInstalledModelFile('tiny')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_INTEGRITY_FAILED'
      })
      await expect(stat(tinyPath())).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('reports a missing file and refuses ids that are not models', async () => {
      const manager = await makeManager()
      await expect(manager.verifyInstalledModelFile('tiny')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_NOT_FOUND'
      })
      await expect(
        manager.verifyInstalledModelFile('../../evil' as never)
      ).rejects.toMatchObject({ code: 'WHISPER_MODEL_NOT_FOUND' })
    })

    it('does not trust an earlier pass: a tamper with restored metadata is caught in the next job', async () => {
      const manager = await makeManager()
      const fixed = new Date('2026-01-01T00:00:00Z')
      await writeFile(tinyPath(), GOOD)
      await utimes(tinyPath(), fixed, fixed)
      await manager.verifyInstalledModelFile('tiny') // job 1 passes

      // Rewrite in place (same inode, same size) and restore the old mtime.
      await writeFile(tinyPath(), EVIL)
      await utimes(tinyPath(), fixed, fixed)

      await expect(manager.verifyInstalledModelFile('tiny')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_INTEGRITY_FAILED'
      }) // job 2 hashes again
      await expect(stat(tinyPath())).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('a cancel during hashing reports a cancellation and keeps the good file', async () => {
      const manager = await makeManager()
      await writeFile(tinyPath(), GOOD)
      const controller = new AbortController()
      controller.abort()
      await expect(
        manager.verifyInstalledModelFile('tiny', { signal: controller.signal })
      ).rejects.toMatchObject({ code: 'TRANSCRIPTION_CANCELLED' })
      expect(await readFile(tinyPath())).toEqual(GOOD)
      await expect(manager.verifyInstalledModelFile('tiny')).resolves.toBeDefined()
    })

    it('the skewed inode always differs, even for an NTFS file id above 2^53', () => {
      // An NTFS-sized id (Windows hosts report ~9.8e15) where `id + 1 === id`
      const ntfsId = 9851624188281704
      expect(ntfsId + 1).toBe(ntfsId)
      expect(statControl.skewed(ntfsId)).not.toBe(ntfsId)
      expect(statControl.skewed(0)).not.toBe(0)
      expect(statControl.skewed(BigInt(ntfsId))).not.toBe(BigInt(ntfsId))
    })

    it('a "changed while verifying" result fails the job but never deletes a good model', async () => {
      const manager = await makeManager()
      await writeFile(tinyPath(), GOOD)
      statControl.skewIno = true // path stat now disagrees with the handle
      await expect(manager.verifyInstalledModelFile('tiny')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_CHANGED_DURING_CHECK'
      })
      expect(await readFile(tinyPath())).toEqual(GOOD)

      statControl.skewIno = false // the next job checks again and passes
      await expect(manager.verifyInstalledModelFile('tiny')).resolves.toBeDefined()
    })

    it('does not delete bad content when the path no longer names the file it read', async () => {
      const manager = await makeManager()
      await writeFile(tinyPath(), EVIL)
      statControl.skewIno = true
      await expect(manager.verifyInstalledModelFile('tiny')).rejects.toMatchObject({
        code: 'WHISPER_MODEL_CHANGED_DURING_CHECK'
      })
      expect(await readFile(tinyPath())).toEqual(EVIL) // left alone; next job decides
    })

    it('returns the verified state, and assertVerifiedModelUnchanged accepts it until the file changes', async () => {
      const manager = await makeManager()
      await writeFile(tinyPath(), GOOD)
      const verified = await manager.verifyInstalledModelFile('tiny')
      expect(verified.size).toBe(GOOD.length)
      await expect(manager.assertVerifiedModelUnchanged('tiny', verified)).resolves.toBeUndefined()

      // Rewritten after the check: the job must stop, and nothing is deleted.
      const later = new Date(Number(verified.mtimeMs) + 60_000)
      await writeFile(tinyPath(), EVIL)
      await utimes(tinyPath(), later, later)
      await expect(manager.assertVerifiedModelUnchanged('tiny', verified)).rejects.toMatchObject({
        code: 'WHISPER_MODEL_CHANGED_DURING_CHECK'
      })
      expect(await readFile(tinyPath())).toEqual(EVIL)
    })
  })

  describe('stale download temp files', () => {
    const UUID = '3f2a9c1e-0000-4000-8000-000000000000'
    let live: ChildProcess | null = null

    afterEach(() => {
      live?.kill()
      live = null
    })

    async function deadPid(): Promise<number> {
      const child = spawn(process.execPath, ['-e', ''])
      await new Promise((resolve) => child.once('exit', resolve))
      return child.pid as number
    }

    async function livePid(): Promise<number> {
      live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'])
      await new Promise((resolve) => live!.once('spawn', resolve))
      return live.pid as number
    }

    it('listInstalledModels() removes leftovers of a dead instance and keeps everything else', async () => {
      const dead = `ggml-base.bin.download-p${await deadPid()}-${UUID}`
      await writeFile(join(modelsDir, dead), Buffer.alloc(10))
      await writeFile(join(modelsDir, 'notes.txt'), 'keep')
      const manager = await makeManager()
      await manager.listInstalledModels()
      expect((await readdir(modelsDir)).sort()).toEqual(['notes.txt'])
    })

    it("leaves a live instance's download alone (pid is alive)", async () => {
      const other = `ggml-base.bin.download-p${await livePid()}-${UUID}`
      await writeFile(join(modelsDir, other), Buffer.alloc(10))
      const manager = await makeManager()
      await manager.listInstalledModels()
      expect(await readdir(modelsDir)).toEqual([other])
    })

    it('removes a pid-marked file untouched for over an hour even when its pid is alive', async () => {
      const pid = await livePid()
      const stalled = `ggml-base.bin.download-p${pid}-${UUID}`
      const active = `ggml-small.bin.download-p${pid}-${UUID}`
      await writeFile(join(modelsDir, stalled), Buffer.alloc(10))
      await writeFile(join(modelsDir, active), Buffer.alloc(10))
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
      await utimes(join(modelsDir, stalled), twoHoursAgo, twoHoursAgo)
      const manager = await makeManager()
      await manager.listInstalledModels()
      expect(await readdir(modelsDir)).toEqual([active])
    })

    it('removes an unmarked file only once it is older than 10 minutes', async () => {
      const fresh = `ggml-base.bin.download-${UUID}`
      const old = `ggml-small.bin.download-${UUID}`
      await writeFile(join(modelsDir, fresh), Buffer.alloc(10))
      await writeFile(join(modelsDir, old), Buffer.alloc(10))
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
      await utimes(join(modelsDir, old), hourAgo, hourAgo)
      const manager = await makeManager()
      await manager.listInstalledModels()
      expect(await readdir(modelsDir)).toEqual([fresh])
    })

    it("removes this process's own untracked leftovers", async () => {
      const own = `ggml-base.bin.download-p${process.pid}-${UUID}`
      await writeFile(join(modelsDir, own), Buffer.alloc(10))
      const manager = await makeManager()
      await manager.listInstalledModels()
      expect(await readdir(modelsDir)).toEqual([])
    })

    it('ensureModel() removes leftovers before it downloads', async () => {
      await writeFile(
        join(modelsDir, `ggml-base.bin.download-p${await deadPid()}-${UUID}`),
        Buffer.alloc(10)
      )
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

    it('cancelDownloads() (Settings → Cancel) aborts the download through the same path', async () => {
      stubHangingFetch()
      const manager = await makeManager()
      const settled = manager.ensureModel('tiny').catch((e: unknown) => e)
      await vi.waitFor(async () => expect(await tempFiles()).toHaveLength(1))

      expect(manager.cancelDownloads()).toBe(1)

      expect(await settled).toMatchObject({ code: 'WHISPER_MODEL_DOWNLOAD_FAILED' })
      expect(await readdir(modelsDir)).toEqual([])
      // Nothing left to cancel once it has settled
      expect(manager.cancelDownloads()).toBe(0)
    })
  })

  it('uses a pin hash derived from the good payload (guards the test fixture)', () => {
    expect(GOOD_SHA).toHaveLength(64)
    expect(createHash('sha256').update(EVIL).digest('hex')).not.toBe(GOOD_SHA)
  })
})

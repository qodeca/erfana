// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for secureDownloader.ts — hostname allowlist, redirect handling,
 * size caps, SHA-256 verification, Content-Length mismatch.
 *
 * All HTTP traffic is mocked via `vi.stubGlobal('fetch', …)` so tests are
 * hermetic and don't depend on network reachability.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { SecureDownloaderError, downloadToFile } from './secureDownloader'

/** Lets a test make `rm` fail (e.g. a file locked on Windows). Passes through otherwise. */
const rmControl = vi.hoisted(() => ({ fail: false }))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (rmControl.fail) throw new Error('EBUSY: resource busy or locked')
      return actual.rm(...args)
    }
  }
})

/** Build a Response-like object whose body is a ReadableStream of one chunk. */
function mockResponse(opts: {
  status?: number
  headers?: Record<string, string>
  body?: Uint8Array
}): Response {
  const { status = 200, headers = {}, body } = opts
  const stream = body
    ? new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body)
          controller.close()
        }
      })
    : null
  return new Response(stream, { status, headers }) as Response
}

describe('secureDownloader.downloadToFile', () => {
  let workDir: string
  let destPath: string
  let fetchMock: Mock

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'erfana-dl-'))
    destPath = join(workDir, 'out.bin')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    rmControl.fail = false
    vi.unstubAllGlobals()
    await rm(workDir, { recursive: true, force: true })
  })

  it('downloads from an allowlisted host, verifies SHA-256', async () => {
    const payload = new TextEncoder().encode('hello world')
    const expectedSha = createHash('sha256').update(payload).digest('hex')
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        headers: { 'content-length': String(payload.length) },
        body: payload
      })
    )

    const result = await downloadToFile({
      url: 'https://github.com/owner/repo/releases/download/tag/file.bin',
      destPath,
      maxBytes: 100,
      expectedSha256: expectedSha
    })

    expect(result.bytes).toBe(payload.length)
    expect(result.sha256).toBe(expectedSha)
    expect(await readFile(destPath)).toEqual(Buffer.from(payload))
  })

  it('rejects an unparseable URL before contacting the network (fails closed)', async () => {
    // `new URL('not a url')` throws → assertAllowedHost maps it to a fail-closed
    // hostname-not-allowed error, before any fetch is attempted.
    await expect(
      downloadToFile({ url: 'not a url', destPath, maxBytes: 100 })
    ).rejects.toMatchObject({
      name: 'SecureDownloaderError',
      code: 'hostname-not-allowed'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a 200 response with no body (fails closed)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200 })) // no body
    await expect(
      downloadToFile({ url: 'https://github.com/x', destPath, maxBytes: 100 })
    ).rejects.toMatchObject({ code: 'no-body' })
  })

  it('rejects non-allowlisted hosts', async () => {
    await expect(
      downloadToFile({
        url: 'https://evil.example.com/payload.bin',
        destPath,
        maxBytes: 100
      })
    ).rejects.toMatchObject({
      name: 'SecureDownloaderError',
      code: 'hostname-not-allowed'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows manual redirects and re-checks each hop against allowlist', async () => {
    const payload = new TextEncoder().encode('redirected')
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: {
            location:
              'https://release-assets.githubusercontent.com/actual/path.bin'
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          headers: { 'content-length': String(payload.length) },
          body: payload
        })
      )

    const result = await downloadToFile({
      url: 'https://github.com/owner/repo/releases/download/tag/file.bin',
      destPath,
      maxBytes: 100
    })
    expect(result.bytes).toBe(payload.length)
    expect(result.finalUrl).toContain('release-assets.githubusercontent.com')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects redirect to non-allowlisted host', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 302,
        headers: { location: 'https://evil.example.com/malicious.bin' }
      })
    )
    await expect(
      downloadToFile({
        url: 'https://github.com/owner/repo/releases/download/tag/file.bin',
        destPath,
        maxBytes: 100
      })
    ).rejects.toMatchObject({
      code: 'hostname-not-allowed'
    })
  })

  it('rejects after > 5 redirects', async () => {
    // Chain 6+ redirects; the 6th call should trip the guard.
    for (let i = 0; i < 6; i++) {
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: { location: `https://github.com/loop-${i}/next` }
        })
      )
    }
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 302,
        headers: { location: 'https://github.com/loop-final' }
      })
    )
    await expect(
      downloadToFile({
        url: 'https://github.com/start',
        destPath,
        maxBytes: 100
      })
    ).rejects.toMatchObject({
      code: 'too-many-redirects'
    })
  })

  it('rejects if Content-Length exceeds maxBytes', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        headers: { 'content-length': '1000' },
        body: new Uint8Array(10)
      })
    )
    await expect(
      downloadToFile({
        url: 'https://github.com/x',
        destPath,
        maxBytes: 500
      })
    ).rejects.toMatchObject({
      code: 'size-exceeded'
    })
  })

  it('rejects if streamed bytes exceed maxBytes (server lied)', async () => {
    const bigPayload = new Uint8Array(200)
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        headers: { 'content-length': '10' }, // lie
        body: bigPayload
      })
    )
    await expect(
      downloadToFile({
        url: 'https://github.com/x',
        destPath,
        maxBytes: 100
      })
    ).rejects.toMatchObject({
      code: 'size-exceeded'
    })
  })

  it('rejects on SHA-256 mismatch', async () => {
    const payload = new TextEncoder().encode('legit')
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        headers: { 'content-length': String(payload.length) },
        body: payload
      })
    )
    await expect(
      downloadToFile({
        url: 'https://github.com/x',
        destPath,
        maxBytes: 100,
        expectedSha256:
          '0000000000000000000000000000000000000000000000000000000000000000'
      })
    ).rejects.toMatchObject({
      code: 'sha-mismatch'
    })
  })

  it('deletes the destination file on SHA-256 mismatch', async () => {
    const payload = new TextEncoder().encode('tampered')
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        headers: { 'content-length': String(payload.length) },
        body: payload
      })
    )
    await expect(
      downloadToFile({
        url: 'https://github.com/x',
        destPath,
        maxBytes: 100,
        expectedSha256: '0'.repeat(64)
      })
    ).rejects.toMatchObject({ code: 'sha-mismatch' })
    await expect(stat(destPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('accepts the Hugging Face Xet CDN host', async () => {
    const payload = new TextEncoder().encode('xet')
    fetchMock.mockResolvedValueOnce(
      mockResponse({ headers: { 'content-length': String(payload.length) }, body: payload })
    )
    const result = await downloadToFile({
      url: 'https://us.aws.cdn.hf.co/xet-bridge-us/abc',
      destPath,
      maxBytes: 100
    })
    expect(result.bytes).toBe(payload.length)
  })

  it.each([
    'https://us.aws.cdn.hf.co.evil.com/m.bin',
    'https://evilcdn.hf.co/m.bin',
    'https://cdn.hf.co/m.bin',
    'https://eu.aws.cdn.hf.co/m.bin',
    'https://evil.us.aws.cdn.hf.co/m.bin'
  ])('rejects look-alike host %s', async (url) => {
    await expect(downloadToFile({ url, destPath, maxBytes: 100 })).rejects.toMatchObject({
      code: 'hostname-not-allowed'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows huggingface.co -> us.aws.cdn.hf.co and verifies the pinned hash', async () => {
    const payload = new TextEncoder().encode('model-bytes')
    const sha = createHash('sha256').update(payload).digest('hex')
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: { location: 'https://us.aws.cdn.hf.co/xet-bridge-us/abc?sig=1' }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({ headers: { 'content-length': String(payload.length) }, body: payload })
      )
    const result = await downloadToFile({
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
      destPath,
      maxBytes: 100,
      expectedSha256: sha
    })
    expect(result.finalUrl).toContain('us.aws.cdn.hf.co')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['plain http', 'http://huggingface.co/m.bin'],
    ['a non-default port', 'https://huggingface.co:8443/m.bin'],
    ['a trailing-dot host', 'https://huggingface.co./m.bin'],
    ['userinfo with an allowlisted host', 'https://user:pw@huggingface.co/m.bin'],
    ['userinfo hiding another host', 'https://huggingface.co@evil.example.com/m.bin'],
    ['a non-http scheme', 'ftp://huggingface.co/m.bin']
  ])('rejects %s before contacting the network', async (_label, url) => {
    await expect(downloadToFile({ url, destPath, maxBytes: 100 })).rejects.toMatchObject({
      code: 'hostname-not-allowed'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the explicit default https port', async () => {
    const payload = new TextEncoder().encode('ok')
    fetchMock.mockResolvedValueOnce(
      mockResponse({ headers: { 'content-length': String(payload.length) }, body: payload })
    )
    const result = await downloadToFile({
      url: 'https://huggingface.co:443/m.bin',
      destPath,
      maxBytes: 100
    })
    expect(result.bytes).toBe(payload.length)
  })

  it('rejects a redirect that downgrades to http or adds a port', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 302, headers: { location: 'http://us.aws.cdn.hf.co/x' } })
    )
    await expect(
      downloadToFile({ url: 'https://huggingface.co/m.bin', destPath, maxBytes: 100 })
    ).rejects.toMatchObject({ code: 'hostname-not-allowed' })

    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 302, headers: { location: 'https://us.aws.cdn.hf.co:8443/x' } })
    )
    await expect(
      downloadToFile({ url: 'https://huggingface.co/m.bin', destPath, maxBytes: 100 })
    ).rejects.toMatchObject({ code: 'hostname-not-allowed' })
  })

  describe('error messages never carry the query string', () => {
    const SIGNED = 'https://us.aws.cdn.hf.co/xet-bridge-us/abc?X-Amz-Signature=SECRET&Policy=P'

    it('http-status', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 403 }))
      const err = await downloadToFile({ url: SIGNED, destPath, maxBytes: 100 }).catch((e) => e)
      expect(err).toMatchObject({ code: 'http-status' })
      expect(err.message).toContain('https://us.aws.cdn.hf.co/xet-bridge-us/abc')
      expect(err.message).not.toContain('SECRET')
      expect(err.message).not.toContain('?')
    })

    it('redirect without Location', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 302 }))
      const err = await downloadToFile({ url: SIGNED, destPath, maxBytes: 100 }).catch((e) => e)
      expect(err).toMatchObject({ code: 'http-status' })
      expect(err.message).not.toContain('SECRET')
    })

    it('empty body', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200 }))
      const err = await downloadToFile({ url: SIGNED, destPath, maxBytes: 100 }).catch((e) => e)
      expect(err).toMatchObject({ code: 'no-body' })
      expect(err.message).not.toContain('SECRET')
    })

    it('too many redirects', async () => {
      fetchMock.mockImplementation(async () =>
        mockResponse({ status: 302, headers: { location: SIGNED } })
      )
      const err = await downloadToFile({ url: SIGNED, destPath, maxBytes: 100 }).catch((e) => e)
      expect(err).toMatchObject({ code: 'too-many-redirects' })
      expect(err.message).not.toContain('SECRET')
    })

    it('unparseable URL is not echoed', async () => {
      const err = await downloadToFile({
        url: 'not a url?token=SECRET',
        destPath,
        maxBytes: 100
      }).catch((e) => e)
      expect(err).toMatchObject({ code: 'hostname-not-allowed' })
      expect(err.message).not.toContain('SECRET')
    })
  })

  it('still throws sha-mismatch when removing the file fails', async () => {
    const payload = new TextEncoder().encode('tampered')
    fetchMock.mockResolvedValueOnce(
      mockResponse({ headers: { 'content-length': String(payload.length) }, body: payload })
    )
    rmControl.fail = true
    await expect(
      downloadToFile({
        url: 'https://github.com/x',
        destPath,
        maxBytes: 100,
        expectedSha256: '0'.repeat(64)
      })
    ).rejects.toMatchObject({ name: 'SecureDownloaderError', code: 'sha-mismatch' })
  })

  it('refuses a 0-byte response when a hash is pinned', async () => {
    const pinned = createHash('sha256').update('real model').digest('hex')
    fetchMock.mockResolvedValueOnce(
      mockResponse({ headers: { 'content-length': '0' }, body: new Uint8Array(0) })
    )
    await expect(
      downloadToFile({
        url: 'https://huggingface.co/m.bin',
        destPath,
        maxBytes: 100,
        expectedSha256: pinned
      })
    ).rejects.toMatchObject({ code: 'sha-mismatch' })
    await expect(stat(destPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects when the signal aborts in the middle of the stream', async () => {
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(5))
      },
      pull() {
        return new Promise<void>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          )
          setTimeout(() => controller.abort(), 0)
        })
      }
    })
    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-length': '50' } })
    )
    await expect(
      downloadToFile({
        url: 'https://huggingface.co/m.bin',
        destPath,
        maxBytes: 100,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects Content-Length mismatch (server sent fewer bytes than promised)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        headers: { 'content-length': '50' },
        body: new Uint8Array(30) // less than promised
      })
    )
    await expect(
      downloadToFile({
        url: 'https://github.com/x',
        destPath,
        maxBytes: 100
      })
    ).rejects.toMatchObject({
      code: 'content-length-mismatch'
    })
  })

  it('rejects non-200 terminal response', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 404, headers: {}, body: new Uint8Array() })
    )
    await expect(
      downloadToFile({
        url: 'https://github.com/missing',
        destPath,
        maxBytes: 100
      })
    ).rejects.toMatchObject({
      code: 'http-status'
    })
  })

  it('reports progress via onProgress callback', async () => {
    const payload = new Uint8Array(50)
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        headers: { 'content-length': '50' },
        body: payload
      })
    )
    const progress: Array<[number, number | null]> = []
    await downloadToFile({
      url: 'https://github.com/x',
      destPath,
      maxBytes: 100,
      onProgress: (got, total) => progress.push([got, total])
    })
    expect(progress.length).toBeGreaterThan(0)
    const last = progress[progress.length - 1]
    expect(last[0]).toBe(50)
    expect(last[1]).toBe(50)
  })

  it('writes the downloaded payload to destPath', async () => {
    const payload = new TextEncoder().encode('persisted')
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        headers: { 'content-length': String(payload.length) },
        body: payload
      })
    )
    await downloadToFile({
      url: 'https://github.com/x',
      destPath,
      maxBytes: 100
    })
    const st = await stat(destPath)
    expect(st.size).toBe(payload.length)
  })

  it('surfaces SecureDownloaderError class for all error codes', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 500 }))
    try {
      await downloadToFile({
        url: 'https://github.com/x',
        destPath,
        maxBytes: 100
      })
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SecureDownloaderError)
    }
  })
})

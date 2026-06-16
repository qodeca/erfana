// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for secureDownloader.ts — hostname allowlist, redirect handling,
 * size caps, SHA-256 verification, Content-Length mismatch.
 *
 * All HTTP traffic is mocked via `vi.stubGlobal('fetch', …)` so tests are
 * hermetic and don't depend on network reachability.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { SecureDownloaderError, downloadToFile } from './secureDownloader'

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
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'erfana-dl-'))
    destPath = join(workDir, 'out.bin')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
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

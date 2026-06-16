// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Secure HTTP(S) downloader for whisper.cpp binaries + GGML models.
 *
 * Invariants:
 *  - Only allowlisted hostnames are contacted (defense against open-redirect
 *    MITM). Allowlist is explicit; additions require code change + review.
 *  - Redirects are handled manually (`redirect: 'manual'`) with a max hop
 *    count — prevents redirect loops and ensures every hop re-enters the
 *    hostname allowlist check.
 *  - A per-download byte cap is honored in two places: the `Content-Length`
 *    header is rejected if it exceeds the cap, AND the streamed chunk count
 *    is monitored live so a lying server can't bypass the first check.
 *  - Optional SHA-256 verification runs in parallel with the file write via
 *    a streaming hash — no second pass over the file.
 *  - Writes stream to disk; never buffers the full file in memory.
 *
 * @see docs/build/whisper-binaries.md § "Security baseline"
 */

import { createHash } from 'crypto'
import { createWriteStream } from 'fs'

/** Hosts Erfana will fetch binary/model assets from. Anything else = hard fail. */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  // Our own release hosting (whisper binaries, manifests).
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  // GGML model hosting (Hugging Face).
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
  'cdn-lfs-eu-1.huggingface.co'
])

const MAX_REDIRECTS = 5

export type SecureDownloaderErrorCode =
  | 'hostname-not-allowed'
  | 'too-many-redirects'
  | 'size-exceeded'
  | 'sha-mismatch'
  | 'content-length-mismatch'
  | 'http-status'
  | 'no-body'

export class SecureDownloaderError extends Error {
  constructor(
    public readonly code: SecureDownloaderErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SecureDownloaderError'
  }
}

export interface DownloadToFileOpts {
  url: string
  destPath: string
  /**
   * Hard cap on bytes downloaded. Exceeded → rejected with `size-exceeded`.
   * Callers set this per-artifact (binary ≤ 20 MB, GGML model ≤ 2 GB).
   */
  maxBytes: number
  /**
   * If provided, the streamed content's SHA-256 is compared against this
   * value. Lower-case hex expected; comparison is case-insensitive.
   */
  expectedSha256?: string
  /** Emitted per chunk; `totalBytes` is null if server didn't send Content-Length. */
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void
  signal?: AbortSignal
}

export interface DownloadResult {
  /** Total bytes written to disk. */
  bytes: number
  /** Lower-case hex SHA-256 of the downloaded content. */
  sha256: string
  /** Final URL after redirect following (may differ from input `url`). */
  finalUrl: string
}

/**
 * Fetch a URL, stream to disk, verify integrity.
 *
 * On failure the destination file is not guaranteed to be removed; callers
 * should `fs.rm` themselves before retrying to avoid partial-content reuse.
 */
export async function downloadToFile(opts: DownloadToFileOpts): Promise<DownloadResult> {
  let url = opts.url
  let redirectCount = 0

  while (redirectCount <= MAX_REDIRECTS) {
    assertAllowedHost(url)

    const res = await fetch(url, {
      redirect: 'manual',
      signal: opts.signal
    })
    const status = res.status

    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location')
      if (!loc) {
        throw new SecureDownloaderError(
          'http-status',
          `Redirect ${status} from ${url} without Location header`
        )
      }
      // Resolve potentially-relative Location against the current URL.
      url = new URL(loc, url).toString()
      redirectCount++
      continue
    }

    if (status !== 200) {
      throw new SecureDownloaderError('http-status', `HTTP ${status} from ${url}`)
    }

    if (!res.body) {
      throw new SecureDownloaderError('no-body', `Empty body from ${url}`)
    }

    let totalBytes: number | null = null
    const cl = res.headers.get('content-length')
    if (cl !== null) {
      const parsed = Number.parseInt(cl, 10)
      if (Number.isFinite(parsed) && parsed >= 0) {
        totalBytes = parsed
        if (totalBytes > opts.maxBytes) {
          throw new SecureDownloaderError(
            'size-exceeded',
            `Content-Length ${totalBytes} > cap ${opts.maxBytes}`
          )
        }
      }
    }

    const hasher = createHash('sha256')
    const fileStream = createWriteStream(opts.destPath)
    let downloadedBytes = 0

    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        downloadedBytes += value.length
        if (downloadedBytes > opts.maxBytes) {
          throw new SecureDownloaderError(
            'size-exceeded',
            `Downloaded bytes ${downloadedBytes} > cap ${opts.maxBytes} (server may have lied about Content-Length)`
          )
        }
        hasher.update(value)
        opts.onProgress?.(downloadedBytes, totalBytes)
        await writeChunk(fileStream, value)
      }
    } catch (err) {
      fileStream.destroy()
      throw err
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })

    if (totalBytes !== null && downloadedBytes !== totalBytes) {
      throw new SecureDownloaderError(
        'content-length-mismatch',
        `Content-Length said ${totalBytes}, got ${downloadedBytes}`
      )
    }

    const sha256 = hasher.digest('hex')
    if (opts.expectedSha256 !== undefined) {
      const expected = opts.expectedSha256.toLowerCase()
      if (sha256 !== expected) {
        throw new SecureDownloaderError(
          'sha-mismatch',
          `SHA-256 mismatch: expected ${expected}, got ${sha256}`
        )
      }
    }

    return { bytes: downloadedBytes, sha256, finalUrl: url }
  }

  throw new SecureDownloaderError(
    'too-many-redirects',
    `Exceeded ${MAX_REDIRECTS} redirects from ${opts.url}`
  )
}

function assertAllowedHost(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new SecureDownloaderError('hostname-not-allowed', `Invalid URL: ${url}`)
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new SecureDownloaderError(
      'hostname-not-allowed',
      `Hostname not in allowlist: ${parsed.hostname}`
    )
  }
}

function writeChunk(stream: NodeJS.WritableStream, chunk: Uint8Array): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()))
  })
}

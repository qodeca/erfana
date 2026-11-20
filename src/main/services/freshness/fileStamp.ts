// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Which version of a file is on disk: its stamp (#478, plan decisions 28–30).
 *
 * A stamp is the file's size, mtime, ctime and file id, plus the SHA-256 of
 * its bytes for files up to 16 MiB. Comparing hashes catches a copy that keeps
 * the old size and mtime (L4) and lets a touch-only write stay silent (N3).
 *
 * Every read here:
 * - opens the file once, read-only and `O_NONBLOCK` on POSIX (a FIFO answers
 *   at once instead of waiting for a writer; plain read-only on Windows);
 * - `fstat`s that descriptor and refuses anything but a regular file;
 * - reads at most `size + 1` bytes, then `fstat`s again: a size or time that
 *   moved during the read answers `busy`, never a hash of a torn file.
 *
 * Hashes are cached (LRU, 256 entries) by real path and the full stat tuple,
 * so a second probe of an unchanged file costs one `fstat`; and one hash per
 * real path runs at a time – a second caller awaits the first's promise (F24).
 *
 * @module services/freshness/fileStamp
 */
import { createHash, type Hash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { open as fsOpen, type FileHandle } from 'node:fs/promises'

import type { FileStamp } from '../../../shared/freshness/freshnessTypes'
import { FRESHNESS_LIMITS } from '../../../shared/freshness/timingProfiles'
import { sameStats, stampFromStats } from './stampStats'

export { sameStats, stampFromStats }

/** Bytes read per chunk while hashing or reading. */
export const READ_CHUNK_BYTES = 64 * 1024

/** How `open` is called; injectable so a test can count opens or fake a handle. */
export type OpenFn = (path: string, flags: number) => Promise<FileHandle>

/** Open flags: read-only, plus non-blocking where the platform has it (decision 30). */
export function freshnessOpenFlags(platform: NodeJS.Platform = process.platform): number {
  if (platform === 'win32') return constants.O_RDONLY
  return constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)
}

/** The outcome of stamping a file. */
export type StampResult =
  | { readonly status: 'ok'; readonly stamp: FileStamp }
  | { readonly status: 'missing' }
  | { readonly status: 'busy' }
  | { readonly status: 'unsupported'; readonly code: string }
  | { readonly status: 'unreadable'; readonly code: string }

/** A failed open or read, classified. */
export type OpenFailure = Exclude<StampResult, { status: 'ok' } | { status: 'busy' }>

const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR'])
/** Not a file we can read as one: a socket (ENXIO), a device, a folder. */
const UNSUPPORTED_CODES = new Set(['ENXIO', 'ENODEV', 'EISDIR', 'EOPNOTSUPP'])

/** Classify an error from `open`/`read`/`fstat`: missing, unsupported, or unreadable (locked, denied, …). */
export function classifyReadError(error: unknown): OpenFailure {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? 'EUNKNOWN'
  if (MISSING_CODES.has(code)) return { status: 'missing' }
  if (UNSUPPORTED_CODES.has(code)) return { status: 'unsupported', code }
  return { status: 'unreadable', code }
}

/** SHA-256 (hex) of bytes, or of a string as UTF-8. */
export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Read at most `maxBytes` from the start of an open file, handing each chunk to
 * `onChunk`. Resolves the number of bytes read (EOF or `maxBytes`, whichever
 * comes first).
 */
export async function readChunks(
  handle: FileHandle,
  maxBytes: number,
  onChunk: (chunk: Buffer) => void
): Promise<number> {
  let total = 0
  while (total < maxBytes) {
    const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, maxBytes - total))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, total)
    if (bytesRead === 0) break
    onChunk(buffer.subarray(0, bytesRead))
    total += bytesRead
  }
  return total
}

/** Dependencies of {@link FileStamper}; every field has a production default. */
export interface FileStamperDeps {
  open?: OpenFn
  platform?: NodeJS.Platform
  /** Files above this are stamped by stat only. */
  hashMaxBytes?: number
  /** LRU size of the hash cache. */
  cacheEntries?: number
}

/** The cache key: real path and the full stat tuple. */
function cacheKey(realPath: string, stats: BigIntStats): string {
  return `${realPath}\0${stats.size}\0${stats.mtimeNs}\0${stats.ctimeNs}\0${stats.ino}`
}

/** Stamps files, with the hash cache and the one-hash-per-path rule. */
export class FileStamper {
  private readonly openFile: OpenFn
  private readonly flags: number
  private readonly hashMaxBytes: number
  private readonly cacheEntries: number
  /** Insertion order is recency: a hit is moved to the end, the first key is evicted. */
  private readonly hashes = new Map<string, string>()
  private readonly inFlight = new Map<string, Promise<StampResult>>()

  constructor(deps: FileStamperDeps = {}) {
    // Looked up per call, not at construction: the process-wide instance is built at import time
    this.openFile = deps.open ?? ((path, flags) => fsOpen(path, flags))
    this.flags = freshnessOpenFlags(deps.platform)
    this.hashMaxBytes = deps.hashMaxBytes ?? FRESHNESS_LIMITS.hashMaxBytes
    this.cacheEntries = deps.cacheEntries ?? FRESHNESS_LIMITS.hashCacheEntries
  }

  /** Open `path` the way every freshness read does. */
  open(path: string): Promise<FileHandle> {
    return this.openFile(path, this.flags)
  }

  /** The cached hash for this exact file version, if any (and mark it recently used). */
  cachedHash(realPath: string, stats: BigIntStats): string | undefined {
    const key = cacheKey(realPath, stats)
    const hash = this.hashes.get(key)
    if (hash === undefined) return undefined
    this.hashes.delete(key)
    this.hashes.set(key, hash)
    return hash
  }

  /** Remember the hash of bytes read from this exact file version (a text read seeds the cache). */
  remember(realPath: string, stats: BigIntStats, hash: string): void {
    const key = cacheKey(realPath, stats)
    this.hashes.delete(key)
    this.hashes.set(key, hash)
    while (this.hashes.size > this.cacheEntries) {
      const oldest = this.hashes.keys().next().value
      if (oldest === undefined) break
      this.hashes.delete(oldest)
    }
  }

  /** Cached hashes (for tests and stats). */
  get cacheSize(): number {
    return this.hashes.size
  }

  /**
   * Stamp the file at `realPath`, hashed when it is at most 16 MiB. A second
   * call for the same path while one runs gets the same promise.
   *
   * @param realPath - the file's real path (confinement is the caller's job)
   */
  stamp(realPath: string): Promise<StampResult> {
    const running = this.inFlight.get(realPath)
    if (running) return running
    const started = this.stampOnce(realPath).finally(() => {
      if (this.inFlight.get(realPath) === started) this.inFlight.delete(realPath)
    })
    this.inFlight.set(realPath, started)
    return started
  }

  private async stampOnce(realPath: string): Promise<StampResult> {
    let handle: FileHandle
    try {
      handle = await this.open(realPath)
    } catch (error) {
      return classifyReadError(error)
    }
    try {
      return await this.stampHandle(realPath, handle)
    } catch (error) {
      return classifyReadError(error)
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  private async stampHandle(realPath: string, handle: FileHandle): Promise<StampResult> {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) return { status: 'unsupported', code: 'ENOTFILE' }
    const size = Number(before.size)
    if (size > this.hashMaxBytes) return { status: 'ok', stamp: stampFromStats(before) }

    const cached = this.cachedHash(realPath, before)
    if (cached !== undefined) return { status: 'ok', stamp: stampFromStats(before, cached) }

    const hasher: Hash = createHash('sha256')
    const read = await readChunks(handle, size + 1, (chunk) => hasher.update(chunk))
    const after = await handle.stat({ bigint: true })
    if (read !== size || !sameStats(before, after)) return { status: 'busy' }

    const hash = hasher.digest('hex')
    this.remember(realPath, before, hash)
    return { status: 'ok', stamp: stampFromStats(before, hash) }
  }
}

/** The process-wide stamper: one hash cache for every main-side reader. */
export const fileStamper = new FileStamper()

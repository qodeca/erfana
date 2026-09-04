// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Reading an image for the sandboxed renderer, and skipping the read when the
 * caller already holds the current bytes (issue #70).
 *
 * Extracted from `FileService` because the image viewer stopped reading once
 * per opened tab and started re-reading on every disk change. The read itself
 * is cheap async I/O; what is not cheap is `buffer.toString('base64')`, which
 * blocks the main-process event loop for the whole encode (~100-200 ms for a
 * tens-of-MB asset), plus the structured clone of the ~33%-larger string across
 * IPC. While that runs, everything else in the app - including the terminal the
 * user is watching an agent work in - is frozen.
 *
 * The skip is version-based and CALLER-SCOPED: the caller says which version it
 * already has, this module stats the file and compares. Nothing is remembered
 * between calls, so there is no cache to bound, two panels (or two windows)
 * looking at one file cannot answer for each other, and a caller that holds no
 * bytes simply omits the version and always gets a full read.
 *
 * Two ordering rules make the skip safe rather than a way to reintroduce the
 * staleness bug this issue fixes:
 *
 * 1. **Stat before read.** The returned version describes the file as it was
 *    *before* the bytes were read, so a write landing mid-read can only make
 *    the version look OLDER than the bytes it labels - which costs one
 *    redundant re-read later. Stat-after-read would do the opposite and label
 *    fresh-looking versions onto stale bytes, i.e. exactly the reported bug.
 * 2. **Nanosecond mtime, not millisecond.** `size` + `mtimeMs` can collide on a
 *    same-size rewrite inside the timestamp granularity; `stat({ bigint: true })`
 *    exposes `mtimeNs`, which on APFS and NTFS resolves to 1 ns / 100 ns. The
 *    inode goes into the token too, so a replace-by-rename that preserves size
 *    and mtime is still seen as a change.
 *
 * @see src/shared/ipc/file-image-schema.ts for the wire contract
 */
import { readFile, stat } from 'fs/promises'
import { extname } from 'path'
import type { BigIntStats } from 'fs'
import type { ImageReadOk, ImageReadResponse } from '../../../shared/ipc/file-image-schema'
import {
  IMAGE_EXTENSIONS,
  getImageMimeType
} from '../../../shared/ipc/image-formats'

// The supported-extension list and the extension -> MIME map used to be
// declared here AND in the renderer, with a comment asking the two to be kept
// in step by hand. Issue #73 needed the MIME map in a third place (the export
// harness types its Blob with it), so both facts moved to
// `src/shared/ipc/image-formats.ts` and every process imports them from there.
export { IMAGE_EXTENSIONS }

/**
 * Security: cap the file size to prevent memory exhaustion (DoS).
 * Base64 encoding grows the payload by ~33%, so a 50 MB file becomes ~67 MB.
 */
export const MAX_IMAGE_SIZE = 50 * 1024 * 1024 // 50 MB

/**
 * Mint the opaque version token for a stat result.
 *
 * `size:mtimeNs:ino` - content length, last-write time at the finest resolution
 * the platform records, and the inode so a swapped-in file with identical size
 * and preserved mtime is still a different version. Callers treat it as opaque.
 */
function formatVersion(stats: BigIntStats): string {
  return `${stats.size}:${stats.mtimeNs}:${stats.ino}`
}

/**
 * Read an image as a base64 data URL, or report that it has not changed.
 *
 * @param filePath - Absolute path to the image file (confinement is the caller's job)
 * @param knownVersion - Version the caller already holds bytes for; omit to force a read
 * @returns `{ status: 'ok', dataUrl, version }`, or `{ status: 'unchanged', version }`
 *          when `knownVersion` still matches the file on disk
 * @throws Error if the extension is unsupported, the file exceeds
 *         {@link MAX_IMAGE_SIZE}, or the file cannot be stat'd/read
 *
 * @example
 * ```ts
 * const first = await readImage('/p/shot.png')              // { status: 'ok', ... }
 * const again = await readImage('/p/shot.png', first.version) // { status: 'unchanged', ... }
 * ```
 */
export function readImage(filePath: string): Promise<ImageReadOk>
export function readImage(
  filePath: string,
  knownVersion: string | undefined
): Promise<ImageReadResponse>
export async function readImage(
  filePath: string,
  knownVersion?: string
): Promise<ImageReadResponse> {
  const ext = extname(filePath).toLowerCase()

  if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}`)
  }

  // Stat first: it gates the size cap AND mints the version, and doing it
  // before the read keeps the version from ever outrunning the bytes.
  const stats = await stat(filePath, { bigint: true })
  const size = Number(stats.size)

  // The cap is checked before the version comparison so an oversized file
  // reports the same error whether or not a version was supplied.
  if (size > MAX_IMAGE_SIZE) {
    const sizeMB = (size / (1024 * 1024)).toFixed(1)
    throw new Error(`Image file too large (${sizeMB} MB). Maximum size is 50 MB.`)
  }

  const version = formatVersion(stats)

  if (knownVersion !== undefined && knownVersion === version) {
    return { status: 'unchanged', version }
  }

  const mimeType = getImageMimeType(ext) ?? 'application/octet-stream'
  const buffer = await readFile(filePath)

  return { status: 'ok', dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`, version }
}

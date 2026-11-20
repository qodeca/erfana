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
 *    and mtime is still seen as a change, and so does the change time
 *    (`ctimeNs`), which every write moves and no copy tool can put back: a
 *    same-size in-place copy that keeps the old mtime is a change too (#478 L4).
 *
 * And two checks make the bytes trustworthy (#478, plan decision 30-31):
 * anything but a regular file is refused before a byte is read, and a second
 * `stat` after the read must match the first, or the read throws
 * {@link FileBusyError} instead of handing out a half-written file (P3).
 *
 * @see src/shared/ipc/file-image-schema.ts for the wire contract
 */
import { readFile, stat } from 'fs/promises'
import { extname } from 'path'
import type { BigIntStats } from 'fs'
import { IMAGE_READ_MAX_BYTES, type ImageReadOk, type ImageReadResponse } from '../../../shared/ipc/file-image-schema'
import { sameStats, stampFromStats } from '../freshness/stampStats'
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
 * The value lives in the shared schema so the renderer's notice states it too.
 */
export const MAX_IMAGE_SIZE = IMAGE_READ_MAX_BYTES

/**
 * Thrown when a file is over {@link MAX_IMAGE_SIZE}. A subclass, so a caller
 * that answers with a reason instead of an error (the Markdown preview, #71)
 * can tell it apart; the message is unchanged for the image viewer.
 */
export class ImageTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageTooLargeError'
  }
}

/** The opened path is not a regular file (a folder, FIFO, socket or device). */
export class NotARegularFileError extends Error {
  constructor() {
    super('Not a regular file')
    this.name = 'NotARegularFileError'
  }
}

/**
 * The file changed while it was read (#478 P3): the bytes may be torn, so none
 * are handed out. The next change event (or a retry after the write settles)
 * reads it again.
 */
export class FileBusyError extends Error {
  constructor() {
    super('File changed while it was read')
    this.name = 'FileBusyError'
  }
}

/**
 * Mint the opaque version token for a stat result.
 *
 * `size:mtimeNs:ctimeNs:ino` - content length, last-write time at the finest
 * resolution the platform records, the change time (moved by every write, even
 * one that puts the old mtime back - #478 L4), and the inode so a swapped-in
 * file with identical size and preserved mtime is still a different version.
 * Callers treat it as opaque.
 */
export function formatVersion(stats: BigIntStats): string {
  return `${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.ino}`
}

/**
 * Read an image as a base64 data URL, or report that it has not changed.
 *
 * @param filePath - Absolute path to the image file (confinement is the caller's job)
 * @param knownVersion - Version the caller already holds bytes for; omit to force a read
 * @returns `{ status: 'ok', dataUrl, version, stamp }`, or `{ status: 'unchanged', version, stamp }`
 *          when `knownVersion` still matches the file on disk
 * @throws Error if the extension is unsupported, the file exceeds
 *         {@link MAX_IMAGE_SIZE}, or the file cannot be stat'd/read;
 *         {@link NotARegularFileError} for anything but a regular file;
 *         {@link FileBusyError} when the file changed during the read
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
  if (!stats.isFile()) throw new NotARegularFileError()
  const size = Number(stats.size)

  // The cap is checked before the version comparison so an oversized file
  // reports the same error whether or not a version was supplied.
  if (size > MAX_IMAGE_SIZE) {
    // Rounded up: a file just over the cap must not read "50.0 MB" against a 50 MB limit (U6)
    const sizeMB = (Math.ceil((size * 10) / (1024 * 1024)) / 10).toFixed(1)
    throw new ImageTooLargeError(`Image file too large (${sizeMB} MB). Maximum size is 50 MB.`)
  }

  const version = formatVersion(stats)
  const stamp = stampFromStats(stats)

  if (knownVersion !== undefined && knownVersion === version) {
    return { status: 'unchanged', version, stamp }
  }

  const mimeType = getImageMimeType(ext) ?? 'application/octet-stream'
  const buffer = await readFile(filePath)
  // Read-verify: the file must be the version stat'd before the read
  if (!sameStats(stats, await stat(filePath, { bigint: true }))) throw new FileBusyError()

  return { status: 'ok', dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`, version, stamp }
}
